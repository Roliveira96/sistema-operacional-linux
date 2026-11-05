package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// The messages of the room of the exam (SPEC-091 section 5).
const (
	roomSnapshot = "room:snapshot"
	roomStudent  = "room:student"
	roomAdmitted = "room:admitted"
	roomStarted  = "room:started"
	roomWatch    = "room:watch"
	roomWatchOn  = "room:watch-on"
	roomWatchOff = "room:watch-off"
	roomScreen   = "room:screen"
	roomQuestion = "room:question"
	roomCommand  = "room:command"
	roomCommands = "room:commands"
	roomEnded    = "room:ended"
	helpRaise    = "help:raise"
	helpLower    = "help:lower"
	helpAnswer   = "help:answer"
	helpQueue    = "help:queue"
	helpState    = "help:state"
	roomRevoked  = "room:revoked"
	chatSend     = "chat:send"
	chatMessage  = "chat:message"

	// viewRoom is the window of the teacher (SPEC-091 section 3.1).
	viewRoom = "room"

	// maxQuestionTitle cuts the title of the question a student tells (SPEC-092 revision 2).
	maxQuestionTitle = 200
)

// question is where a student is in the exam (SPEC-092 revision 2).
type question struct {
	Position int    `json:"position"`
	Title    string `json:"title"`
}

// RoomServices is what the room uses from the service (SPEC-091).
type RoomServices interface {
	EnterRoom(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.RoomEntry, error)
	RoomState(ctx context.Context, id uuid.UUID) (service.RoomState, error)
	RoomCard(ctx context.Context, id, studentID uuid.UUID) (service.RoomCard, error)
	RecordCommand(ctx context.Context, id, studentID uuid.UUID, in service.CommandInput) (domain.AttemptCommand, error)
	StudentCommands(ctx context.Context, id, studentID uuid.UUID) ([]domain.AttemptCommand, error)
	RaiseHand(ctx context.Context, id, studentID uuid.UUID, position *int, question string) (domain.HelpRequest, error)
	LowerHand(ctx context.Context, id, studentID uuid.UUID) error
	AnswerHelp(ctx context.Context, id, teacherID, requestID uuid.UUID, answer string) (domain.HelpRequest, error)
	HelpQueue(ctx context.Context, id uuid.UUID) ([]domain.HelpRequest, error)
	MyHelp(ctx context.Context, id, studentID uuid.UUID) (*domain.HelpRequest, error)
	EndAttempt(ctx context.Context, a service.Actor, classID, id, attemptID uuid.UUID, reason string) (service.AttemptRow, error)
	// the conversation of the exam (SPEC-093)
	SendStudentChat(ctx context.Context, id, studentID uuid.UUID, position *int, text string) (domain.ChatMessage, error)
	SendTeacherChat(ctx context.Context, id, teacherID uuid.UUID, studentID *uuid.UUID, position *int, text string) (domain.ChatMessage, []uuid.UUID, error)
	StudentChat(ctx context.Context, id, studentID uuid.UUID) ([]domain.ChatMessage, error)
	RoomChat(ctx context.Context, id uuid.UUID) ([]domain.ChatMessage, error)
	AttemptChat(ctx context.Context, a service.Actor, classID, id, attemptID uuid.UUID) ([]service.ChatLine, error)
	// the admission by the teacher and the finish of the exam (SPEC-096)
	Admit(ctx context.Context, a service.Actor, classID, id uuid.UUID, studentIDs []uuid.UUID) ([]uuid.UUID, error)
	Finish(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.FinishResult, error)
}

// RoomOptions are the origins the room accepts, as in the live class.
type RoomOptions struct {
	AllowedOrigins []string
	AnyOrigin      bool
}

// room is the realtime of the exams: the hub, who is in each room and whom the teacher watches.
type room struct {
	hub      *hub.Hub
	upgrader websocket.Upgrader
	log      *zap.Logger

	mu       sync.Mutex
	present  map[string]map[string]bool // room -> student -> waiting
	watching map[string]string          // room -> student; ponytail: one watched student per room, per window if two teachers watch at once
	// ponytail: in memory only, lost on a restart until the student changes the question or reconnects (SPEC-092 revision 2)
	questions map[string]map[string]question // room -> student -> the question she is in
	started   map[string]bool                // room -> the teacher started the exam: who waits now asks to enter (SPEC-096 RN-02)
}

// WithRoom turns on the room of the exam (SPEC-091); without it the route of the room answers 503.
func (h *Handler) WithRoom(log *zap.Logger, opts RoomOptions) *Handler {
	r := &room{log: log, present: map[string]map[string]bool{}, watching: map[string]string{}, questions: map[string]map[string]question{},
		started: map[string]bool{}}
	r.upgrader = websocket.Upgrader{CheckOrigin: func(req *http.Request) bool {
		origin := req.Header.Get("Origin")
		if origin == "" || opts.AnyOrigin {
			return true
		}
		for _, a := range opts.AllowedOrigins {
			if strings.EqualFold(origin, a) {
				return true
			}
		}
		return strings.EqualFold(origin, "http://"+req.Host) || strings.EqualFold(origin, "https://"+req.Host)
	}}
	r.hub = hub.New(roomConfig(), roomHandler{h: h, r: r}, log)
	h.room = r
	return h
}

func roomConfig() hub.Config {
	const kib = 1 << 10
	return hub.Config{
		Rules: map[string]hub.Rule{
			roomWatch:    {MaxBytes: kib, ControllerOnly: true, Kind: viewRoom},
			helpAnswer:   {MaxBytes: 4 * kib, ControllerOnly: true, Kind: viewRoom},
			roomScreen:   {MaxBytes: 256 * kib, Limited: true},
			roomQuestion: {MaxBytes: kib, Limited: true},
			roomCommand:  {MaxBytes: 8 * kib, Limited: true},
			helpRaise:    {MaxBytes: 4 * kib, Limited: true},
			helpLower:    {MaxBytes: kib, Limited: true},
			chatSend:     {MaxBytes: 4 * kib, Limited: true},
		},
		MaxViewers:    100,
		MaxWaiting:    200,
		RatePerSecond: 20,
		CoalesceEvery: 30 * time.Millisecond,
		RevokedType:   roomRevoked,
	}
}

func encode(typ string, v any) hub.Message {
	raw, _ := json.Marshal(v)
	return hub.Message{Type: typ, Data: raw}
}

// ---- the JSON of the room ----

func helpJSON(h domain.HelpRequest) gin.H {
	out := gin.H{"id": h.ID, "studentId": h.StudentID, "question": h.Question, "status": h.Status, "createdAt": iso(h.CreatedAt)}
	if h.Position != nil {
		out["position"] = *h.Position
	}
	if h.Answer != "" {
		out["answer"] = h.Answer
	}
	return out
}

func (r *room) cardJSON(roomID string, c service.RoomCard) gin.H {
	r.mu.Lock()
	waiting, online := r.present[roomID][c.StudentID.String()]
	q, hasQuestion := r.questions[roomID][c.StudentID.String()]
	started := r.started[roomID]
	r.mu.Unlock()
	out := gin.H{"studentId": c.StudentID, "name": c.Name, "academicId": c.AcademicID, "status": c.Status, "online": online, "waiting": online && waiting,
		"requesting": online && waiting && started, "answered": c.Answered, "total": c.Total, "solved": c.Solved}
	if c.DeadlineAt != nil {
		out["deadlineAt"] = iso(*c.DeadlineAt)
	}
	if c.AttemptID != nil {
		out["attemptId"] = *c.AttemptID
	}
	if c.Help != nil {
		out["help"] = helpJSON(*c.Help)
	}
	if hasQuestion {
		out["question"] = q
	}
	return out
}

// chatJSON is a message of the conversation of the exam (SPEC-093 section 5): studentId, the owner of the conversation, only in a private one.
func chatJSON(m domain.ChatMessage) gin.H {
	out := gin.H{"id": m.ID, "scope": m.Scope(), "from": m.SenderRole, "text": m.Body, "createdAt": iso(m.CreatedAt)}
	if m.StudentID != nil {
		out["studentId"] = *m.StudentID
	}
	if m.Position != nil {
		out["position"] = *m.Position
	}
	return out
}

func chatListJSON(list []domain.ChatMessage) []gin.H {
	out := make([]gin.H, len(list))
	for i, m := range list {
		out[i] = chatJSON(m)
	}
	return out
}

func stateJSON(h *domain.HelpRequest) gin.H {
	if h == nil {
		return gin.H{"status": "NONE"}
	}
	out := gin.H{"status": h.Status}
	if h.Answer != "" {
		out["answer"] = h.Answer
	}
	return out
}

// ---- the route ----

func (h *Handler) connectRoom(c *gin.Context) {
	if h.room == nil {
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	entry, err := h.svc.EnterRoom(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	ws, err := h.room.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return // the upgrader has already answered
	}
	if entry.Started {
		h.room.mu.Lock()
		h.room.started[id.String()] = true
		h.room.mu.Unlock()
	}
	who := hub.Identity{UserID: actor.UserID.String(), Role: hub.Viewer, Meta: actor.Role, Waiting: entry.Waiting}
	if entry.Controller {
		who.Role, who.Kind = hub.Controller, viewRoom
	}
	if err := h.room.hub.Serve(c.Request.Context(), ws, id.String(), who); err != nil {
		h.room.log.Debug("exam room connection ended", zap.String("userId", who.UserID), zap.Error(err))
	}
}

// ---- what the other routes tell the room ----

// started tells the teacher and who waits that the exam started; it admits nobody: who waits now asks to enter (SPEC-096 RN-02, CA-01).
func (h *Handler) started(id uuid.UUID, s service.Summary) {
	if h.room == nil {
		return
	}
	roomID := id.String()
	h.room.mu.Lock()
	h.room.started[roomID] = true
	var waiting []string
	for student, w := range h.room.present[roomID] {
		if w {
			waiting = append(waiting, student)
		}
	}
	h.room.mu.Unlock()
	data := gin.H{"startedByName": s.StartedByName}
	if s.StartedAt != nil {
		data["startedAt"] = iso(*s.StartedAt)
	}
	for _, student := range waiting {
		h.room.hub.SendTo(roomID, student, encode(roomStarted, data))
	}
	h.room.hub.SendToKind(roomID, viewRoom, encode(roomStarted, data))
	for _, student := range waiting {
		h.cardChanged(context.Background(), id, uuid.MustParse(student))
	}
}

// admitted lets in the students the teacher admitted who are waiting in the room, and tells the teacher (SPEC-096 RN-01, CA-02).
func (h *Handler) admitted(ctx context.Context, id uuid.UUID, students []uuid.UUID) {
	if h.room == nil {
		return
	}
	roomID := id.String()
	for _, st := range students {
		student := st.String()
		h.room.mu.Lock()
		waiting := h.room.present[roomID][student]
		if waiting {
			h.room.present[roomID][student] = false
		}
		h.room.mu.Unlock()
		if waiting {
			h.room.hub.SetWaiting(roomID, student, false)
			h.room.hub.SendTo(roomID, student, encode(roomAdmitted, gin.H{}))
		}
		h.cardChanged(ctx, id, st)
	}
}

// admit is the teacher admitting students to the exam (SPEC-096 section 5).
func (h *Handler) admit(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	var body struct {
		StudentIDs []uuid.UUID `json:"studentIds"`
	}
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || body.StudentIDs == nil {
		malformed(c)
		return
	}
	got, err := h.svc.Admit(c.Request.Context(), actor, classID, id, body.StudentIDs)
	if err != nil {
		failWith(c, err)
		return
	}
	h.admitted(c.Request.Context(), id, got)
	c.JSON(http.StatusOK, gin.H{"admitted": got})
}

// finish is the teacher finishing the whole exam: every student in the room is told, and the window locks (SPEC-096 section 5, CA-05).
func (h *Handler) finish(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	got, err := h.svc.Finish(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	if h.room != nil {
		roomID := id.String()
		h.room.mu.Lock()
		var students []string
		for st := range h.room.present[roomID] {
			students = append(students, st)
		}
		h.room.mu.Unlock()
		for _, st := range students {
			h.room.hub.SendTo(roomID, st, encode(roomEnded, gin.H{"reason": domain.FinishReason, "finished": true}))
		}
	}
	c.JSON(http.StatusOK, gin.H{"finishedAt": iso(got.FinishedAt), "finishedBy": got.FinishedBy, "finishedByName": got.FinishedByName,
		"ended": len(got.Ended), "absent": got.Absent})
}

// cardChanged sends the teacher the card of a student that changed (SPEC-091 RN-04).
func (h *Handler) cardChanged(ctx context.Context, id, studentID uuid.UUID) {
	if h.room == nil || !h.room.hub.KindConnected(id.String(), viewRoom) {
		return
	}
	card, err := h.svc.RoomCard(ctx, id, studentID)
	if err != nil {
		return
	}
	h.room.hub.SendToKind(id.String(), viewRoom, encode(roomStudent, h.room.cardJSON(id.String(), card)))
}

func (h *Handler) sendQueue(ctx context.Context, id uuid.UUID) {
	queue, err := h.svc.HelpQueue(ctx, id)
	if err != nil {
		return
	}
	list := make([]gin.H, len(queue))
	for i, q := range queue {
		list[i] = helpJSON(q)
	}
	h.room.hub.SendToKind(id.String(), viewRoom, encode(helpQueue, gin.H{"queue": list}))
}

// endAttempt is the teacher ending the exam of a student, who is told at once (SPEC-091 RN-08).
func (h *Handler) endAttempt(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	attemptID, ok := uuidParam(c, "attemptId")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		malformed(c)
		return
	}
	row, err := h.svc.EndAttempt(c.Request.Context(), actor, classID, id, attemptID, body.Reason)
	if err != nil {
		failWith(c, err)
		return
	}
	if h.room != nil {
		h.room.hub.SendTo(id.String(), row.StudentID.String(), encode(roomEnded, gin.H{"reason": row.EndReason}))
		h.cardChanged(c.Request.Context(), id, row.StudentID)
	}
	c.JSON(http.StatusOK, attemptRowJSON(row))
}

// ---- the hub ----

type roomHandler struct {
	h *Handler
	r *room
}

func (rh roomHandler) Snapshot(ctx context.Context, roomID string, who hub.Identity) (hub.Message, error) {
	id, err := uuid.Parse(roomID)
	if err != nil {
		return hub.Message{}, err
	}
	if who.Role == hub.Controller {
		state, err := rh.h.svc.RoomState(ctx, id)
		if err != nil {
			return hub.Message{}, err
		}
		cards := make([]gin.H, len(state.Cards))
		for i, c := range state.Cards {
			cards[i] = rh.r.cardJSON(roomID, c)
		}
		queue := make([]gin.H, len(state.Queue))
		for i, q := range state.Queue {
			queue[i] = helpJSON(q)
		}
		data := gin.H{"endsAt": iso(state.EndsAt), "cards": cards, "queue": queue, "serverNow": iso(rh.h.svc.Now()), "startedByName": state.StartedByName}
		if state.StartedAt != nil {
			data["startedAt"] = iso(*state.StartedAt)
		}
		rh.r.mu.Lock()
		if w := rh.r.watching[roomID]; w != "" {
			data["watching"] = w
		}
		rh.r.mu.Unlock()
		chat, err := rh.h.svc.RoomChat(ctx, id)
		if err != nil {
			return hub.Message{}, err
		}
		data["chat"] = chatListJSON(chat)
		return encode(roomSnapshot, data), nil
	}
	student := uuid.MustParse(who.UserID)
	help, err := rh.h.svc.MyHelp(ctx, id, student)
	if err != nil {
		return hub.Message{}, err
	}
	chat, err := rh.h.svc.StudentChat(ctx, id, student)
	if err != nil {
		return hub.Message{}, err
	}
	rh.r.mu.Lock()
	started := rh.r.started[roomID]
	rh.r.mu.Unlock()
	return encode(roomSnapshot, gin.H{"waiting": who.Waiting, "started": started, "help": stateJSON(help), "chat": chatListJSON(chat)}), nil
}

func (rh roomHandler) Joined(roomID string, who hub.Identity) {
	if who.Role == hub.Controller {
		return
	}
	rh.r.mu.Lock()
	if rh.r.present[roomID] == nil {
		rh.r.present[roomID] = map[string]bool{}
	}
	rh.r.present[roomID][who.UserID] = who.Waiting
	watched := rh.r.watching[roomID] == who.UserID
	rh.r.mu.Unlock()
	if watched {
		rh.r.hub.SendTo(roomID, who.UserID, encode(roomWatchOn, gin.H{}))
	}
	rh.h.cardChanged(context.Background(), uuid.MustParse(roomID), uuid.MustParse(who.UserID))
}

func (rh roomHandler) Left(roomID string, who hub.Identity) {
	if who.Role == hub.Controller {
		return
	}
	rh.r.mu.Lock()
	delete(rh.r.present[roomID], who.UserID)
	rh.r.mu.Unlock()
	rh.h.cardChanged(context.Background(), uuid.MustParse(roomID), uuid.MustParse(who.UserID))
}

func (rh roomHandler) Dropped(roomID string, who hub.Identity, msgType, reason string) {
	rh.r.log.Debug("exam room message dropped", zap.String("room", roomID), zap.String("userId", who.UserID), zap.String("type", msgType), zap.String("reason", reason))
}

func (rh roomHandler) Message(ctx context.Context, roomID string, who hub.Identity, msg hub.Message) {
	id, err := uuid.Parse(roomID)
	if err != nil {
		return
	}
	user, err := uuid.Parse(who.UserID)
	if err != nil {
		return
	}
	switch msg.Type {
	case roomWatch:
		rh.watch(ctx, id, msg.Data)
	case roomScreen:
		rh.r.mu.Lock()
		watched := rh.r.watching[roomID] == who.UserID
		rh.r.mu.Unlock()
		if !watched {
			return
		}
		var body struct {
			Position int             `json:"position"`
			Title    string          `json:"title"`
			Screen   json.RawMessage `json:"screen"`
		}
		if json.Unmarshal(msg.Data, &body) != nil {
			return
		}
		rh.r.hub.SendToKind(roomID, viewRoom, encode(roomScreen, gin.H{"studentId": who.UserID, "position": body.Position, "title": body.Title, "screen": body.Screen}))
	case roomQuestion:
		var q question
		if who.Role == hub.Controller || json.Unmarshal(msg.Data, &q) != nil || q.Position <= 0 {
			return
		}
		if runes := []rune(q.Title); len(runes) > maxQuestionTitle {
			q.Title = string(runes[:maxQuestionTitle])
		}
		rh.r.mu.Lock()
		if rh.r.questions[roomID] == nil {
			rh.r.questions[roomID] = map[string]question{}
		}
		rh.r.questions[roomID][who.UserID] = q
		rh.r.mu.Unlock()
		rh.h.cardChanged(ctx, id, user)
	case roomCommand:
		var body struct {
			Position int        `json:"position"`
			Command  string     `json:"command"`
			Output   string     `json:"output"`
			At       *time.Time `json:"at"`
		}
		if json.Unmarshal(msg.Data, &body) != nil {
			return
		}
		got, err := rh.h.svc.RecordCommand(ctx, id, user, service.CommandInput{Position: body.Position, Command: body.Command, Output: body.Output, At: body.At})
		if err != nil {
			return
		}
		rh.r.hub.SendToKind(roomID, viewRoom, encode(roomCommand, gin.H{"studentId": who.UserID, "command": commandJSON(got)}))
	case helpRaise:
		var body struct {
			Position *int   `json:"position"`
			Question string `json:"question"`
		}
		if json.Unmarshal(msg.Data, &body) != nil {
			return
		}
		got, err := rh.h.svc.RaiseHand(ctx, id, user, body.Position, body.Question)
		if err != nil {
			return
		}
		rh.r.hub.SendTo(roomID, who.UserID, encode(helpState, stateJSON(&got)))
		rh.h.sendQueue(ctx, id)
		rh.h.cardChanged(ctx, id, user)
	case helpLower:
		if rh.h.svc.LowerHand(ctx, id, user) != nil {
			return
		}
		mine, _ := rh.h.svc.MyHelp(ctx, id, user)
		rh.r.hub.SendTo(roomID, who.UserID, encode(helpState, stateJSON(mine)))
		rh.h.sendQueue(ctx, id)
		rh.h.cardChanged(ctx, id, user)
	case helpAnswer:
		var body struct {
			RequestID uuid.UUID `json:"requestId"`
			Answer    string    `json:"answer"`
		}
		if json.Unmarshal(msg.Data, &body) != nil {
			return
		}
		got, err := rh.h.svc.AnswerHelp(ctx, id, user, body.RequestID, body.Answer)
		if err != nil {
			return
		}
		rh.r.hub.SendTo(roomID, got.StudentID.String(), encode(helpState, stateJSON(&got)))
		rh.h.sendQueue(ctx, id)
		rh.h.cardChanged(ctx, id, got.StudentID)
	case chatSend:
		rh.chat(ctx, id, who, msg.Data)
	}
}

// chat stores a message of the conversation and gives it only to whom it is for: the teacher and the student of the conversation, or the teacher and
// every student doing the exam (SPEC-093 RN-01, RN-05). A message out of the rules goes nowhere.
func (rh roomHandler) chat(ctx context.Context, id uuid.UUID, who hub.Identity, data json.RawMessage) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return
	}
	var body struct {
		Text      string     `json:"text"`
		StudentID *uuid.UUID `json:"studentId"`
		To        string     `json:"to"`
	}
	if json.Unmarshal(data, &body) != nil {
		return
	}
	roomID := id.String()
	user := uuid.MustParse(who.UserID)
	positionOf := func(student string) *int {
		rh.r.mu.Lock()
		defer rh.r.mu.Unlock()
		if q, ok := rh.r.questions[roomID][student]; ok {
			return &q.Position
		}
		return nil
	}
	if who.Role != hub.Controller {
		if len(fields) != 1 || fields["text"] == nil {
			return
		}
		got, err := rh.h.svc.SendStudentChat(ctx, id, user, positionOf(who.UserID), body.Text)
		if err != nil {
			return
		}
		out := encode(chatMessage, chatJSON(got))
		rh.r.hub.SendToKind(roomID, viewRoom, out)
		rh.r.hub.SendTo(roomID, who.UserID, out)
		return
	}
	if who.Kind != viewRoom || (body.StudentID != nil) == (body.To == "all") || (body.To != "" && body.To != "all") {
		return
	}
	var position *int
	if body.StudentID != nil {
		position = positionOf(body.StudentID.String())
	}
	got, to, err := rh.h.svc.SendTeacherChat(ctx, id, user, body.StudentID, position, body.Text)
	if err != nil {
		return
	}
	out := encode(chatMessage, chatJSON(got))
	rh.r.hub.SendToKind(roomID, viewRoom, out)
	for _, student := range to {
		rh.r.hub.SendTo(roomID, student.String(), out)
	}
}

// attemptChat is the whole conversation of an attempt, for the teacher who reads it after (SPEC-093 RN-07).
func (h *Handler) attemptChat(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	attemptID, ok := uuidParam(c, "attemptId")
	if !ok {
		return
	}
	lines, err := h.svc.AttemptChat(c.Request.Context(), actor, classID, id, attemptID)
	if err != nil {
		failWith(c, err)
		return
	}
	out := make([]gin.H, len(lines))
	for i, l := range lines {
		out[i] = chatJSON(l.ChatMessage)
		out[i]["senderName"] = l.SenderName
	}
	c.JSON(http.StatusOK, gin.H{"messages": out})
}

// watch makes the teacher follow one student, or nobody: the one left stops sending the screen, the new one starts, and the teacher gets the
// commands stored of the new one (SPEC-091 RN-05, RN-06).
func (rh roomHandler) watch(ctx context.Context, id uuid.UUID, data json.RawMessage) {
	var body struct {
		StudentID *uuid.UUID `json:"studentId"`
	}
	if json.Unmarshal(data, &body) != nil {
		return
	}
	roomID := id.String()
	next := ""
	if body.StudentID != nil {
		next = body.StudentID.String()
	}
	rh.r.mu.Lock()
	prev := rh.r.watching[roomID]
	rh.r.watching[roomID] = next
	rh.r.mu.Unlock()
	if prev != "" && prev != next {
		rh.r.hub.SendTo(roomID, prev, encode(roomWatchOff, gin.H{}))
	}
	if next == "" {
		return
	}
	rh.r.hub.SendTo(roomID, next, encode(roomWatchOn, gin.H{}))
	commands, err := rh.h.svc.StudentCommands(ctx, id, *body.StudentID)
	if err != nil {
		return
	}
	list := make([]gin.H, len(commands))
	for i, c := range commands {
		list[i] = commandJSON(c)
	}
	rh.r.hub.SendToKind(roomID, viewRoom, encode(roomCommands, gin.H{"studentId": next, "commands": list}))
}

func commandJSON(c domain.AttemptCommand) gin.H {
	return gin.H{"position": c.Position, "command": c.Command, "output": c.Output, "executedAt": iso(c.ExecutedAt)}
}

// attemptRowJSON is an attempt in the list of the teacher, with who ended it and why (SPEC-090 RN-09, SPEC-091 RN-08).
func attemptRowJSON(r service.AttemptRow) gin.H {
	row := gin.H{"studentId": r.StudentID, "studentName": r.StudentName, "academicId": r.AcademicID, "status": r.Status, "chatCount": r.ChatCount}
	if r.AttemptID != uuid.Nil { // the absent have no attempt (SPEC-096 RN-06)
		row["attemptId"], row["startedAt"] = r.AttemptID, iso(r.StartedAt)
	}
	if r.SubmittedAt != nil {
		row["submittedAt"] = iso(*r.SubmittedAt)
	}
	if r.PreliminaryScore != nil {
		row["preliminaryScore"] = r.PreliminaryScore.Float()
	}
	if r.PendingItems != nil {
		row["pendingItems"] = *r.PendingItems
	}
	if r.EndedByName != "" {
		row["endedByName"] = r.EndedByName
	}
	if r.EndReason != "" {
		row["endReason"] = r.EndReason
	}
	return row
}
