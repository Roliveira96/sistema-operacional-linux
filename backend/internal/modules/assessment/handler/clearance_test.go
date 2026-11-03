package handler_test

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- RN-09, RN-10: what the student receives ----

// Covers SPEC-076 CA-12, CA-13 (RN-09, RN-10), with SPEC-091 CA-03 (RN-03): the student gets whether they may enter, why and the modality, and
// nothing of a clearance any more.
func TestHandler_MyAccessHasExactlyTheStudentKeys(t *testing.T) {
	srv, svc, userID := setup(authn.RoleStudent)
	defer srv.Close()
	classID, id := uuid.New(), uuid.New()

	svc.access = service.MyAccess{Allowed: false, Reason: domain.AccessNotStarted, Modality: domain.ModalityInPerson}
	status, body := call(t, srv, http.MethodGet, assessmentPath(classID, id)+"/my-access", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, sorted("allowed", "reason", "modality", "serverNow"), keysOf(body))
	assert.Equal(t, []string{"MyAccess"}, svc.calls)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, id, svc.id)
	assert.Equal(t, false, body["allowed"])
	assert.Equal(t, "NOT_STARTED", body["reason"])
	assert.Equal(t, "IN_PERSON", body["modality"])
}

// Covers SPEC-076 CA-12, CA-13: the route is the student's; the service says who is refused, and the handler turns it into 403 and 404.
func TestHandler_MyAccessRefusalsAreTheOnesOfTheService(t *testing.T) {
	for name, c := range map[string]struct {
		role   string
		err    error
		status int
		typ    string
	}{
		"a teacher":        {authn.RoleTeacher, domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		"an administrator": {authn.RoleAdmin, domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		"not eligible":     {authn.RoleStudent, domain.ErrAssessmentNotFound, http.StatusNotFound, "assessment-not-found"},
		"not in the class": {authn.RoleStudent, domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
	} {
		srv, svc, _ := setup(c.role)
		svc.err = c.err
		status, body := call(t, srv, http.MethodGet, assessmentPath(uuid.New(), uuid.New())+"/my-access", nil)
		assert.Equal(t, c.status, status, name)
		assert.Equal(t, c.typ, body["type"], name)
		assert.Equal(t, c.role, svc.actor.Role, name)
		srv.Close()
	}
}

// Covers SPEC-091 CA-03 (RN-03): the routes of the clearance are gone, and the requirement sent in the create or the update is ignored.
func TestHandler_TheClearanceIsGone(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id := uuid.New(), uuid.New()
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		status, _ := call(t, srv, method, assessmentPath(classID, id)+"/clearances", map[string]any{"action": "APPROVE_ALL"})
		assert.Equal(t, http.StatusNotFound, status, method)
	}

	svc.summary = service.Summary{Public: minimalPublic(), Modality: domain.ModalityInPerson}
	status, _ := call(t, srv, http.MethodPost, classPath(classID)+"/assessments", createBody(map[string]any{"modality": "IN_PERSON", "requiresClearance": true}))
	require.Equal(t, http.StatusCreated, status)
	require.NotNil(t, svc.create.Modality)
	assert.Equal(t, domain.ModalityInPerson, *svc.create.Modality, "the modality is still taken")
	assert.Nil(t, svc.create.RequiresClearance, "the requirement is ignored")

	call(t, srv, http.MethodPatch, assessmentPath(classID, id), map[string]any{"requiresClearance": true})
	assert.Nil(t, svc.update.RequiresClearance)
}

// Covers SPEC-076 CA-12, section 5: the public form of the student does not change: no modality, no requirement and no counters.
func TestHandler_PublicFormIsTheSameAsBefore(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	svc.public = fullPublic()
	_, body := call(t, srv, http.MethodGet, assessmentPath(uuid.New(), svc.public.ID), nil)
	for _, key := range []string{"modality", "requiresClearance", "clearanceCounts", "clearance"} {
		assert.NotContains(t, body, key)
	}
}
