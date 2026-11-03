package handler_test

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

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// ---- the room of the fake service (SPEC-091) ----

type roomFake struct {
	mu       sync.Mutex
	started  bool
	enterErr error
	commands []service.CommandInput
	queue    []domain.HelpRequest
	help     map[uuid.UUID]*domain.HelpRequest
}

var rooms sync.Map // *fakeService -> *roomFake

func (f *fakeService) room() *roomFake {
	r, _ := rooms.LoadOrStore(f, &roomFake{help: map[uuid.UUID]*domain.HelpRequest{}})
	return r.(*roomFake)
}

func (f *fakeService) EnterRoom(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.RoomEntry, error) {
	r := f.room()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.enterErr != nil {
		return service.RoomEntry{}, r.enterErr
	}
	if a.Role == authn.RoleStudent {
		return service.RoomEntry{Waiting: !r.started}, nil
	}
	return service.RoomEntry{Controller: true}, nil
}

func (f *fakeService) RoomState(_ context.Context, id uuid.UUID) (service.RoomState, error) {
	return service.RoomState{EndsAt: at(21, 11, 0), Cards: []service.RoomCard{{StudentID: roomStudent, Name: "Ana", AcademicID: "1000001", Status: "ABSENT", Total: 5}}}, nil
}

func (f *fakeService) RoomCard(_ context.Context, id, studentID uuid.UUID) (service.RoomCard, error) {
	return service.RoomCard{StudentID: studentID, Name: "Ana", AcademicID: "1000001", Status: "IN_PROGRESS", Total: 5, Answered: 1}, nil
}

func (f *fakeService) RecordCommand(_ context.Context, id, studentID uuid.UUID, in service.CommandInput) (domain.AttemptCommand, error) {
	r := f.room()
	r.mu.Lock()
	r.commands = append(r.commands, in)
	r.mu.Unlock()
	return domain.AttemptCommand{Position: in.Position, Command: in.Command, Output: in.Output, ExecutedAt: at(21, 9, 30)}, nil
}

func (f *fakeService) StudentCommands(_ context.Context, id, studentID uuid.UUID) ([]domain.AttemptCommand, error) {
	return []domain.AttemptCommand{{Position: 4, Command: "pwd", Output: "/root", ExecutedAt: at(21, 9, 10)}}, nil
}

func (f *fakeService) RaiseHand(_ context.Context, id, studentID uuid.UUID, position *int, question string) (domain.HelpRequest, error) {
	r := f.room()
	r.mu.Lock()
	defer r.mu.Unlock()
	h := domain.HelpRequest{ID: uuid.New(), AssessmentID: id, StudentID: studentID, Position: position, Question: question, Status: domain.HelpOpen, CreatedAt: at(21, 9, 31)}
	r.queue = append(r.queue, h)
	r.help[studentID] = &h
	return h, nil
}

func (f *fakeService) LowerHand(_ context.Context, id, studentID uuid.UUID) error {
	r := f.room()
	r.mu.Lock()
	defer r.mu.Unlock()
	r.queue = nil
	if h := r.help[studentID]; h != nil {
		h.Status = domain.HelpCanceled
	}
	return nil
}

func (f *fakeService) AnswerHelp(_ context.Context, id, teacherID, requestID uuid.UUID, answer string) (domain.HelpRequest, error) {
	r := f.room()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, h := range r.help {
		if h.ID == requestID {
			h.Status, h.Answer = domain.HelpAnswered, answer
			r.queue = nil
			return *h, nil
		}
	}
	return domain.HelpRequest{}, domain.ErrHelpNotFound
}

func (f *fakeService) HelpQueue(_ context.Context, id uuid.UUID) ([]domain.HelpRequest, error) {
	r := f.room()
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]domain.HelpRequest(nil), r.queue...), nil
}

func (f *fakeService) MyHelp(_ context.Context, id, studentID uuid.UUID) (*domain.HelpRequest, error) {
	r := f.room()
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.help[studentID], nil
}

func (f *fakeService) EndAttempt(_ context.Context, a service.Actor, classID, id, attemptID uuid.UUID, reason string) (service.AttemptRow, error) {
	f.saw("EndAttempt", a)
	if f.err != nil {
		return service.AttemptRow{}, f.err
	}
	score := domain.Points(2)
	return service.AttemptRow{AttemptID: attemptID, StudentID: roomStudent, StudentName: "Ana", Status: domain.AttemptEndedByTeacher, StartedAt: at(21, 9, 10),
		SubmittedAt: ptr(at(21, 10, 0)), PreliminaryScore: &score, EndedByName: "Profa. Sediane", EndReason: reason}, nil
}

// ---- the world of the room: one server, a teacher and two students, told apart by the cookie ----

var (
	roomTeacher = uuid.New()
	roomStudent = uuid.New()
	roomOther   = uuid.New()
)

type cookieValidator struct{}

func (cookieValidator) Authenticate(_ context.Context, token string) (authn.Principal, error) {
	switch token {
	case "teacher":
		return authn.Principal{UserID: roomTeacher, Role: authn.RoleTeacher}, nil
	case "ana":
		return authn.Principal{UserID: roomStudent, Role: authn.RoleStudent}, nil
	case "bruno":
		return authn.Principal{UserID: roomOther, Role: authn.RoleStudent}, nil
	}
	return authn.Principal{}, errors.New("unknown session")
}

type roomWorld struct {
	srv           *httptest.Server
	svc           *fakeService
	classID, exam uuid.UUID
}

func roomSetup(t *testing.T) *roomWorld {
	t.Helper()
	svc := &fakeService{now: at(21, 9, 0)}
	h := handler.New(svc, cookieValidator{}).WithRoom(zap.NewNop(), handler.RoomOptions{AnyOrigin: true})
	w := &roomWorld{srv: httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h)), svc: svc, classID: uuid.New(), exam: uuid.New()}
	t.Cleanup(w.srv.Close)
	return w
}

func (w *roomWorld) dial(t *testing.T, token string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(w.srv.URL, "http") + "/api/v1/classes/" + w.classID.String() + "/assessments/" + w.exam.String() + "/room/ws"
	c, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Cookie": []string{authn.CookieName + "=" + token}})
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

type wsMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func readType(t *testing.T, c *websocket.Conn, typ string) wsMessage {
	t.Helper()
	for i := 0; i < 30; i++ {
		_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
		var m wsMessage
		require.NoError(t, c.ReadJSON(&m), "waiting for "+typ)
		if m.Type == typ {
			return m
		}
	}
	require.FailNow(t, "message not received", typ)
	return wsMessage{}
}

// silent asserts that none of the types arrives in a short while.
func silent(t *testing.T, c *websocket.Conn, types ...string) {
	t.Helper()
	for {
		_ = c.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		var m wsMessage
		if err := c.ReadJSON(&m); err != nil {
			return
		}
		for _, typ := range types {
			assert.NotEqual(t, typ, m.Type, "the student must not receive it")
		}
	}
}

func sendWS(t *testing.T, c *websocket.Conn, typ string, data any) {
	t.Helper()
	raw, err := json.Marshal(data)
	require.NoError(t, err)
	require.NoError(t, c.WriteJSON(wsMessage{Type: typ, Data: raw}))
}

func object2(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var out map[string]any
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

// ---- the tests ----

// Covers SPEC-091 CA-01, CA-02 (RN-01, RN-02): the teacher gets the whole state; a student who comes before the start waits and is admitted when the
// teacher starts; the teacher sees the student come and the start happen.
func TestRoom_WaitingRoomAndTheStart(t *testing.T) {
	w := roomSetup(t)
	teacher := w.dial(t, "teacher")
	snap := object2(t, readType(t, teacher, "room:snapshot").Data)
	cards := snap["cards"].([]any)
	require.Len(t, cards, 1)
	assert.Equal(t, "Ana", cards[0].(map[string]any)["name"])
	assert.Contains(t, snap, "queue")

	ana := w.dial(t, "ana")
	mine := object2(t, readType(t, ana, "room:snapshot").Data)
	assert.Equal(t, true, mine["waiting"])
	card := object2(t, readType(t, teacher, "room:student").Data)
	assert.Equal(t, roomStudent.String(), card["studentId"])
	assert.NotContains(t, card, "attemptId", "no attempt yet")
	assert.Equal(t, true, card["online"])
	assert.Equal(t, true, card["waiting"])

	w.svc.room().mu.Lock()
	w.svc.room().started = true
	w.svc.room().mu.Unlock()
	w.svc.summary = service.Summary{Public: minimalPublic(), Modality: domain.ModalityOnline, StartedAt: ptr(at(21, 9, 5)), StartedByName: "Profa. Sediane"}
	req, err := http.NewRequest(http.MethodPost, w.srv.URL+"/api/v1/classes/"+w.classID.String()+"/assessments/"+w.exam.String()+"/start", nil)
	require.NoError(t, err)
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "teacher"})
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	readType(t, ana, "room:admitted")
	started := object2(t, readType(t, teacher, "room:started").Data)
	assert.Equal(t, "Profa. Sediane", started["startedByName"])

	bruno := w.dial(t, "bruno")
	assert.Equal(t, false, object2(t, readType(t, bruno, "room:snapshot").Data)["waiting"], "after the start a student is in at once")
}

// Covers SPEC-091 CA-01 (RN-01): who may not enter the room is refused before the connection, with the reason.
func TestRoom_RefusedBeforeTheConnection(t *testing.T) {
	w := roomSetup(t)
	url := "ws" + strings.TrimPrefix(w.srv.URL, "http") + "/api/v1/classes/" + w.classID.String() + "/assessments/" + w.exam.String() + "/room/ws"
	for err, status := range map[error]int{domain.ErrForbidden: http.StatusForbidden, domain.ErrAssessmentEnded: http.StatusConflict, domain.ErrNotEligible: http.StatusForbidden} {
		w.svc.room().enterErr = err
		_, res, dialErr := websocket.DefaultDialer.Dial(url, http.Header{"Cookie": []string{authn.CookieName + "=ana"}})
		require.Error(t, dialErr)
		require.NotNil(t, res)
		assert.Equal(t, status, res.StatusCode, err.Error())
	}
	w.svc.room().enterErr = nil
	_, res, err := websocket.DefaultDialer.Dial(url, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}

// Covers SPEC-091 CA-05, CA-06, CA-09 (RN-05, RN-06, RN-10): the teacher watches one student, who starts sending the screen, which only the teacher
// gets; the commands are stored and reach the teacher, with the stored ones when she opens the student; the other student gets none of it.
func TestRoom_WatchScreenAndCommands(t *testing.T) {
	w := roomSetup(t)
	w.svc.room().started = true
	teacher := w.dial(t, "teacher")
	readType(t, teacher, "room:snapshot")
	ana := w.dial(t, "ana")
	readType(t, ana, "room:snapshot")
	bruno := w.dial(t, "bruno")
	readType(t, bruno, "room:snapshot")

	sendWS(t, teacher, "room:watch", map[string]any{"studentId": roomStudent.String()})
	readType(t, ana, "room:watch-on")
	stored := object2(t, readType(t, teacher, "room:commands").Data)
	assert.Equal(t, roomStudent.String(), stored["studentId"])
	assert.Len(t, stored["commands"], 1)

	sendWS(t, ana, "room:screen", map[string]any{"position": 4, "title": "Criar pasta", "screen": map[string]any{"lines": []string{"$ ls"}}})
	screen := object2(t, readType(t, teacher, "room:screen").Data)
	assert.Equal(t, roomStudent.String(), screen["studentId"])
	assert.EqualValues(t, 4, screen["position"])
	assert.Equal(t, "Criar pasta", screen["title"], "the question the student is in")

	sendWS(t, ana, "room:command", map[string]any{"position": 4, "command": "mkdir /a", "output": ""})
	command := object2(t, readType(t, teacher, "room:command").Data)
	assert.Equal(t, roomStudent.String(), command["studentId"])
	assert.Equal(t, "mkdir /a", command["command"].(map[string]any)["command"])
	require.Eventually(t, func() bool {
		w.svc.room().mu.Lock()
		defer w.svc.room().mu.Unlock()
		return len(w.svc.room().commands) == 1
	}, time.Second, 20*time.Millisecond, "the command was stored")

	sendWS(t, teacher, "room:watch", map[string]any{"studentId": nil})
	readType(t, ana, "room:watch-off")
	silent(t, bruno, "room:screen", "room:command", "room:commands", "room:student", "help:queue", "room:watch-on")
}

// Covers SPEC-091 CA-07 (RN-07, D-03): the student raises the hand and the teacher gets the queue; the teacher answers with a text and the student
// reads it.
func TestRoom_Help(t *testing.T) {
	w := roomSetup(t)
	w.svc.room().started = true
	teacher := w.dial(t, "teacher")
	readType(t, teacher, "room:snapshot")
	ana := w.dial(t, "ana")
	readType(t, ana, "room:snapshot")

	sendWS(t, ana, "help:raise", map[string]any{"position": 2, "question": "Posso usar o manual?"})
	state := object2(t, readType(t, ana, "help:state").Data)
	assert.Equal(t, "OPEN", state["status"])
	queue := object2(t, readType(t, teacher, "help:queue").Data)["queue"].([]any)
	require.Len(t, queue, 1)
	request := queue[0].(map[string]any)
	assert.Equal(t, "Posso usar o manual?", request["question"])
	assert.Equal(t, roomStudent.String(), request["studentId"])

	sendWS(t, teacher, "help:answer", map[string]any{"requestId": request["id"], "answer": "Não, só o terminal."})
	state = object2(t, readType(t, ana, "help:state").Data)
	assert.Equal(t, "ANSWERED", state["status"])
	assert.Equal(t, "Não, só o terminal.", state["answer"])
	assert.Empty(t, object2(t, readType(t, teacher, "help:queue").Data)["queue"])
}

// Covers SPEC-091 CA-08 (RN-08, section 5): the teacher ends the exam of a student by the route, with the reason; the student is told at once.
func TestRoom_EndTheExamOfAStudent(t *testing.T) {
	w := roomSetup(t)
	w.svc.room().started = true
	ana := w.dial(t, "ana")
	readType(t, ana, "room:snapshot")

	attempt := uuid.New()
	end := func(body string) *http.Response {
		req, err := http.NewRequest(http.MethodPost, w.srv.URL+"/api/v1/classes/"+w.classID.String()+"/assessments/"+w.exam.String()+"/attempts/"+attempt.String()+"/end", strings.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "teacher"})
		res, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		return res
	}
	res := end(`{"reason":"Flagrante de cola"}`)
	var row map[string]any
	require.NoError(t, json.NewDecoder(res.Body).Decode(&row))
	_ = res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "ENDED_BY_TEACHER", row["status"])
	assert.Equal(t, "Profa. Sediane", row["endedByName"])
	assert.Equal(t, "Flagrante de cola", row["endReason"])
	ended := object2(t, readType(t, ana, "room:ended").Data)
	assert.Equal(t, "Flagrante de cola", ended["reason"])

	w.svc.err = domain.ErrInvalidReason
	res = end(`{"reason":""}`)
	_ = res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

// Covers SPEC-092 CA-12 (revision 2): the student tells the question she is in; the room keeps the last one and puts it on the card, in the
// room:student and in the snapshot; the title is cut at 200 characters; a question from the teacher, or with no position, is dropped.
func TestRoom_QuestionOfTheStudent(t *testing.T) {
	w := roomSetup(t)
	w.svc.room().started = true
	teacher := w.dial(t, "teacher")
	readType(t, teacher, "room:snapshot")
	ana := w.dial(t, "ana")
	readType(t, ana, "room:snapshot")
	readType(t, teacher, "room:student")

	sendWS(t, ana, "room:question", map[string]any{"position": 4, "title": "Criar pasta"})
	card := object2(t, readType(t, teacher, "room:student").Data)
	assert.Equal(t, map[string]any{"position": float64(4), "title": "Criar pasta"}, card["question"])

	sendWS(t, ana, "room:question", map[string]any{"position": 5, "title": strings.Repeat("x", 250)})
	card = object2(t, readType(t, teacher, "room:student").Data)
	assert.Len(t, card["question"].(map[string]any)["title"], 200)

	again := w.dial(t, "teacher")
	snap := object2(t, readType(t, again, "room:snapshot").Data)
	assert.EqualValues(t, 5, snap["cards"].([]any)[0].(map[string]any)["question"].(map[string]any)["position"], "the snapshot brings the question")

	sendWS(t, ana, "room:question", map[string]any{"position": 0, "title": "Nada"})
	sendWS(t, again, "room:question", map[string]any{"position": 2, "title": "Da docente"})
	silent(t, again, "room:student")
}
