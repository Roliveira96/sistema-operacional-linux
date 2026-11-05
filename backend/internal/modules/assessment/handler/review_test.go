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

// fakeReview is what the fake gives for the correction of an attempt.
var fakeReview service.Review

func (f *fakeService) ReviewOf(_ context.Context, a service.Actor, classID, id, attemptID uuid.UUID) (service.Review, error) {
	f.saw("ReviewOf", a)
	return fakeReview, f.err
}

// Covers SPEC-097 CA-02 (section 5): the route gives the attempt for the correction with exactly its keys; the commands go with their question; the
// errors of the service become their codes.
func TestReviewRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	submitted := at(21, 10, 0)
	two, half := domain.Points(2), domain.Points(0.5)
	fakeReview = service.Review{
		AttemptRow: service.AttemptRow{AttemptID: uuid.New(), StudentID: uuid.New(), StudentName: "Ana", AcademicID: "1000001", Status: domain.AttemptSubmitted,
			StartedAt: at(21, 9, 10), SubmittedAt: &submitted, PreliminaryScore: &two},
		Score: domain.Points(2),
		Items: []service.ReviewItem{
			{TeacherAttemptItem: service.TeacherAttemptItem{AttemptItemView: service.AttemptItemView{Position: 1, Kind: "PRACTICAL", Weight: domain.Points(2),
				StudentView: json.RawMessage(`{"title":"Criar"}`)}, Title: "Criar"}, Points: &two,
				Commands: []domain.AttemptCommand{{Position: 1, Command: "mkdir /a", Output: "", ExecutedAt: at(21, 9, 20)}}},
			{TeacherAttemptItem: service.TeacherAttemptItem{AttemptItemView: service.AttemptItemView{Position: 2, Kind: "DISCURSIVE", Weight: domain.Points(1),
				StudentView: json.RawMessage(`{"title":"O 755"}`), Answer: json.RawMessage(`{"html":"<p>x</p>"}`)}, Title: "O 755"},
				ExpectedAnswer: "<p>7</p>", AdjustedPoints: &half, AdjustReason: "Parcial"},
		},
		Helps: []domain.HelpRequest{{ID: uuid.New(), Position: ptr(2), Question: "Posso?", Status: domain.HelpAnswered, CreatedAt: at(21, 9, 30), Answer: "Pode"}},
	}
	path := assessmentPath(uuid.New(), uuid.New()) + "/attempts/" + fakeReview.AttemptID.String() + "/review"
	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []string{"attemptId", "studentId", "studentName", "academicId", "status", "startedAt", "submittedAt", "preliminaryScore",
		"score", "reviewed", "teacherNote", "studentNote", "items", "helps", "serverNow"}, keysOf(body))
	assert.Equal(t, 2.0, body["score"])
	assert.Equal(t, false, body["reviewed"])
	items := array(t, body["items"])
	practical := object(t, items[0])
	assert.Equal(t, 2.0, practical["points"])
	commands := array(t, practical["commands"])
	require.Len(t, commands, 1)
	assert.Equal(t, "mkdir /a", object(t, commands[0])["command"])
	written := object(t, items[1])
	assert.Equal(t, "<p>7</p>", written["expectedAnswer"])
	assert.Equal(t, 0.5, written["adjustedPoints"])
	assert.Equal(t, "Parcial", written["adjustReason"])
	assert.NotContains(t, written, "points", "no automatic points for the written one")
	help := object(t, array(t, body["helps"])[0])
	assert.Equal(t, "Posso?", help["question"])
	assert.Equal(t, "Pode", help["answer"])

	for err, want := range map[error]int{
		domain.ErrForbidden: http.StatusForbidden, domain.ErrAttemptNotFound: http.StatusNotFound,
		domain.ErrAssessmentNotEnded: http.StatusConflict, domain.ErrAttemptInProgress: http.StatusConflict,
	} {
		svc.err = err
		status, body = call(t, srv, http.MethodGet, path, nil)
		assert.Equal(t, want, status, err.Error())
	}
	svc.err = domain.ErrAssessmentNotEnded
	_, body = call(t, srv, http.MethodGet, path, nil)
	assert.Contains(t, body["type"], "assessment-not-ended")
	svc.err = domain.ErrAttemptInProgress
	_, body = call(t, srv, http.MethodGet, path, nil)
	assert.Contains(t, body["type"], "attempt-in-progress")
}

// fakeAdjusted records what the route sent to the service.
var fakeAdjusted struct {
	position int
	points   *float64
	reason   string
}

func (f *fakeService) AdjustItem(_ context.Context, a service.Actor, classID, id, attemptID uuid.UUID, position int, points *float64, reason string) (service.Review, error) {
	f.saw("AdjustItem", a)
	fakeAdjusted.position, fakeAdjusted.points, fakeAdjusted.reason = position, points, reason
	return fakeReview, f.err
}

// Covers SPEC-097 CA-03 (section 5): the route takes the points and the reason, or null to undo, and answers the attempt for the correction; the body
// is checked and the errors become their codes.
func TestAdjustRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	fakeReview = service.Review{AttemptRow: service.AttemptRow{AttemptID: uuid.New(), Status: domain.AttemptSubmitted, StartedAt: at(21, 9, 10)}, Score: domain.Points(7.5)}
	path := assessmentPath(uuid.New(), uuid.New()) + "/attempts/" + fakeReview.AttemptID.String() + "/items/3/points"
	status, body := call(t, srv, http.MethodPut, path, map[string]any{"points": 0.5, "reason": "Parcial"})
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, 7.5, body["score"])
	assert.Equal(t, 3, fakeAdjusted.position)
	require.NotNil(t, fakeAdjusted.points)
	assert.Equal(t, 0.5, *fakeAdjusted.points)
	assert.Equal(t, "Parcial", fakeAdjusted.reason)

	status, _ = call(t, srv, http.MethodPut, path, map[string]any{"points": nil})
	require.Equal(t, http.StatusOK, status)
	assert.Nil(t, fakeAdjusted.points, "null undoes")

	for name, b := range map[string]any{"no points": map[string]any{"reason": "x"}, "a field more": map[string]any{"points": 1, "x": 1}, "not a number": map[string]any{"points": "um"}} {
		status, _ = call(t, srv, http.MethodPut, path, b)
		assert.Equal(t, http.StatusBadRequest, status, name)
	}
	status, _ = call(t, srv, http.MethodPut, assessmentPath(uuid.New(), uuid.New())+"/attempts/"+fakeReview.AttemptID.String()+"/items/x/points", map[string]any{"points": 1})
	assert.Equal(t, http.StatusBadRequest, status, "the position is a number")
	for err, want := range map[error]int{domain.ErrInvalidPoints: http.StatusBadRequest, domain.ErrReviewDone: http.StatusConflict, domain.ErrForbidden: http.StatusForbidden} {
		svc.err = err
		status, body = call(t, srv, http.MethodPut, path, map[string]any{"points": 1, "reason": "x"})
		assert.Equal(t, want, status, err.Error())
	}
	svc.err = domain.ErrReviewDone
	_, body = call(t, srv, http.MethodPut, path, map[string]any{"points": 1, "reason": "x"})
	assert.Contains(t, body["type"], "review-done")
	svc.err = domain.ErrInvalidPoints
	_, body = call(t, srv, http.MethodPut, path, map[string]any{"points": 1, "reason": "x"})
	assert.Contains(t, body["type"], "invalid-points")
}
