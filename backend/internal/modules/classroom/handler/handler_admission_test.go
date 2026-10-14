package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- test doubles of the waiting room, the broadcast and the module of the room (SPEC-054) ----

// stateOf is the admission of a student; the first time it is the one the test chose (waiting or, as before, admitted).
func (f *fakeService) stateOf(id uuid.UUID) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.states == nil {
		f.states = map[uuid.UUID]string{}
	}
	if f.states[id] == "" {
		f.states[id] = domain.AdmissionAdmitted
		if f.waiting {
			f.states[id] = domain.AdmissionWaiting
		}
	}
	return f.states[id]
}

func (f *fakeService) lists() service.Admissions {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := service.Admissions{Waiting: []domain.AdmissionEntry{}, Admitted: []domain.AdmissionEntry{}}
	for id, st := range f.states {
		e := domain.AdmissionEntry{StudentID: id, Name: "Ana", Status: st, RequestedAt: time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)}
		switch st {
		case domain.AdmissionWaiting:
			out.Waiting = append(out.Waiting, e)
		case domain.AdmissionAdmitted:
			out.Admitted = append(out.Admitted, e)
		}
	}
	return out
}

func (f *fakeService) set(id uuid.UUID, st string) {
	f.mu.Lock()
	f.states[id] = st
	f.decided = append(f.decided, st+":"+id.String())
	f.mu.Unlock()
}

func (f *fakeService) AdmissionState(_ context.Context, _, student uuid.UUID) (string, error) {
	return f.stateOf(student), nil
}
func (f *fakeService) Admissions(context.Context, uuid.UUID) (service.Admissions, error) {
	return f.lists(), nil
}
func (f *fakeService) Admit(_ context.Context, a service.Actor, _, student uuid.UUID) (service.Admissions, error) {
	f.actor = a
	f.stateOf(student)
	f.set(student, domain.AdmissionAdmitted)
	return f.lists(), nil
}
func (f *fakeService) AdmitAll(_ context.Context, a service.Actor, _ uuid.UUID) ([]uuid.UUID, service.Admissions, error) {
	f.actor = a
	var ids []uuid.UUID
	f.mu.Lock()
	for id, st := range f.states {
		if st == domain.AdmissionWaiting {
			ids = append(ids, id)
		}
	}
	f.mu.Unlock()
	for _, id := range ids {
		f.set(id, domain.AdmissionAdmitted)
	}
	return ids, f.lists(), nil
}
func (f *fakeService) Remove(_ context.Context, a service.Actor, _, student uuid.UUID) (service.Admissions, error) {
	f.actor = a
	f.set(student, domain.AdmissionRemoved)
	return f.lists(), nil
}
func (f *fakeService) RequestAgain(_ context.Context, _, student uuid.UUID) (string, error) {
	if f.stateOf(student) == domain.AdmissionRemoved {
		f.set(student, domain.AdmissionWaiting)
	}
	return f.stateOf(student), nil
}
func (f *fakeService) FocusModuleBlock(_ context.Context, _ uuid.UUID, blockID string) error {
	f.mu.Lock()
	f.focus = append(f.focus, blockID)
	f.mu.Unlock()
	return nil
}
func (f *fakeService) SetTerminalBroadcast(_ uuid.UUID, on bool) {
	f.mu.Lock()
	f.broadcast = on
	f.mu.Unlock()
}
func (f *fakeService) TerminalBroadcasting(uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.broadcast
}
func (f *fakeService) ModuleOfRoom(_ context.Context, a service.Actor, _ uuid.UUID) (service.ModuleView, error) {
	f.moduleFor = a
	return f.moduleView, f.moduleErr
}

func (w *world) waitingRoom() { w.svc.waiting = true }

func queueOf(t *testing.T, m message) (waiting, admitted []map[string]any) {
	t.Helper()
	var q struct {
		Waiting  []map[string]any `json:"waiting"`
		Admitted []map[string]any `json:"admitted"`
	}
	require.NoError(t, json.Unmarshal(m.Data, &q))
	return q.Waiting, q.Admitted
}

func statusOf(t *testing.T, m message) string {
	t.Helper()
	var d struct {
		Status string `json:"status"`
	}
	require.NoError(t, json.Unmarshal(m.Data, &d))
	return d.Status
}

// ---- WebSocket: the waiting room ----

// Covers SPEC-054 CA-01 and RN-01, RN-02: a student comes in waiting, gets only his state, and nothing of the stage reaches him.
func TestWaitingStudent_GetsOnlyTheAdmissionState(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")

	first := readMsg(t, student)
	assert.Equal(t, "live:admission:state", first.Type, "no snapshot for who is waiting")
	assert.Equal(t, "WAITING", statusOf(t, first))

	waiting, admitted := queueOf(t, readUntil(t, teacher, "live:admission:queue"))
	require.Len(t, waiting, 1)
	assert.Equal(t, w.student.UserID.String(), waiting[0]["studentId"])
	assert.Equal(t, "Ana", waiting[0]["name"])
	assert.NotEmpty(t, waiting[0]["requestedAt"])
	assert.Empty(t, admitted)

	sendMsg(t, teacher, "live:slide:change", `{"slide":3}`)
	sendMsg(t, teacher, "live:cursor:move", `{"x":1,"y":2}`)
	sendMsg(t, teacher, "live:canvas:draw", `{"path":[[1,2]]}`)
	nothingMore(t, student, "live:slide:change", "live:cursor:move", "live:canvas:draw", "live:snapshot", "live:presence", "live:hand:queue")
}

// Covers SPEC-054 CA-05 and RN-03: what a waiting student sends is dropped with an audit entry; asking to come in is the one exception.
func TestWaitingStudent_MessagesAreDropped(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")

	sendMsg(t, student, "live:hand:raise", `{}`)
	sendMsg(t, student, "live:hand:lower", `{}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 2 })
	assert.Equal(t, 0, w.svc.called("raise"))
	assert.Equal(t, 0, w.svc.called("lower"))
	entry := w.logs.FilterMessage("classroom message dropped").All()[0].ContextMap()
	assert.Equal(t, "not-admitted", entry["reason"])
	assert.Equal(t, w.student.UserID.String(), entry["userId"])

	sendMsg(t, student, "live:admission:request", `{}`)
	assert.Equal(t, "WAITING", statusOf(t, readUntil(t, student, "live:admission:state")), "asking while waiting only repeats the state")
}

// Covers SPEC-054 CA-02: accepting releases the stage to the student, with the snapshot, and the teacher sees the new lists.
func TestAccept_ReleasesTheStage(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	w.svc.active = service.Active{Found: true, Session: w.session, ModuleFocusBlockID: "b-2", TerminalBroadcast: true}
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")
	readUntil(t, teacher, "live:admission:queue")

	sendMsg(t, teacher, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, readUntil(t, student, "live:admission:state")))
	var snap map[string]any
	require.NoError(t, json.Unmarshal(readUntil(t, student, "live:snapshot").Data, &snap))
	assert.EqualValues(t, 2, snap["currentSlide"])
	assert.Equal(t, "b-2", snap["moduleFocusBlockId"])
	assert.Equal(t, true, snap["terminalBroadcast"])
	assert.NotContains(t, snap, "admissions", "the lists of the waiting room are for the teacher")

	waiting, admitted := queueOf(t, readUntil(t, teacher, "live:admission:queue"))
	assert.Empty(t, waiting)
	require.Len(t, admitted, 1)
	assert.Equal(t, w.student.UserID.String(), admitted[0]["studentId"])
}

// Covers SPEC-054 CA-02 and RN-02: once admitted the student receives the room, and may raise his hand.
func TestAdmittedStudent_ReceivesTheRoom(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")
	readUntil(t, teacher, "live:admission:queue")

	sendMsg(t, teacher, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	readUntil(t, student, "live:snapshot")
	assert.Equal(t, w.teacher.UserID, w.svc.actor.UserID, "the service is told who decided")
	assert.Equal(t, authn.RoleTeacher, w.svc.actor.Role)

	sendMsg(t, teacher, "live:slide:change", `{"slide":5}`)
	assert.JSONEq(t, `{"slide":5}`, string(readUntil(t, student, "live:slide:change").Data))
	assert.JSONEq(t, `{"online":1}`, string(readUntil(t, teacher, "live:presence").Data), "the admitted counts online")

	sendMsg(t, student, "live:hand:raise", `{}`)
	readUntil(t, teacher, "live:hand:queue")
	assert.Equal(t, 1, w.svc.called("raise"))
}

// Covers SPEC-054 CA-02: accept all admits everybody who waits, each with the snapshot.
func TestAcceptAll_AdmitsEveryoneWaiting(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	second := authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	a := w.dial(t, "student")
	readUntil(t, a, "live:admission:state")

	// a second student, with his own token
	w.svc.stateOf(second.UserID)
	w.people["second-student"] = second
	b := w.dial(t, "second-student")
	readUntil(t, b, "live:admission:state")
	eventually(t, func() bool { return len(w.svc.lists().Waiting) == 2 })

	sendMsg(t, teacher, "live:admission:accept-all", `{}`)
	for _, c := range []*websocket.Conn{a, b} {
		assert.Equal(t, "ADMITTED", statusOf(t, readUntil(t, c, "live:admission:state")))
		readUntil(t, c, "live:snapshot")
	}
	eventually(t, func() bool { return len(w.svc.lists().Admitted) == 2 })
}

// Covers SPEC-054 CA-03 and RN-02: removing takes the stage away and tells the student; he comes back only by asking.
func TestRemove_TakesTheStageAndAllowsAskingAgain(t *testing.T) {
	w := setup(t) // the student comes in admitted
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:snapshot")
	readUntil(t, teacher, "live:presence")

	sendMsg(t, teacher, "live:admission:remove", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "REMOVED", statusOf(t, readUntil(t, student, "live:admission:state")))
	_, admitted := queueOf(t, readUntil(t, teacher, "live:admission:queue"))
	assert.Empty(t, admitted)

	sendMsg(t, teacher, "live:slide:change", `{"slide":6}`)
	nothingMore(t, student, "live:slide:change")

	sendMsg(t, student, "live:hand:raise", `{}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 1 })
	assert.Equal(t, 0, w.svc.called("raise"))

	sendMsg(t, student, "live:admission:request", `{}`)
	assert.Equal(t, "WAITING", statusOf(t, readUntil(t, student, "live:admission:state")))
	waiting, _ := queueOf(t, readUntil(t, teacher, "live:admission:queue"))
	require.Len(t, waiting, 1)
	assert.Equal(t, w.student.UserID.String(), waiting[0]["studentId"])
}

// Covers SPEC-054 CA-02, CA-03 and RN-02: a student cannot decide; the attempt is dropped as not-controller.
func TestStudentCannotDecideAdmissions(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")

	id := w.student.UserID.String()
	sendMsg(t, student, "live:admission:accept", `{"studentId":"`+id+`"}`)
	sendMsg(t, student, "live:admission:accept-all", `{}`)
	sendMsg(t, student, "live:admission:remove", `{"studentId":"`+id+`"}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 3 })
	assert.Empty(t, w.svc.decided)
	assert.Equal(t, "WAITING", w.svc.stateOf(w.student.UserID))
}

// Covers SPEC-054 RN-01: a malformed decision is rejected without a change.
func TestAdmissionMessagesAreChecked(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")

	sendMsg(t, teacher, "live:admission:accept", `{"studentId":"not-a-uuid"}`)
	sendMsg(t, teacher, "live:admission:remove", `{}`)
	sendMsg(t, teacher, "live:admission:accept", `"broken"`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 3 })
	assert.Empty(t, w.svc.decided)
}

// Covers SPEC-054 CA-06 and RN-05: the snapshot of the teacher carries the waiting room and the admitted.
func TestTeacherSnapshotCarriesTheAdmissions(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	w.svc.stateOf(w.student.UserID)
	teacher := w.dial(t, "teacher")
	var snap struct {
		Admissions struct {
			Waiting  []map[string]any `json:"waiting"`
			Admitted []map[string]any `json:"admitted"`
		} `json:"admissions"`
	}
	require.NoError(t, json.Unmarshal(readUntil(t, teacher, "live:snapshot").Data, &snap))
	require.Len(t, snap.Admissions.Waiting, 1)
	assert.Equal(t, "Ana", snap.Admissions.Waiting[0]["name"])
	assert.NotNil(t, snap.Admissions.Admitted, "an empty list, not null")
}

// ---- WebSocket: the broadcast of the terminal and the module ----

// Covers SPEC-054 CA-10 and RN-04: the terminal of the teacher is private until the broadcast is turned on, and private again after.
func TestTerminalBroadcastSwitch(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	student := w.dial(t, "student")
	readUntil(t, teacher, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, teacher, "live:terminal:input", `{"terminal":1,"line":"secret"}`)
	sendMsg(t, teacher, "live:terminal:sync", `{"terminal":1,"line":"secret","output":"x","state":{}}`)
	nothingMore(t, student, "live:terminal:input", "live:terminal:sync")
	assert.Empty(t, w.svc.input)
	assert.Empty(t, w.svc.syncs)

	sendMsg(t, teacher, "live:terminal:broadcast", `{"enabled":true}`)
	assert.JSONEq(t, `{"enabled":true}`, string(readUntil(t, student, "live:terminal:broadcast").Data))
	sendMsg(t, teacher, "live:terminal:input", `{"terminal":1,"line":"ls"}`)
	assert.JSONEq(t, `{"terminal":1,"line":"ls"}`, string(readUntil(t, student, "live:terminal:input").Data))
	sendMsg(t, teacher, "live:terminal:sync", `{"terminal":1,"line":"ls","output":"a","state":{"fs":1}}`)
	readUntil(t, student, "live:terminal:sync")

	sendMsg(t, teacher, "live:terminal:broadcast", `{"enabled":false}`)
	assert.JSONEq(t, `{"enabled":false}`, string(readUntil(t, student, "live:terminal:broadcast").Data))
	sendMsg(t, teacher, "live:terminal:input", `{"terminal":1,"line":"private again"}`)
	nothingMore(t, student, "live:terminal:input")

	// A student cannot turn it on.
	sendMsg(t, student, "live:terminal:broadcast", `{"enabled":true}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 1 })
	assert.False(t, w.svc.TerminalBroadcasting(w.session.ID))
}

// Covers SPEC-054 CA-11 and RN-04: the block in focus reaches the admitted students and is kept for who comes in later.
func TestModuleFocusIsBroadcast(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	student := w.dial(t, "student")
	readUntil(t, teacher, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, teacher, "live:module:focus", `{"blockId":"block-7"}`)
	assert.JSONEq(t, `{"blockId":"block-7"}`, string(readUntil(t, student, "live:module:focus").Data))
	eventually(t, func() bool { w.svc.mu.Lock(); defer w.svc.mu.Unlock(); return len(w.svc.focus) == 1 })
	assert.Equal(t, []string{"block-7"}, w.svc.focus)

	sendMsg(t, student, "live:module:focus", `{"blockId":"hijack"}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 1 })
	assert.Len(t, w.svc.focus, 1)
}

// Covers SPEC-054 CA-11 and RN-06: the module mode needs a module; without one the switch is refused and not passed on.
func TestModeSwitchToModuleNeedsAModule(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	student := w.dial(t, "student")
	readUntil(t, teacher, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, teacher, "live:mode:switch", `{"mode":"MODULE"}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	nothingMore(t, student, "live:mode:switch")
	assert.Empty(t, w.svc.modes)
}

// Covers SPEC-054 RN-05: the snapshot of the room carries the module, the block in focus and the state of the broadcast.
func TestSnapshotCarriesTheModuleAndTheBroadcast(t *testing.T) {
	w := setup(t)
	module := uuid.New()
	session := w.session
	session.ActiveModuleID = &module
	session.DisplayMode = domain.ModeModule
	w.svc.active = service.Active{Found: true, Session: session, ModuleFocusBlockID: "block-3", TerminalBroadcast: true}
	var snap map[string]any
	require.NoError(t, json.Unmarshal(readUntil(t, w.dial(t, "student"), "live:snapshot").Data, &snap))
	assert.Equal(t, module.String(), snap["moduleId"])
	assert.Equal(t, "block-3", snap["moduleFocusBlockId"])
	assert.Equal(t, true, snap["terminalBroadcast"])

	w.svc.active = service.Active{Found: true, Session: w.session}
	code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Nil(t, body["moduleId"])
	assert.Equal(t, "", body["moduleFocusBlockId"])
	assert.Equal(t, false, body["terminalBroadcast"])
}

// ---- REST: the module of the room ----

// Covers SPEC-054 CA-11, CA-12 and section 5: the module of the room, for who may read it.
func TestModuleRoute(t *testing.T) {
	w := setup(t)
	module := uuid.New()
	w.svc.moduleView = service.ModuleView{ID: module, Title: "Processos", Scenario: json.RawMessage(`{"fs":1}`),
		Blocks: []service.ModuleBlock{{ID: "b1", Type: "TEXT", Position: 1, Payload: json.RawMessage(`{"text":"oi"}`)}}}

	code, body := w.call(t, "student", http.MethodGet, w.path("/module"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, module.String(), body["moduleId"])
	assert.Equal(t, "Processos", body["title"])
	assert.JSONEq(t, `{"fs":1}`, mustJSON(body["scenario"]))
	blocks := body["blocks"].([]any)
	require.Len(t, blocks, 1)
	block := blocks[0].(map[string]any)
	assert.Equal(t, "b1", block["id"])
	assert.Equal(t, "TEXT", block["type"])
	assert.EqualValues(t, 1, block["position"])
	assert.JSONEq(t, `{"text":"oi"}`, mustJSON(block["payload"]))
	assert.Equal(t, w.student.UserID, w.svc.moduleFor.UserID)
	assert.Equal(t, authn.RoleStudent, w.svc.moduleFor.Role)

	w.svc.moduleView = service.ModuleView{ID: module, Title: "Vazio"}
	_, body = w.call(t, "teacher", http.MethodGet, w.path("/module"), nil)
	assert.Equal(t, []any{}, body["blocks"], "an empty list, not null")
	assert.Nil(t, body["scenario"])

	for _, tc := range []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrNoActiveSession, http.StatusNotFound, "no-active-session"},
		{domain.ErrModuleNotSelected, http.StatusNotFound, "module-not-selected"},
		{domain.ErrModuleNotFound, http.StatusNotFound, "module-not-found"},
	} {
		w.svc.moduleErr = tc.err
		code, body = w.call(t, "student", http.MethodGet, w.path("/module"), nil)
		assert.Equal(t, tc.status, code, "%v", tc.err)
		assert.Equal(t, tc.typ, body["type"], "%v", tc.err)
	}
	w.svc.moduleErr = domain.ErrNotAdmitted
	code, body = w.call(t, "student", http.MethodGet, w.path("/module"), nil)
	assert.Equal(t, http.StatusForbidden, code, "who is not admitted is forbidden")
	assert.Equal(t, "forbidden", body["type"])

	code, body = w.call(t, "student", http.MethodGet, "/api/v1/classes/not-a-uuid/live/module", nil)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-uuid", body["type"])
}
