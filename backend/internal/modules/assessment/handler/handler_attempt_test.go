package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// the attempt of the fake service (SPEC-090)
var (
	fakeAttempt     service.StudentAttempt
	fakeCreated     bool
	fakeRows        []service.AttemptRow
	fakeSolved      bool
	fakePosition    int
	fakeAnswer      json.RawMessage
	fakeAttemptErrs = map[string]error{}
)

func (f *fakeService) EnterAttempt(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.StudentAttempt, bool, error) {
	f.saw("EnterAttempt", a)
	f.classID, f.id = classID, id
	return fakeAttempt, fakeCreated, f.err
}

func (f *fakeService) MyAttempt(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.StudentAttempt, error) {
	f.saw("MyAttempt", a)
	return fakeAttempt, f.err
}

func (f *fakeService) SaveAnswer(_ context.Context, a service.Actor, classID, id uuid.UUID, position int, answer json.RawMessage) error {
	f.saw("SaveAnswer", a)
	fakePosition, fakeAnswer = position, answer
	return f.err
}

func (f *fakeService) CheckAnswer(_ context.Context, a service.Actor, classID, id uuid.UUID, position int, snapshot json.RawMessage) (bool, error) {
	f.saw("CheckAnswer", a)
	fakePosition, fakeAnswer = position, snapshot
	return fakeSolved, f.err
}

func (f *fakeService) SubmitAttempt(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.StudentAttempt, error) {
	f.saw("SubmitAttempt", a)
	return fakeAttempt, f.err
}

func (f *fakeService) Attempts(_ context.Context, a service.Actor, classID, id uuid.UUID) ([]service.AttemptRow, error) {
	f.saw("Attempts", a)
	return fakeRows, f.err
}

func sampleAttempt() service.StudentAttempt {
	solved := true
	return service.StudentAttempt{
		ID: uuid.New(), Status: domain.AttemptInProgress, StartedAt: at(21, 9, 10), DeadlineAt: at(21, 11, 0),
		Items: []service.AttemptItemView{
			{Position: 1, Kind: "THEORETICAL_SINGLE", Weight: domain.Points(2), StudentView: json.RawMessage(`{"statement":"Qual?"}`), Answer: json.RawMessage(`{"choice":"a"}`)},
			{Position: 2, Kind: "PRACTICAL", Weight: domain.Points(3), StudentView: json.RawMessage(`{"statement":"Crie"}`), CheckedSolved: &solved},
		},
	}
}

// Covers SPEC-090 CA-01, CA-08 (section 5): entering answers 201 the first time and 200 after, with the attempt of the student and exactly its keys:
// never the key, the points nor the score.
func TestHandler_EnterAttempt(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	path := assessmentPath(uuid.New(), uuid.New()) + "/attempt"
	fakeAttempt, fakeCreated = sampleAttempt(), true

	status, body := call(t, srv, http.MethodPost, path, nil)
	require.Equal(t, http.StatusCreated, status)
	assert.Equal(t, []string{"EnterAttempt"}, svc.calls)
	assert.Equal(t, sorted("id", "status", "startedAt", "deadlineAt", "serverNow", "items"), keysOf(body))
	items := array(t, body["items"])
	require.Len(t, items, 2)
	assert.Equal(t, sorted("position", "kind", "weight", "studentView", "answer"), keysOf(object(t, items[0])))
	assert.Equal(t, sorted("position", "kind", "weight", "studentView", "checkedSolved"), keysOf(object(t, items[1])))
	assert.Equal(t, 2.0, object(t, items[0])["weight"])

	fakeCreated = false
	status, _ = call(t, srv, http.MethodPost, path, nil)
	assert.Equal(t, http.StatusOK, status)

	status, body = call(t, srv, http.MethodGet, path, nil)
	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, "IN_PROGRESS", body["status"])
}

// Covers SPEC-090 CA-04, CA-05, CA-06 (section 5): saving takes the answer and answers 204; checking takes the machine and says whether it is solved;
// submitting gives the attempt back.
func TestHandler_SaveCheckAndSubmit(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	path := assessmentPath(uuid.New(), uuid.New()) + "/attempt"

	status, _ := call(t, srv, http.MethodPut, path+"/items/3", map[string]any{"answer": map[string]any{"choice": "b"}})
	require.Equal(t, http.StatusNoContent, status)
	assert.Equal(t, 3, fakePosition)
	assert.JSONEq(t, `{"choice":"b"}`, string(fakeAnswer))

	status, _ = call(t, srv, http.MethodPut, path+"/items/x", map[string]any{"answer": map[string]any{}})
	assert.Equal(t, http.StatusBadRequest, status, "the position is a number")
	status, _ = call(t, srv, http.MethodPut, path+"/items/1", map[string]any{})
	assert.Equal(t, http.StatusBadRequest, status, "the answer is required")

	fakeSolved = true
	status, body := call(t, srv, http.MethodPost, path+"/items/4/check", map[string]any{"snapshot": map[string]any{"cwd": "/"}})
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, true, body["solved"])
	assert.Equal(t, 4, fakePosition)

	submitted := sampleAttempt()
	submitted.Status = domain.AttemptSubmitted
	submitted.SubmittedAt = ptr(at(21, 10, 15))
	fakeAttempt = submitted
	status, body = call(t, srv, http.MethodPost, path+"/submit", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "SUBMITTED", body["status"])
	assert.Contains(t, body["submittedAt"], "2026-10-21T10:15:00")
	assert.Contains(t, svc.calls, "SubmitAttempt")
}

// Covers SPEC-090 CA-09 (section 5): the list of the teacher has one row for each attempt, with the score only after the delivery.
func TestHandler_AttemptsOfTheTeacher(t *testing.T) {
	srv, _, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	score, pending := domain.Points(7.5), 1
	fakeRows = []service.AttemptRow{
		{AttemptID: uuid.New(), StudentID: uuid.New(), StudentName: "Ana", AcademicID: "1000001", Status: domain.AttemptInProgress, StartedAt: at(21, 9, 10)},
		{AttemptID: uuid.New(), StudentID: uuid.New(), StudentName: "Bruno", AcademicID: "1000002", Status: domain.AttemptSubmitted, StartedAt: at(21, 9, 12),
			SubmittedAt: ptr(at(21, 10, 0)), PreliminaryScore: &score, PendingItems: &pending},
	}
	status, body := call(t, srv, http.MethodGet, assessmentPath(uuid.New(), uuid.New())+"/attempts", nil)
	require.Equal(t, http.StatusOK, status)
	rows := array(t, body["items"])
	require.Len(t, rows, 2)
	assert.Equal(t, sorted("attemptId", "studentId", "studentName", "academicId", "status", "startedAt"), keysOf(object(t, rows[0])))
	second := object(t, rows[1])
	assert.Equal(t, 7.5, second["preliminaryScore"])
	assert.Equal(t, 1.0, second["pendingItems"])
	assert.Contains(t, second, "submittedAt")
}

// Covers SPEC-090 CA-02, CA-04, CA-05 (section 5): the errors of the attempt, with their status and slug.
func TestHandler_AttemptErrors(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	path := assessmentPath(uuid.New(), uuid.New()) + "/attempt"
	cases := []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrInvalidAnswer, http.StatusBadRequest, "invalid-answer"},
		{domain.ErrNotPractical, http.StatusBadRequest, "not-practical"},
		{domain.ErrNotEligible, http.StatusForbidden, "not-eligible"},
		{domain.ErrAttemptNotFound, http.StatusNotFound, "attempt-not-found"},
		{domain.ErrNotCleared, http.StatusConflict, "not-cleared"},
		{domain.ErrAttemptAlreadySubmitted, http.StatusConflict, "attempt-already-submitted"},
		{domain.ErrAttemptExpired, http.StatusConflict, "attempt-expired"},
		{domain.ErrAssessmentNotStarted, http.StatusConflict, "assessment-not-started"},
	}
	for _, c := range cases {
		svc.err = c.err
		status, body := call(t, srv, http.MethodPost, path, nil)
		assert.Equal(t, c.status, status, c.err.Error())
		assert.Equal(t, c.typ, body["type"], c.err.Error())
	}
}
