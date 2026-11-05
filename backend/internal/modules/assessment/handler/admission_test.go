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

// fakeAdmitted is what the fake gives back as admitted; fakeFinish what it gives when the exam is finished.
var (
	fakeAdmitted []uuid.UUID
	fakeFinish   service.FinishResult
)

func (f *fakeService) Admit(_ context.Context, a service.Actor, classID, id uuid.UUID, studentIDs []uuid.UUID) ([]uuid.UUID, error) {
	f.saw("Admit", a)
	if f.err != nil {
		return nil, f.err
	}
	r := f.room()
	r.mu.Lock()
	for _, s := range studentIDs {
		delete(r.pending, s)
	}
	r.mu.Unlock()
	if fakeAdmitted != nil {
		return fakeAdmitted, nil
	}
	return studentIDs, nil
}

func (f *fakeService) Finish(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.FinishResult, error) {
	f.saw("Finish", a)
	return fakeFinish, f.err
}

// Covers SPEC-096 CA-02, CA-04 (section 5): the route admits the list of students and answers who was admitted; the body is checked and the errors
// of the service become their codes.
func TestAdmissionsRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	fakeAdmitted = nil
	defer func() { fakeAdmitted = nil }()
	path := assessmentPath(uuid.New(), uuid.New()) + "/admissions"
	ana, bruno := uuid.New(), uuid.New()
	status, body := call(t, srv, http.MethodPost, path, map[string]any{"studentIds": []string{ana.String(), bruno.String()}})
	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []any{ana.String(), bruno.String()}, array(t, body["admitted"]))

	for name, b := range map[string]any{"no list": map[string]any{}, "not an id": map[string]any{"studentIds": []string{"x"}}, "a field more": map[string]any{"studentIds": []string{ana.String()}, "x": 1}} {
		status, _ = call(t, srv, http.MethodPost, path, b)
		assert.Equal(t, http.StatusBadRequest, status, name)
	}
	for err, want := range map[error]int{
		domain.ErrForbidden: http.StatusForbidden, domain.ErrInvalidAdmission: http.StatusBadRequest, domain.ErrAssessmentNotStarted: http.StatusConflict,
		domain.ErrAssessmentFinished: http.StatusConflict,
	} {
		svc.err = err
		status, body = call(t, srv, http.MethodPost, path, map[string]any{"studentIds": []string{ana.String()}})
		assert.Equal(t, want, status, err.Error())
	}
	svc.err = domain.ErrAssessmentFinished
	_, body = call(t, srv, http.MethodPost, path, map[string]any{"studentIds": []string{ana.String()}})
	assert.Contains(t, body["type"], "assessment-finished")
	svc.err = domain.ErrInvalidAdmission
	_, body = call(t, srv, http.MethodPost, path, map[string]any{"studentIds": []string{ana.String()}})
	assert.Contains(t, body["type"], "invalid-admission")
}

// Covers SPEC-096 CA-05 (section 5): the route finishes the exam and answers when, who, how many attempts it ended and how many did not come.
func TestFinishRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	teacher := uuid.New()
	fakeFinish = service.FinishResult{FinishedAt: at(21, 10, 0), FinishedBy: teacher, FinishedByName: "Profa. Sediane", Ended: []uuid.UUID{uuid.New()}, Absent: 2}
	path := assessmentPath(uuid.New(), uuid.New()) + "/finish"
	status, body := call(t, srv, http.MethodPost, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []string{"finishedAt", "finishedBy", "finishedByName", "ended", "absent"}, keysOf(body))
	assert.Equal(t, 1.0, body["ended"])
	assert.Equal(t, 2.0, body["absent"])
	assert.Equal(t, "Profa. Sediane", body["finishedByName"])
	for err, want := range map[error]int{domain.ErrForbidden: http.StatusForbidden, domain.ErrAssessmentFinished: http.StatusConflict, domain.ErrAssessmentNotStarted: http.StatusConflict} {
		svc.err = err
		status, _ = call(t, srv, http.MethodPost, path, nil)
		assert.Equal(t, want, status, err.Error())
	}
}

// Covers SPEC-096 CA-03, CA-06: entering without the admission is 409 attempt-not-admitted; the absent come in the list without an attempt.
func TestAttempts_NotAdmittedAndAbsent(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	svc.err = domain.ErrAttemptNotAdmitted
	status, body := call(t, srv, http.MethodPost, assessmentPath(uuid.New(), uuid.New())+"/attempt", nil)
	assert.Equal(t, http.StatusConflict, status)
	assert.Contains(t, body["type"], "attempt-not-admitted")

	srv2, _, _ := setup(authn.RoleTeacher)
	defer srv2.Close()
	fakeRows = []service.AttemptRow{{StudentID: uuid.New(), StudentName: "Carla", AcademicID: "1000003", Status: domain.AttemptAbsent}}
	status, body = call(t, srv2, http.MethodGet, assessmentPath(uuid.New(), uuid.New())+"/attempts", nil)
	require.Equal(t, http.StatusOK, status)
	row := object(t, array(t, body["items"])[0])
	assert.Equal(t, "ABSENT", row["status"])
	assert.NotContains(t, row, "attemptId")
	assert.NotContains(t, row, "startedAt")
}

// Covers SPEC-096 section 3.1: the assessment says when and by whom it was finished.
func TestSummary_HasTheFinish(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	svc.summary = service.Summary{Public: minimalPublic(), StartedAt: ptr(at(21, 9, 5)), FinishedAt: ptr(at(21, 10, 0)), FinishedByName: "Profa. Sediane"}
	status, body := call(t, srv, http.MethodPost, assessmentPath(uuid.New(), uuid.New())+"/start", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "Profa. Sediane", body["finishedByName"])
	assert.Contains(t, body, "finishedAt")
}
