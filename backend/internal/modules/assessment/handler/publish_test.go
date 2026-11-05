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
