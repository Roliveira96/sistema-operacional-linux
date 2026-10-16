package hub_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// recorder is the Handler of the tests: it records what the hub tells it and, for the messages it receives, either broadcasts them
// to the room (relay) or only records them.
type recorder struct {
	mu          sync.Mutex
	hub         *hub.Hub
	relay       bool
	snapshotErr error
	messages    []hub.Message
	dropped     []string // "type:reason"
	joined      []hub.Identity
	left        []hub.Identity
}

func (r *recorder) Snapshot(_ context.Context, room string, who hub.Identity) (hub.Message, error) {
	return hub.Message{Type: "snap", Data: json.RawMessage(`{"room":"` + room + `"}`)}, r.snapshotErr
}

func (r *recorder) Message(_ context.Context, room string, who hub.Identity, msg hub.Message) {
	r.mu.Lock()
	r.messages = append(r.messages, msg)
	relay := r.relay
	r.mu.Unlock()
	if relay {
		r.hub.Broadcast(room, msg, who.ConnID)
	}
}

func (r *recorder) Dropped(_ string, _ hub.Identity, msgType, reason string) {
	r.mu.Lock()
	r.dropped = append(r.dropped, msgType+":"+reason)
	r.mu.Unlock()
}

func (r *recorder) Joined(_ string, who hub.Identity) {
	r.mu.Lock()
	r.joined = append(r.joined, who)
	r.mu.Unlock()
}

func (r *recorder) Left(_ string, who hub.Identity) {
	r.mu.Lock()
	r.left = append(r.left, who)
	r.mu.Unlock()
}

func (r *recorder) droppedList() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.dropped...)
}

func (r *recorder) received() []hub.Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]hub.Message(nil), r.messages...)
}

type env struct {
	srv  *httptest.Server
	hub  *hub.Hub
	rec  *recorder
	errs chan error
}

func testConfig() hub.Config {
	return hub.Config{
		Rules: map[string]hub.Rule{
			"slide":  {MaxBytes: 300, ControllerOnly: true},
			"cursor": {MaxBytes: 120, ControllerOnly: true, Limited: true, Coalesce: true},
			"raise":  {MaxBytes: 300},
			"big":    {MaxBytes: 4000, ControllerOnly: true},
		},
		MaxViewers:    2,
		RatePerSecond: 5,
		CoalesceEvery: 30 * time.Millisecond,
		RevokedType:   "revoked",
	}
}

func start(t *testing.T, cfg hub.Config, relay bool) *env {
	t.Helper()
	rec := &recorder{relay: relay}
	h := hub.New(cfg, rec, zap.NewNop())
	rec.hub = h
	e := &env{hub: h, rec: rec, errs: make(chan error, 16)}
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	e.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		role := hub.Viewer
		if r.URL.Query().Get("role") == "controller" {
			role = hub.Controller
		}
		e.errs <- h.Serve(r.Context(), conn, r.URL.Query().Get("room"), hub.Identity{UserID: r.URL.Query().Get("user"), Role: role, Waiting: r.URL.Query().Get("waiting") == "1", Kind: r.URL.Query().Get("kind"), Meta: r.URL.Query().Get("meta")})
	}))
	t.Cleanup(e.srv.Close)
	return e
}

func (e *env) dial(t *testing.T, room, role, user string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/?room=" + room + "&role=" + role + "&user=" + user
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func read(t *testing.T, c *websocket.Conn) hub.Message {
	t.Helper()
	require.NoError(t, c.SetReadDeadline(time.Now().Add(2*time.Second)))
	var m hub.Message
	require.NoError(t, c.ReadJSON(&m))
	return m
}

// nothing asserts that no message arrives in the given time.
func nothing(t *testing.T, c *websocket.Conn, wait time.Duration) {
	t.Helper()
	require.NoError(t, c.SetReadDeadline(time.Now().Add(wait)))
	var m hub.Message
	err := c.ReadJSON(&m)
	require.Error(t, err, "unexpected message %v", m)
}

func send(t *testing.T, c *websocket.Conn, typ, data string) {
	t.Helper()
	require.NoError(t, c.WriteJSON(map[string]any{"type": typ, "data": json.RawMessage(data)}))
}

func eventually(t *testing.T, cond func() bool) {
	t.Helper()
	require.Eventually(t, cond, 2*time.Second, 5*time.Millisecond)
}

// Covers SPEC-051 CA-14 and RN-07: the first message of a connection is the snapshot.
func TestSnapshotIsTheFirstMessage(t *testing.T) {
	e := start(t, testConfig(), true)
	c := e.dial(t, "room-1", "viewer", "ana")
	m := read(t, c)
	assert.Equal(t, "snap", m.Type)
	assert.JSONEq(t, `{"room":"room-1"}`, string(m.Data))
	eventually(t, func() bool { return len(e.rec.joined) == 1 })
}

// Covers SPEC-051 CA-14: a snapshot that fails closes the connection.
func TestSnapshotErrorClosesTheConnection(t *testing.T) {
	e := start(t, testConfig(), true)
	e.rec.snapshotErr = errors.New("boom")
	c := e.dial(t, "room-1", "viewer", "ana")
	require.NoError(t, c.SetReadDeadline(time.Now().Add(2*time.Second)))
	var m hub.Message
	assert.Error(t, c.ReadJSON(&m))
	assert.Error(t, <-e.errs)
}

// Covers SPEC-051 CA-05 and CA-06: what the controller sends reaches the others in the room, not the sender, and not other rooms.
func TestBroadcastGoesToTheOthersNotTheSender(t *testing.T) {
	e := start(t, testConfig(), true)
	teacher := e.dial(t, "room-1", "controller", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	elsewhere := e.dial(t, "room-2", "viewer", "bia")
	read(t, teacher)
	read(t, student)
	read(t, elsewhere)

	send(t, teacher, "slide", `{"index":3}`)
	m := read(t, student)
	assert.Equal(t, "slide", m.Type)
	assert.JSONEq(t, `{"index":3}`, string(m.Data))
	nothing(t, teacher, 150*time.Millisecond)
	nothing(t, elsewhere, 50*time.Millisecond)
}

// Covers SPEC-051 CA-02 and RN-06: control messages from a viewer, and unknown types, are dropped and reported.
func TestControlMessagesOfAViewerAreDropped(t *testing.T) {
	e := start(t, testConfig(), true)
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, student)
	send(t, student, "slide", `{"index":9}`)
	send(t, student, "made-up", `{}`)
	send(t, student, "raise", `{}`)
	eventually(t, func() bool { return len(e.rec.received()) == 1 })
	assert.Equal(t, "raise", e.rec.received()[0].Type, "what a viewer may send gets through")
	assert.ElementsMatch(t, []string{"slide:not-controller", "made-up:unknown-type"}, e.rec.droppedList())
}

// Covers SPEC-051 CA-19 and RN-05: a message bigger than its limit is dropped.
func TestMessageSizeLimit(t *testing.T) {
	e := start(t, testConfig(), true)
	teacher := e.dial(t, "room-1", "controller", "prof")
	read(t, teacher)
	send(t, teacher, "cursor", `{"pad":"`+strings.Repeat("x", 300)+`"}`)
	send(t, teacher, "slide", `{"index":1}`)
	eventually(t, func() bool { return len(e.rec.received()) == 1 })
	assert.Equal(t, []string{"cursor:too-large"}, e.rec.droppedList())
}

// Covers SPEC-051 CA-19 and RN-05: more events per second than the limit are dropped (the limit is 5 here).
func TestRateLimitPerEmitter(t *testing.T) {
	e := start(t, testConfig(), true)
	teacher := e.dial(t, "room-1", "controller", "prof")
	read(t, teacher)
	for i := 0; i < 12; i++ {
		send(t, teacher, "cursor", `{"x":1}`)
	}
	eventually(t, func() bool { return len(e.rec.received())+len(e.rec.droppedList()) == 12 })
	assert.Equal(t, 5, len(e.rec.received()))
	assert.Len(t, e.rec.droppedList(), 7)
	assert.Equal(t, "cursor:rate-limit", e.rec.droppedList()[0])
}

// Covers SPEC-051 CA-19 and RN-05: the room takes at most MaxViewers viewers (2 here); the controller does not count.
func TestViewerLimit(t *testing.T) {
	e := start(t, testConfig(), true)
	e.dial(t, "room-1", "controller", "prof")
	e.dial(t, "room-1", "viewer", "a")
	e.dial(t, "room-1", "viewer", "b")
	third := e.dial(t, "room-1", "viewer", "c")
	require.NoError(t, third.SetReadDeadline(time.Now().Add(2*time.Second)))
	var m hub.Message
	assert.Error(t, third.ReadJSON(&m), "the third viewer is closed before any message")
	// The hub closes the connection first and only then returns ErrRoomFull to the handler, so the error may arrive after the client saw the
	// close: it is waited for, and not read from a channel that may still be empty.
	select {
	case err := <-e.errs:
		assert.ErrorIs(t, err, hub.ErrRoomFull)
	case <-time.After(2 * time.Second):
		assert.Fail(t, "the hub did not say the room is full")
	}
	// A room is counted by its own people: another room is not full.
	other := e.dial(t, "room-2", "viewer", "d")
	assert.Equal(t, "snap", read(t, other).Type)
}

// Covers SPEC-051 CA-11 and RN-06: a second connection of the controller takes the control; the first is told and becomes passive.
func TestNewControllerTakesOver(t *testing.T) {
	e := start(t, testConfig(), true)
	first := e.dial(t, "room-1", "controller", "prof")
	read(t, first)
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, student)
	second := e.dial(t, "room-1", "controller", "prof")
	read(t, second)

	assert.Equal(t, "revoked", read(t, first).Type)
	send(t, first, "slide", `{"index":1}`)
	eventually(t, func() bool { return len(e.rec.droppedList()) == 1 })
	assert.Equal(t, "slide:not-controller", e.rec.droppedList()[0])

	send(t, second, "slide", `{"index":2}`)
	assert.JSONEq(t, `{"index":2}`, string(read(t, student).Data))
	assert.True(t, e.hub.ControllerConnected("room-1"))
	assert.False(t, e.hub.ControllerConnected("room-2"))
}

// Covers SPEC-051 CA-06 and RN-05: a message whose rule coalesces reaches the viewers as the latest one of each 30 ms, not every one.
func TestCoalescingKeepsTheLatest(t *testing.T) {
	cfg := testConfig()
	cfg.RatePerSecond = 0 // no rate limit here: this test is about the receivers
	e := start(t, cfg, false)
	e.dial(t, "room-1", "controller", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, student)

	for i := 1; i <= 40; i++ {
		e.hub.Broadcast("room-1", hub.Message{Type: "cursor", Data: json.RawMessage(`{"i":` + itoa(i) + `}`)}, "")
	}
	var got []hub.Message
	for {
		require.NoError(t, student.SetReadDeadline(time.Now().Add(250*time.Millisecond)))
		var m hub.Message
		if err := student.ReadJSON(&m); err != nil {
			break
		}
		got = append(got, m)
	}
	require.NotEmpty(t, got)
	assert.LessOrEqual(t, len(got), 5, "far fewer than the 40 sent")
	assert.JSONEq(t, `{"i":40}`, string(got[len(got)-1].Data), "the last one always arrives")
}

func itoa(i int) string { b, _ := json.Marshal(i); return string(b) }

// Covers SPEC-051 CA-12: closing a room sends the final message to everyone and disconnects them.
func TestCloseSendsTheFinalMessageAndDisconnects(t *testing.T) {
	e := start(t, testConfig(), true)
	teacher := e.dial(t, "room-1", "controller", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, teacher)
	read(t, student)
	eventually(t, func() bool { return e.hub.Online("room-1") == 1 })

	e.hub.Close("room-1", hub.Message{Type: "ended"})
	assert.Equal(t, "ended", read(t, student).Type)
	assert.Equal(t, "ended", read(t, teacher).Type)
	require.NoError(t, student.SetReadDeadline(time.Now().Add(2*time.Second)))
	var m hub.Message
	assert.Error(t, student.ReadJSON(&m))
	eventually(t, func() bool { return e.hub.Online("room-1") == 0 && !e.hub.ControllerConnected("room-1") })
}

// Covers SPEC-051 RN-07: Online counts the viewers; Joined and Left tell who came and went.
func TestOnlineJoinedAndLeft(t *testing.T) {
	e := start(t, testConfig(), true)
	a := e.dial(t, "room-1", "viewer", "a")
	e.dial(t, "room-1", "viewer", "b")
	read(t, a)
	eventually(t, func() bool { return e.hub.Online("room-1") == 2 })
	_ = a.Close()
	eventually(t, func() bool { return e.hub.Online("room-1") == 1 })
	eventually(t, func() bool { e.rec.mu.Lock(); defer e.rec.mu.Unlock(); return len(e.rec.left) == 1 })
	assert.Equal(t, "a", e.rec.left[0].UserID)
	assert.NotEmpty(t, e.rec.left[0].ConnID)
}
