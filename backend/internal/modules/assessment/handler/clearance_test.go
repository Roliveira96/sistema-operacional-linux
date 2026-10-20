package handler_test

import (
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

func clearancesPath(classID, id uuid.UUID) string { return assessmentPath(classID, id) + "/clearances" }

func aList() service.ClearanceList {
	return service.ClearanceList{
		RequiresClearance: true,
		Items: []service.ClearanceItem{
			{StudentID: uuid.New(), Name: "Ana", AcademicID: "1000001", Status: domain.ClearancePending},
			{StudentID: uuid.New(), Name: "Bruno", AcademicID: "1000002", Status: domain.ClearanceApproved, ClearedAt: ptr(at(20, 8, 30)), ClearedByName: "Profa. Sediane"},
			{StudentID: uuid.New(), Name: "Carla", AcademicID: "1000003", Status: domain.ClearanceRejected, RejectionReason: ptr("Reprovada por faltas"),
				ClearedAt: ptr(at(20, 8, 31)), ClearedByName: "Profa. Sediane"},
			{StudentID: uuid.New(), Name: "Davi", AcademicID: "1000004", Status: domain.ClearanceRejected, ClearedAt: ptr(at(20, 8, 32)), ClearedByName: "Profa. Sediane"},
		},
		Counts: service.ClearanceCounts{Pending: 1, Approved: 1, Rejected: 2},
	}
}

// ---- RN-09, RN-10: what the student receives ----

// Covers SPEC-076 CA-12, CA-13 (RN-09, RN-10): the student gets exactly the keys of section 5, and the state of the clearance is theirs alone: the
// optional parts are left out when they have no value.
func TestHandler_MyAccessHasExactlyTheStudentKeys(t *testing.T) {
	srv, svc, userID := setup(authn.RoleStudent)
	defer srv.Close()
	classID, id := uuid.New(), uuid.New()

	svc.access = service.MyAccess{
		Allowed: false, Reason: domain.AccessNotCleared, Modality: domain.ModalityInPerson, RequiresClearance: true,
		Clearance: &service.OwnClearance{Status: domain.ClearanceRejected, RejectionReason: ptr("Reprovado por faltas")},
	}
	status, body := call(t, srv, http.MethodGet, assessmentPath(classID, id)+"/my-access", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, sorted("allowed", "reason", "modality", "requiresClearance", "clearance", "serverNow"), keysOf(body))
	assert.Equal(t, []string{"MyAccess"}, svc.calls)
	assert.Equal(t, authn.RoleStudent, svc.actor.Role)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, id, svc.id)
	assert.Equal(t, false, body["allowed"])
	assert.Equal(t, "NOT_CLEARED", body["reason"])
	assert.Equal(t, "IN_PERSON", body["modality"])
	assert.Equal(t, true, body["requiresClearance"])
	assert.Equal(t, "2026-10-20T08:00:00-03:00", body["serverNow"])
	own := object(t, body["clearance"])
	assert.Equal(t, sorted("status", "rejectionReason"), keysOf(own))
	assert.Equal(t, "REJECTED", own["status"])
	assert.Equal(t, "Reprovado por faltas", own["rejectionReason"])

	svc.access.Clearance = &service.OwnClearance{Status: domain.ClearancePending}
	_, body = call(t, srv, http.MethodGet, assessmentPath(classID, id)+"/my-access", nil)
	assert.Equal(t, []string{"status"}, keysOf(object(t, body["clearance"])), "no reason, no key")

	svc.access = service.MyAccess{Allowed: true, Reason: domain.AccessAllowed, Modality: domain.ModalityOnline}
	_, body = call(t, srv, http.MethodGet, assessmentPath(classID, id)+"/my-access", nil)
	assert.Equal(t, sorted("allowed", "reason", "modality", "requiresClearance", "serverNow"), keysOf(body), "without the requirement there is no clearance")
	assert.Equal(t, false, body["requiresClearance"])
	for _, other := range []string{"students", "items", "counts", "teacherPrivateNotes", "clearances"} {
		assert.NotContains(t, body, other, "nothing of the others")
	}
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

// ---- RN-05, RN-06: the teacher ----

// Covers SPEC-076 CA-05, CA-06, CA-07 (section 5): the list has the keys of the spec, each state with its own optional fields; approving all sends
// the action alone; an update sends each student with the status and the reason.
func TestHandler_ClearancesParseTheBodyAndAnswerTheList(t *testing.T) {
	for _, role := range []string{authn.RoleTeacher, authn.RoleAdmin} {
		srv, svc, userID := setup(role)
		classID, id := uuid.New(), uuid.New()
		svc.clearances = aList()

		status, body := call(t, srv, http.MethodGet, clearancesPath(classID, id), nil)
		require.Equal(t, http.StatusOK, status, role)
		assert.Equal(t, sorted("requiresClearance", "items", "counts", "serverNow"), keysOf(body), role)
		assert.Equal(t, []string{"Clearances"}, svc.calls, role)
		assert.Equal(t, userID, svc.actor.UserID)
		assert.Equal(t, classID, svc.classID)
		assert.Equal(t, id, svc.id)
		assert.Equal(t, true, body["requiresClearance"])
		assert.Equal(t, "2026-10-20T08:00:00-03:00", body["serverNow"])
		counts := object(t, body["counts"])
		assert.Equal(t, sorted("pending", "approved", "rejected"), keysOf(counts))
		assert.EqualValues(t, 1, counts["pending"])
		assert.EqualValues(t, 1, counts["approved"])
		assert.EqualValues(t, 2, counts["rejected"])

		items := array(t, body["items"])
		require.Len(t, items, 4)
		assert.Equal(t, sorted("studentId", "name", "academicId", "status"), keysOf(object(t, items[0])), "waiting: nothing decided yet")
		assert.Equal(t, sorted("studentId", "name", "academicId", "status", "clearedAt", "clearedByName"), keysOf(object(t, items[1])))
		assert.Equal(t, sorted("studentId", "name", "academicId", "status", "rejectionReason", "clearedAt", "clearedByName"), keysOf(object(t, items[2])))
		assert.Equal(t, sorted("studentId", "name", "academicId", "status", "clearedAt", "clearedByName"), keysOf(object(t, items[3])), "refused without a reason has none")
		first := object(t, items[0])
		assert.Equal(t, "Ana", first["name"])
		assert.Equal(t, "1000001", first["academicId"])
		assert.Equal(t, "PENDING", first["status"])
		second := object(t, items[1])
		assert.Equal(t, "APPROVED", second["status"])
		assert.Equal(t, "2026-10-20T08:30:00-03:00", second["clearedAt"])
		assert.Equal(t, "Profa. Sediane", second["clearedByName"])
		assert.Equal(t, "Reprovada por faltas", object(t, items[2])["rejectionReason"])

		svc.calls = nil
		status, _ = call(t, srv, http.MethodPost, clearancesPath(classID, id), map[string]any{
			"action":   "APPROVE_ALL",
			"students": []map[string]any{{"studentId": uuid.NewString(), "status": "REJECTED"}}, // ignored with APPROVE_ALL
		})
		require.Equal(t, http.StatusOK, status, role)
		assert.Equal(t, []string{"Decide"}, svc.calls)
		assert.Equal(t, service.ClearanceApproveAll, svc.clearanceIn.Action)
		assert.Empty(t, svc.clearanceIn.Students, "the list is ignored with APPROVE_ALL")

		ana, bruno := uuid.New(), uuid.New()
		status, body = call(t, srv, http.MethodPost, clearancesPath(classID, id), map[string]any{
			"action": "UPDATE",
			"students": []map[string]any{
				{"studentId": ana.String(), "status": "REJECTED", "rejectionReason": "Reprovado por faltas"},
				{"studentId": bruno.String(), "status": "APPROVED"},
			},
		})
		require.Equal(t, http.StatusOK, status, role)
		assert.Equal(t, sorted("requiresClearance", "items", "counts", "serverNow"), keysOf(body), "the answer is the list, already updated")
		assert.Equal(t, service.ClearanceUpdate, svc.clearanceIn.Action)
		assert.Equal(t, []service.ClearanceDecision{
			{StudentID: ana, Status: domain.ClearanceRejected, Reason: "Reprovado por faltas"},
			{StudentID: bruno, Status: domain.ClearanceApproved},
		}, svc.clearanceIn.Students)
		srv.Close()
	}
}

// Covers SPEC-076 CA-08, CA-09, CA-10 (section 5): one case for each problem type of the clearance routes.
func TestHandler_ClearanceStatusCodesAndProblemTypes(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	cases := []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrInvalidClearance, http.StatusBadRequest, "invalid-clearance"},
		{domain.ErrStudentNotInClass, http.StatusBadRequest, "student-not-in-class"},
		{domain.ErrClearanceNotRequired, http.StatusConflict, "clearance-not-required"},
		{domain.ErrClearanceLocked, http.StatusConflict, "clearance-locked"},
		{domain.ErrAssessmentEnded, http.StatusConflict, "assessment-ended"},
		{domain.ErrAssessmentCanceled, http.StatusConflict, "assessment-canceled"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrAssessmentNotFound, http.StatusNotFound, "assessment-not-found"},
		{errors.New("the database is down"), http.StatusInternalServerError, ""},
	}
	for _, c := range cases {
		svc.err = c.err
		status, body := call(t, srv, http.MethodPost, clearancesPath(uuid.New(), uuid.New()), map[string]any{"action": "APPROVE_ALL"})
		assert.Equal(t, c.status, status, c.err.Error())
		if c.typ != "" {
			assert.Equal(t, c.typ, body["type"], c.err.Error())
		}
		status, _ = call(t, srv, http.MethodGet, clearancesPath(uuid.New(), uuid.New()), nil)
		assert.Equal(t, c.status, status, "list: "+c.err.Error())
	}
}

// Covers SPEC-076 section 5 (common errors): a value that cannot be read is a bad request and the service is not called: a state that does not
// exist, an id that is not a UUID, a body that is not JSON. A wrong action is the service's to refuse.
func TestHandler_ClearanceBadInputIsABadRequest(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	c, a := uuid.New(), uuid.New()

	for name, body := range map[string]any{
		"a state that does not exist": map[string]any{"action": "UPDATE", "students": []map[string]any{{"studentId": uuid.NewString(), "status": "MAYBE"}}},
		"a student id that is no id":  map[string]any{"action": "UPDATE", "students": []map[string]any{{"studentId": "ana", "status": "APPROVED"}}},
		"a body that is no JSON":      "{not json",
		"a list that is no list":      map[string]any{"action": "UPDATE", "students": "all"},
	} {
		status, got := call(t, srv, http.MethodPost, clearancesPath(c, a), body)
		assert.Equal(t, http.StatusBadRequest, status, name)
		assert.Equal(t, "malformed-request", got["type"], name)
	}
	status, got := call(t, srv, http.MethodPost, classPath(c)+"/assessments/not-an-id/clearances", map[string]any{"action": "APPROVE_ALL"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", got["type"])
	status, got = call(t, srv, http.MethodGet, classPath(c)+"/assessments/not-an-id/my-access", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", got["type"])
	assert.Empty(t, svc.calls, "nothing reached the service")

	svc.err = domain.ErrInvalidClearance
	status, got = call(t, srv, http.MethodPost, clearancesPath(c, a), map[string]any{"action": "ERASE"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-clearance", got["type"], "an action that does not exist goes to the service, which refuses it")
	assert.Equal(t, service.ClearanceAction("ERASE"), svc.clearanceIn.Action)
}

// Covers SPEC-076 CA-13: the three routes need a session; the student is handed to the service on the teacher's routes, which refuses; the teacher
// is handed to the service on the student's route.
func TestHandler_ClearanceRolesAndAuthentication(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	c, a := uuid.New(), uuid.New()
	routes := []struct{ method, path string }{
		{http.MethodGet, clearancesPath(c, a)},
		{http.MethodPost, clearancesPath(c, a)},
		{http.MethodGet, assessmentPath(c, a) + "/my-access"},
	}
	for _, r := range routes {
		status, body := send(t, srv, r.method, r.path, map[string]any{"action": "APPROVE_ALL"}, false)
		assert.Equal(t, http.StatusUnauthorized, status, r.method+" "+r.path)
		assert.Equal(t, "not-authenticated", body["type"])
	}
	assert.Empty(t, svc.calls)

	student, svcStudent, _ := setup(authn.RoleStudent)
	defer student.Close()
	svcStudent.err = domain.ErrForbidden
	for _, r := range routes[:2] {
		status, body := call(t, student, r.method, r.path, map[string]any{"action": "APPROVE_ALL"})
		assert.Equal(t, http.StatusForbidden, status, r.method+" "+r.path)
		assert.Equal(t, "forbidden", body["type"])
	}
	assert.Equal(t, authn.RoleStudent, svcStudent.actor.Role, "the service knows who asked")
}

// ---- RN-01, RN-02, RN-13: the assessment itself ----

// Covers SPEC-076 CA-01, CA-03, CA-04 (section 5, "rotas existentes"): the create and the update take the modality and the requirement, leave them
// unset when they are not sent, and answer with them and with the counters.
func TestHandler_CreateAndUpdateAcceptModalityAndRequirement(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id := uuid.New(), uuid.New()
	svc.summary = service.Summary{
		Public: minimalPublic(), Modality: domain.ModalityInPerson, RequiresClearance: true,
		ClearanceCounts: service.ClearanceCounts{Pending: 2, Approved: 1, Rejected: 3},
	}

	status, got := call(t, srv, http.MethodPost, classPath(classID)+"/assessments", createBody(nil))
	require.Equal(t, http.StatusCreated, status)
	assert.Nil(t, svc.create.Modality, "not sent, so the service chooses by the type")
	assert.Nil(t, svc.create.RequiresClearance)
	assert.Equal(t, "IN_PERSON", got["modality"])
	assert.Equal(t, true, got["requiresClearance"])
	counts := object(t, got["clearanceCounts"])
	assert.Equal(t, sorted("pending", "approved", "rejected"), keysOf(counts))
	assert.EqualValues(t, 2, counts["pending"])
	assert.EqualValues(t, 1, counts["approved"])
	assert.EqualValues(t, 3, counts["rejected"])

	call(t, srv, http.MethodPost, classPath(classID)+"/assessments", createBody(map[string]any{"modality": "ONLINE", "requiresClearance": false}))
	require.NotNil(t, svc.create.Modality)
	assert.Equal(t, domain.ModalityOnline, *svc.create.Modality)
	require.NotNil(t, svc.create.RequiresClearance)
	assert.False(t, *svc.create.RequiresClearance)

	call(t, srv, http.MethodPost, classPath(classID)+"/assessments", createBody(map[string]any{"modality": "HYBRID"}))
	require.NotNil(t, svc.create.Modality)
	assert.Equal(t, domain.Modality("HYBRID"), *svc.create.Modality, "the service refuses what it does not know, with invalid-assessment")

	status, _ = call(t, srv, http.MethodPatch, assessmentPath(classID, id), map[string]any{"modality": "IN_PERSON", "requiresClearance": true})
	require.Equal(t, http.StatusOK, status)
	require.NotNil(t, svc.update.Modality)
	assert.Equal(t, domain.ModalityInPerson, *svc.update.Modality)
	require.NotNil(t, svc.update.RequiresClearance)
	assert.True(t, *svc.update.RequiresClearance)

	call(t, srv, http.MethodPatch, assessmentPath(classID, id), map[string]any{"title": "Prova 1"})
	assert.Nil(t, svc.update.Modality, "left out, left as it is")
	assert.Nil(t, svc.update.RequiresClearance)

	svc.err = domain.ErrAssessmentFrozen
	status, got = call(t, srv, http.MethodPatch, assessmentPath(classID, id), map[string]any{"modality": "ONLINE", "requiresClearance": false})
	assert.Equal(t, http.StatusConflict, status)
	assert.Equal(t, "assessment-frozen", got["type"])
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
