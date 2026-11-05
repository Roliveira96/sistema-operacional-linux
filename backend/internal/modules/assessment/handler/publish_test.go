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

func (f *fakeService) PublishGrades(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.Summary, error) {
	f.saw("PublishGrades", a)
	return f.summary, f.err
}

// Covers SPEC-098 CA-01 (section 5): the route publishes the grades and answers the assessment with who and when; the errors become their codes.
func TestPublishGradesRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	svc.summary = service.Summary{Public: minimalPublic(), GradesPublishedAt: ptr(at(21, 10, 30)), GradesPublishedByName: "Profa. Sediane"}
	path := assessmentPath(uuid.New(), uuid.New()) + "/grades/publish"
	status, body := call(t, srv, http.MethodPost, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.Contains(t, body, "gradesPublishedAt")
	assert.Equal(t, "Profa. Sediane", body["gradesPublishedByName"])
	for err, want := range map[error]int{
		domain.ErrReviewsPending: http.StatusConflict, domain.ErrAssessmentNotEnded: http.StatusConflict, domain.ErrForbidden: http.StatusForbidden,
		domain.ErrGradesPublished: http.StatusConflict,
	} {
		svc.err = err
		status, _ = call(t, srv, http.MethodPost, path, nil)
		assert.Equal(t, want, status, err.Error())
	}
	svc.err = domain.ErrReviewsPending
	_, body = call(t, srv, http.MethodPost, path, nil)
	assert.Contains(t, body["type"], "reviews-pending")
	svc.err = domain.ErrGradesPublished
	_, body = call(t, srv, http.MethodPost, path, nil)
	assert.Contains(t, body["type"], "grades-published")
}

var fakeResult service.StudentResult

func (f *fakeService) MyResult(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.StudentResult, error) {
	f.saw("MyResult", a)
	return fakeResult, f.err
}

// Covers SPEC-098 CA-02, CA-03 (section 5): the result of the student with exactly its keys, never the private note; not published is 404.
func TestMyResultRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	half := domain.Points(0.5)
	fakeResult = service.StudentResult{FinalScore: domain.Points(7.5), MaxScore: domain.Points(10), StudentNote: "Muito bem.",
		Items: []service.ResultItem{{TeacherAttemptItem: service.TeacherAttemptItem{AttemptItemView: service.AttemptItemView{Position: 1, Kind: "THEORETICAL_SINGLE",
			Weight: domain.Points(2), StudentView: []byte(`{"title":"P"}`), Answer: []byte(`{"choice":"a"}`)}, Title: "P", AnswerKey: []byte(`{"correct":"b"}`)},
			Points: &half, AdjustReason: "Parcial"}}}
	path := assessmentPath(uuid.New(), uuid.New()) + "/my-result"
	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []string{"finalScore", "maxScore", "studentNote", "items"}, keysOf(body))
	item := object(t, array(t, body["items"])[0])
	assert.ElementsMatch(t, []string{"position", "kind", "weight", "title", "studentView", "answer", "answerKey", "points", "adjustReason"}, keysOf(item))
	assert.Equal(t, 0.5, item["points"])
	svc.err = domain.ErrResultNotPublished
	status, body = call(t, srv, http.MethodGet, path, nil)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Contains(t, body["type"], "result-not-published")
}
