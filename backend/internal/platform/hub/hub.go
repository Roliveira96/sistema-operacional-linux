// Package hub is the in-memory WebSocket hub: rooms of connections, with one controller and many viewers, a read loop and a write loop
// per connection, limits on what a client may send, and the coalescing of the messages that arrive many times per second
// (ARCHITECTURE.md 3.9, SPEC-051 RN-05). It knows nothing of the domain: the rules of each message type come in the Config and what to do
// with the messages comes in the Handler.
package hub

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// ErrRoomFull is returned by Serve when the room has no place left for a viewer.
var ErrRoomFull = errors.New("the room is full")

// Role is what a connection may do in its room.
type Role string

// The controller sends control messages; a viewer only watches and sends what the rules allow.
const (
	Controller Role = "controller"
	Viewer     Role = "viewer"
)

// Identity says who is behind a connection.
type Identity struct {
	UserID string
	ConnID string
	Role   Role
	// Waiting is a connection that was not admitted to the room yet: it gets its snapshot and only the messages of the rules that
	// AllowWaiting, and receives none of the broadcasts (SPEC-054 RN-01, RN-02).
	Waiting bool
	// Meta is an opaque label the application attaches to the connection (the hub does not read it).
	Meta string
}

// Message is what travels on the wire: a type and its data.
type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// Rule is what the hub checks, for a message type, before it gives the message to the handler. A type with no rule is dropped.
type Rule struct {
	// MaxBytes is the largest size of the whole frame.
	MaxBytes int
	// ControllerOnly drops the message when its sender is not the controller.
	ControllerOnly bool
	// Limited counts the message against the rate limit of its sender.
	Limited bool
	// Coalesce gives the viewers only the latest message of the type in each CoalesceEvery.
	Coalesce bool
	// AllowWaiting lets a connection that is waiting to be admitted send the message; any other type from it is dropped.
	AllowWaiting bool
}

// Config sets the limits of the hub.
type Config struct {
	Rules map[string]Rule
	// MaxViewers is how many viewers a room takes; 0 is no limit. The controller does not count.
	MaxViewers int
	// MaxWaiting is how many connections a room takes in the waiting room, apart from the viewers; 0 is no limit.
	MaxWaiting int
	// RatePerSecond is how many Limited messages an emitter may send in a second; 0 is no limit.
	RatePerSecond int
	// CoalesceEvery is the window of the Coalesce rules.
	CoalesceEvery time.Duration
	// RevokedType is the message sent to a controller that another connection replaced.
	RevokedType string
	// PingEvery keeps idle connections alive through proxies; the default is 30 seconds.
	PingEvery time.Duration
	// Now is the clock of the rate limit; the default is time.Now.
	Now func() time.Time
}

// Handler is what the hub asks of the application.
type Handler interface {
	// Snapshot is the first message of a new connection.
	Snapshot(ctx context.Context, room string, who Identity) (Message, error)
	// Message receives each message that passed the checks of its rule.
	Message(ctx context.Context, room string, who Identity, msg Message)
	// Dropped reports a message that was discarded, and why, for the audit log.
	Dropped(room string, who Identity, msgType, reason string)
	// Joined is called when a connection received its snapshot, and Left when it ended.
	Joined(room string, who Identity)
	Left(room string, who Identity)
}

const (
	outBuffer    = 256
	pendingLimit = 1000
	writeTimeout = 10 * time.Second
	// frameOverhead is what the envelope adds to the data of the largest message.
	frameOverhead = 256
)

// Hub holds the rooms.
type Hub struct {
	cfg   Config
	h     Handler
	log   *zap.Logger
	maxIn int64

	mu    sync.Mutex
	rooms map[string]*room
}

type room struct {
	conns map[string]*conn
}

// New creates a hub.
func New(cfg Config, h Handler, log *zap.Logger) *Hub {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.PingEvery <= 0 {
		cfg.PingEvery = 30 * time.Second
	}
	maxIn := 0
	for _, r := range cfg.Rules {
		if r.MaxBytes > maxIn {
			maxIn = r.MaxBytes
		}
	}
	return &Hub{cfg: cfg, h: h, log: log, maxIn: int64(maxIn + frameOverhead), rooms: map[string]*room{}}
}

// conn is one connection of a room.
type conn struct {
	id     string
	userID string
	ws     *websocket.Conn
	out    chan Message

	mu        sync.Mutex
	role      Role
	waiting   bool
	meta      string
	ready     bool
	closed    bool
	pending   []Message
	coalesced map[string]Message
	timer     *time.Timer

	// the rate limit window of this emitter (used only by its read loop)
	windowStart time.Time
	count       int
}

func (c *conn) identity() Identity {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Identity{UserID: c.userID, ConnID: c.id, Role: c.role, Waiting: c.waiting, Meta: c.meta}
}

// deliver queues a message for the connection. Before the snapshot went out, it waits behind it.
func (c *conn) deliver(msg Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	if !c.ready {
		if len(c.pending) < pendingLimit {
			c.pending = append(c.pending, msg)
		}
		return
	}
	select {
	case c.out <- msg:
	default:
		// A client that does not read is cut off: it comes back and gets the snapshot.
		c.closeLocked()
	}
}

// coalesce keeps only the latest message of each type until the window ends.
func (c *conn) coalesce(msg Message, every time.Duration) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	if c.coalesced == nil {
		c.coalesced = map[string]Message{}
	}
	c.coalesced[msg.Type] = msg
	if c.timer == nil {
		c.timer = time.AfterFunc(every, c.flushCoalesced)
	}
	c.mu.Unlock()
}

func (c *conn) flushCoalesced() {
	c.mu.Lock()
	batch := c.coalesced
	c.coalesced, c.timer = nil, nil
	c.mu.Unlock()
	types := make([]string, 0, len(batch))
	for t := range batch {
		types = append(types, t)
	}
	sort.Strings(types)
	for _, t := range types {
		c.deliver(batch[t])
	}
}

// start releases the connection: the snapshot first, then what waited behind it.
func (c *conn) start(snapshot Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.out <- snapshot
	for _, m := range c.pending {
		select {
		case c.out <- m:
		default:
		}
	}
	c.pending, c.ready = nil, true
}

// finish sends a last message and ends the connection after it.
func (c *conn) finish(last Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	if c.timer != nil {
		c.timer.Stop()
	}
	select {
	case c.out <- last:
	default:
	}
	c.closeLocked()
}

// closeLocked stops the write loop, which closes the socket after it sent what is queued.
func (c *conn) closeLocked() {
	if c.closed {
		return
	}
	c.closed = true
	close(c.out)
}

// Serve runs a connection in the room until it ends. The first message it sends is the snapshot of the handler.
func (h *Hub) Serve(ctx context.Context, ws *websocket.Conn, roomID string, who Identity) error {
	c := &conn{id: uuid.NewString(), userID: who.UserID, ws: ws, out: make(chan Message, outBuffer), role: who.Role, waiting: who.Waiting, meta: who.Meta}
	var replaced *conn

	h.mu.Lock()
	r, ok := h.rooms[roomID]
	if !ok {
		r = &room{conns: map[string]*conn{}}
		h.rooms[roomID] = r
	}
	full := false
	switch {
	case who.Waiting:
		full = h.cfg.MaxWaiting > 0 && r.countWaiting() >= h.cfg.MaxWaiting
	case who.Role == Viewer:
		full = h.cfg.MaxViewers > 0 && r.count(Viewer) >= h.cfg.MaxViewers
	}
	if full {
		empty := len(r.conns) == 0
		if empty {
			delete(h.rooms, roomID)
		}
		h.mu.Unlock()
		_ = ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "room full"), time.Now().Add(time.Second))
		_ = ws.Close()
		return ErrRoomFull
	}
	if who.Role == Controller {
		for _, other := range r.conns {
			other.mu.Lock()
			if other.role == Controller {
				other.role = Viewer
				replaced = other
			}
			other.mu.Unlock()
		}
	}
	r.conns[c.id] = c
	h.mu.Unlock()

	if replaced != nil && h.cfg.RevokedType != "" {
		replaced.deliver(Message{Type: h.cfg.RevokedType})
	}

	go c.writeLoop(h.cfg.PingEvery)
	who.ConnID = c.id
	snapshot, err := h.h.Snapshot(ctx, roomID, who)
	if err != nil {
		h.leave(roomID, c)
		return err
	}
	c.start(snapshot)
	h.h.Joined(roomID, c.identity())

	h.readLoop(ctx, roomID, c)
	h.leave(roomID, c)
	h.h.Left(roomID, c.identity())
	return nil
}

func (r *room) count(role Role) int {
	n := 0
	for _, c := range r.conns {
		c.mu.Lock()
		if c.role == role && !c.waiting {
			n++
		}
		c.mu.Unlock()
	}
	return n
}

func (r *room) countWaiting() int {
	n := 0
	for _, c := range r.conns {
		c.mu.Lock()
		if c.waiting {
			n++
		}
		c.mu.Unlock()
	}
	return n
}

// leave takes the connection out of the room, and closes it.
func (h *Hub) leave(roomID string, c *conn) {
	h.mu.Lock()
	if r, ok := h.rooms[roomID]; ok {
		delete(r.conns, c.id)
		if len(r.conns) == 0 {
			delete(h.rooms, roomID)
		}
	}
	h.mu.Unlock()
	c.mu.Lock()
	if c.timer != nil {
		c.timer.Stop()
	}
	c.closeLocked()
	c.mu.Unlock()
}

// writeLoop is the only writer of the socket. It ends when the out channel is closed, after it sent everything that was queued.
func (c *conn) writeLoop(pingEvery time.Duration) {
	ticker := time.NewTicker(pingEvery)
	defer ticker.Stop()
	defer func() {
		_ = c.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
		_ = c.ws.Close()
	}()
	for {
		select {
		case msg, ok := <-c.out:
			if !ok {
				return
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := c.ws.WriteJSON(msg); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeTimeout)); err != nil {
				return
			}
		}
	}
}

// readLoop reads the frames of the client, applies the rule of each type and gives the valid ones to the handler.
func (h *Hub) readLoop(ctx context.Context, roomID string, c *conn) {
	idle := 3 * h.cfg.PingEvery
	c.ws.SetReadLimit(h.maxIn)
	_ = c.ws.SetReadDeadline(time.Now().Add(idle))
	c.ws.SetPongHandler(func(string) error { return c.ws.SetReadDeadline(time.Now().Add(idle)) })
	for {
		kind, raw, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(idle))
		if kind != websocket.TextMessage {
			continue
		}
		who := c.identity()
		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil || msg.Type == "" {
			h.h.Dropped(roomID, who, "", "malformed")
			continue
		}
		rule, known := h.cfg.Rules[msg.Type]
		switch {
		case !known:
			h.h.Dropped(roomID, who, msg.Type, "unknown-type")
		case len(raw) > rule.MaxBytes:
			h.h.Dropped(roomID, who, msg.Type, "too-large")
		case who.Waiting && !rule.AllowWaiting:
			h.h.Dropped(roomID, who, msg.Type, "not-admitted")
		case rule.ControllerOnly && who.Role != Controller:
			h.h.Dropped(roomID, who, msg.Type, "not-controller")
		case rule.Limited && !h.allow(c):
			h.h.Dropped(roomID, who, msg.Type, "rate-limit")
		default:
			h.h.Message(ctx, roomID, who, msg)
		}
	}
}

// allow counts a limited message of the emitter in its current second.
func (h *Hub) allow(c *conn) bool {
	if h.cfg.RatePerSecond <= 0 {
		return true
	}
	now := h.cfg.Now()
	if now.Sub(c.windowStart) >= time.Second {
		c.windowStart, c.count = now, 0
	}
	c.count++
	return c.count <= h.cfg.RatePerSecond
}

// Broadcast sends the message to everyone in the room but the connection `except`. A message whose rule coalesces reaches each
// connection as the latest of the window.
func (h *Hub) Broadcast(roomID string, msg Message, except string) {
	for _, c := range h.members(roomID) {
		if c.id == except || c.isWaiting() {
			continue
		}
		if h.cfg.Rules[msg.Type].Coalesce && h.cfg.CoalesceEvery > 0 {
			c.coalesce(msg, h.cfg.CoalesceEvery)
			continue
		}
		c.deliver(msg)
	}
}

func (c *conn) isWaiting() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.waiting
}

// SendTo sends the message to the connections of one user in the room, even when they are waiting.
func (h *Hub) SendTo(roomID, userID string, msg Message) {
	for _, c := range h.members(roomID) {
		if c.userID == userID {
			c.deliver(msg)
		}
	}
}

// SetWaiting admits (false) or sends back to the waiting room (true) the connections of one user. Whoever is admitted starts to
// receive the broadcasts, so the application sends the snapshot with SendTo before it calls this.
func (h *Hub) SetWaiting(roomID, userID string, waiting bool) {
	for _, c := range h.members(roomID) {
		if c.userID != userID {
			continue
		}
		c.mu.Lock()
		c.waiting = waiting
		c.mu.Unlock()
	}
}

// SendToController sends the message to the controller of the room, if there is one.
func (h *Hub) SendToController(roomID string, msg Message) {
	for _, c := range h.members(roomID) {
		c.mu.Lock()
		isController := c.role == Controller
		c.mu.Unlock()
		if isController {
			c.deliver(msg)
		}
	}
}

func (h *Hub) members(roomID string) []*conn {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[roomID]
	if !ok {
		return nil
	}
	out := make([]*conn, 0, len(r.conns))
	for _, c := range r.conns {
		out = append(out, c)
	}
	return out
}

// Close sends the final message to everyone in the room, and ends their connections.
func (h *Hub) Close(roomID string, final Message) {
	h.mu.Lock()
	r, ok := h.rooms[roomID]
	delete(h.rooms, roomID)
	h.mu.Unlock()
	if !ok {
		return
	}
	for _, c := range r.conns {
		c.finish(final)
	}
}

// Online is how many viewers are in the room.
func (h *Hub) Online(roomID string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[roomID]; ok {
		return r.count(Viewer)
	}
	return 0
}

// ControllerConnected tells whether the room has its controller.
func (h *Hub) ControllerConnected(roomID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[roomID]; ok {
		return r.count(Controller) > 0
	}
	return false
}
