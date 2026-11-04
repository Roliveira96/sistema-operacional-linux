package handler_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- the conversation of the fake service (SPEC-093) ----

// fakeAttemptChat is what the fake gives for the conversation of an attempt.
var fakeAttemptChat []service.ChatLine

func (f *fakeService) SendStudentChat(_ context.Context, id, studentID uuid.UUID, position *int, text string) (domain.ChatMessage, error) {
	if text == "" {
		return domain.ChatMessage{}, domain.ErrInvalidChat
	}
	attempt := uuid.New()
	return domain.ChatMessage{ID: uuid.New(), AssessmentID: id, AttemptID: &attempt, StudentID: &studentID, SenderID: studentID, SenderRole: domain.ChatStudent,
		Position: position, Body: text, CreatedAt: at(21, 9, 30)}, nil
}

func (f *fakeService) SendTeacherChat(_ context.Context, id, teacherID uuid.UUID, studentID *uuid.UUID, position *int, text string) (domain.ChatMessage, []uuid.UUID, error) {
	m := domain.ChatMessage{ID: uuid.New(), AssessmentID: id, SenderID: teacherID, SenderRole: domain.ChatTeacher, Position: position, Body: text, CreatedAt: at(21, 9, 31)}
	if studentID == nil {
		return m, []uuid.UUID{roomStudent, roomOther}, nil
	}
	attempt := uuid.New()
	m.AttemptID, m.StudentID = &attempt, studentID
	return m, []uuid.UUID{*studentID}, nil
}

func (f *fakeService) StudentChat(_ context.Context, id, studentID uuid.UUID) ([]domain.ChatMessage, error) {
	attempt := uuid.New()
	return []domain.ChatMessage{{ID: uuid.New(), AttemptID: &attempt, StudentID: &studentID, SenderID: studentID, SenderRole: domain.ChatStudent, Body: "Posso?", CreatedAt: at(21, 9, 10)}}, nil
}

func (f *fakeService) RoomChat(_ context.Context, id uuid.UUID) ([]domain.ChatMessage, error) {
	attempt := uuid.New()
	return []domain.ChatMessage{
		{ID: uuid.New(), AttemptID: &attempt, StudentID: &roomStudent, SenderID: roomStudent, SenderRole: domain.ChatStudent, Body: "Posso?", CreatedAt: at(21, 9, 10)},
		{ID: uuid.New(), SenderID: roomTeacher, SenderRole: domain.ChatTeacher, Body: "Faltam 10 minutos", CreatedAt: at(21, 9, 20)},
	}, nil
}

func (f *fakeService) AttemptChat(_ context.Context, a service.Actor, classID, id, attemptID uuid.UUID) ([]service.ChatLine, error) {
	f.saw("AttemptChat", a)
	return fakeAttemptChat, f.err
}

// ---- the tests ----

// Covers SPEC-093 CA-01, CA-02, CA-03 (RN-01, RN-03, RN-05): the student writes only to the teacher, with the question she is in; the teacher writes to
// one student or to all; nobody else gets a private message, and a message out of the rules goes nowhere.
func TestRoomChat_DeliversOnlyToTheTeacherAndTheStudent(t *testing.T) {
	w := roomSetup(t)
	w.svc.room().started = true
	teacher := w.dial(t, "teacher")
	readType(t, teacher, "room:snapshot")
	ana := w.dial(t, "ana")
	readType(t, ana, "room:snapshot")
	bruno := w.dial(t, "bruno")
	readType(t, bruno, "room:snapshot")

	sendWS(t, ana, "room:question", map[string]any{"position": 4, "title": "Criar pasta"})
	sendWS(t, ana, "chat:send", map[string]any{"text": "Posso usar o man?"})
	got := object2(t, readType(t, teacher, "chat:message").Data)
	assert.Equal(t, "private", got["scope"])
	assert.Equal(t, roomStudent.String(), got["studentId"])
	assert.Equal(t, "STUDENT", got["from"])
	assert.Equal(t, "Posso usar o man?", got["text"])
	assert.Equal(t, 4.0, got["position"])
	assert.Contains(t, got, "id")
	assert.Contains(t, got, "createdAt")
	readType(t, ana, "chat:message")

	sendWS(t, ana, "chat:send", map[string]any{"text": "Para todos", "to": "all"})
	sendWS(t, ana, "chat:send", map[string]any{"text": "Bruno", "studentId": roomOther.String()})
	silent(t, teacher, "chat:message")

	sendWS(t, teacher, "chat:send", map[string]any{"text": "Pode", "studentId": roomStudent.String()})
	mine := object2(t, readType(t, ana, "chat:message").Data)
	assert.Equal(t, "TEACHER", mine["from"])
	assert.Equal(t, 4.0, mine["position"], "the question the student is in")
	readType(t, teacher, "chat:message")
	silent(t, bruno, "chat:message")

	sendWS(t, teacher, "chat:send", map[string]any{"text": "Os dois", "studentId": roomStudent.String(), "to": "all"})
	sendWS(t, teacher, "chat:send", map[string]any{"text": "Nenhum"})
	silent(t, ana, "chat:message")

	sendWS(t, teacher, "chat:send", map[string]any{"text": "Faltam 10 minutos", "to": "all"})
	toAll := object2(t, readType(t, bruno, "chat:message").Data)
	assert.Equal(t, "all", toAll["scope"])
	assert.NotContains(t, toAll, "studentId")
	readType(t, ana, "chat:message")
	readType(t, teacher, "chat:message")
}

// Covers SPEC-093 CA-05 (RN-06): the whole state has the conversation by the role: the student, hers; the teacher, the last of the exam.
func TestRoomChat_SnapshotByRole(t *testing.T) {
	w := roomSetup(t)
	w.svc.room().started = true
	teacher := w.dial(t, "teacher")
	assert.Len(t, object2(t, readType(t, teacher, "room:snapshot").Data)["chat"], 2)
	ana := w.dial(t, "ana")
	chat := object2(t, readType(t, ana, "room:snapshot").Data)["chat"].([]any)
	require.Len(t, chat, 1)
	assert.Equal(t, "Posso?", chat[0].(map[string]any)["text"])
}

// Covers SPEC-093 CA-06 (RN-07): the route of the conversation of an attempt gives the messages with who wrote them; the errors come with their slug.
func TestAttemptChatRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	attempt := uuid.New()
	fakeAttemptChat = []service.ChatLine{
		{ChatMessage: domain.ChatMessage{ID: uuid.New(), AttemptID: &attempt, SenderRole: domain.ChatStudent, Position: ptr(4), Body: "Posso?", CreatedAt: at(21, 9, 10)}, SenderName: "Ana"},
		{ChatMessage: domain.ChatMessage{ID: uuid.New(), SenderRole: domain.ChatTeacher, Body: "Faltam 10 minutos", CreatedAt: at(21, 9, 20)}, SenderName: "Profa. Sediane"},
	}
	path := assessmentPath(uuid.New(), uuid.New()) + "/attempts/" + attempt.String() + "/chat"
	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	list := array(t, body["messages"])
	require.Len(t, list, 2)
	first := object(t, list[0])
	assert.Equal(t, "Ana", first["senderName"])
	assert.Equal(t, "STUDENT", first["from"])
	assert.Equal(t, "private", first["scope"])
	assert.Equal(t, 4.0, first["position"])
	assert.Equal(t, "Posso?", first["text"])
	second := object(t, list[1])
	assert.Equal(t, "all", second["scope"])
	assert.NotContains(t, second, "position")

	// CA-04: nothing edits nor deletes a message
	for _, method := range []string{http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodPost} {
		status, _ = call(t, srv, method, path, map[string]any{"text": "outro"})
		assert.Equal(t, http.StatusNotFound, status, method)
	}

	for err, want := range map[error]int{domain.ErrForbidden: http.StatusForbidden, domain.ErrAttemptNotFound: http.StatusNotFound} {
		svc.err = err
		status, _ = call(t, srv, http.MethodGet, path, nil)
		assert.Equal(t, want, status, err.Error())
	}
}

// Covers SPEC-093 CA-06: the list of the attempts has the count of the messages of each one.
func TestAttemptList_HasChatCount(t *testing.T) {
	srv, _, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	fakeRows = []service.AttemptRow{{AttemptID: uuid.New(), StudentID: uuid.New(), StudentName: "Ana", Status: domain.AttemptInProgress, StartedAt: at(21, 9, 10), ChatCount: 3}}
	status, body := call(t, srv, http.MethodGet, assessmentPath(uuid.New(), uuid.New())+"/attempts", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, 3.0, object(t, array(t, body["items"])[0])["chatCount"])
}
