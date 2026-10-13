package handler_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

type enrollCall struct {
	actorID    uuid.UUID
	actorRole  string
	classID    uuid.UUID
	studentIDs []uuid.UUID
}

func (f *fakeService) EnrollStudents(ctx context.Context, actorID uuid.UUID, actorRole string, classID uuid.UUID, studentIDs []uuid.UUID) (service.EnrollStudentsResult, error) {
	f.enrollCall = &enrollCall{actorID: actorID, actorRole: actorRole, classID: classID, studentIDs: studentIDs}
	return f.enrollResult, f.enrollErr
}

func (f *fakeService) GetMyClass(ctx context.Context, studentID, classID uuid.UUID) (service.StudentClassView, error) {
	return f.myClass, f.myClassErr
}

func readJSON(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body), string(raw))
	return body
}

// Covers SPEC-041 section 5.1, CA-03, CA-05 and CA-06: body validation, the result of the batch and the problems.
func TestEnrollmentsRoute_ValidationAndProblems(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()
	classID := uuid.New()
	path := "/api/v1/classes/" + classID.String() + "/enrollments"
	a, b, c := uuid.New(), uuid.New(), uuid.New()

	t.Run("returns the three groups", func(t *testing.T) {
		svc.enrollResult = service.EnrollStudentsResult{
			Enrolled:        []uuid.UUID{a},
			AlreadyEnrolled: []uuid.UUID{b},
			Rejected:        []service.RejectedStudent{{StudentID: c, Reason: domain.RejectReasonNotAStudent}},
		}
		res := doRequest(t, srv, http.MethodPost, path, map[string]any{"studentIds": []uuid.UUID{a, b, c}}, true)
		require.Equal(t, http.StatusOK, res.StatusCode)
		body := readJSON(t, res)
		assert.Equal(t, []any{a.String()}, body["enrolled"])
		assert.Equal(t, []any{b.String()}, body["alreadyEnrolled"])
		assert.Equal(t, []any{map[string]any{"studentId": c.String(), "reason": "not-a-student"}}, body["rejected"])
		require.NotNil(t, svc.enrollCall)
		assert.Equal(t, teacherID, svc.enrollCall.actorID)
		assert.Equal(t, authn.RoleTeacher, svc.enrollCall.actorRole)
		assert.Equal(t, classID, svc.enrollCall.classID)
	})

	t.Run("empty groups are empty lists", func(t *testing.T) {
		svc.enrollResult = service.EnrollStudentsResult{}
		res := doRequest(t, srv, http.MethodPost, path, map[string]any{"studentIds": []uuid.UUID{a}}, true)
		require.Equal(t, http.StatusOK, res.StatusCode)
		body := readJSON(t, res)
		assert.Equal(t, []any{}, body["enrolled"])
		assert.Equal(t, []any{}, body["alreadyEnrolled"])
		assert.Equal(t, []any{}, body["rejected"])
	})

	for name, body := range map[string]any{
		"missing list": map[string]any{},
		"empty list":   map[string]any{"studentIds": []uuid.UUID{}},
		"not a uuid":   map[string]any{"studentIds": []string{"abc"}},
		"too many":     map[string]any{"studentIds": make([]uuid.UUID, domain.MaxEnrollmentBatch+1)},
	} {
		t.Run(name, func(t *testing.T) {
			res := doRequest(t, srv, http.MethodPost, path, body, true)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			assert.Equal(t, "malformed-request", readJSON(t, res)["type"])
		})
	}

	for err, want := range map[error][2]any{
		domain.ErrForbidden:     {http.StatusForbidden, "forbidden"},
		domain.ErrClassNotFound: {http.StatusNotFound, "class-not-found"},
		domain.ErrClassArchived: {http.StatusConflict, "class-archived"},
	} {
		svc.enrollErr = err
		res := doRequest(t, srv, http.MethodPost, path, map[string]any{"studentIds": []uuid.UUID{a}}, true)
		require.Equal(t, want[0], res.StatusCode, want[1])
		assert.Equal(t, want[1], readJSON(t, res)["type"])
	}

	res := doRequest(t, srv, http.MethodPost, "/api/v1/classes/abc/enrollments", map[string]any{"studentIds": []uuid.UUID{a}}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
	_ = res.Body.Close()
}

// Covers SPEC-041 section 5.1: a student cannot enroll anyone.
func TestEnrollmentsRoute_StudentForbidden(t *testing.T) {
	srv, _, _ := setupServer(authn.RoleStudent)
	defer srv.Close()
	res := doRequest(t, srv, http.MethodPost, "/api/v1/classes/"+uuid.New().String()+"/enrollments",
		map[string]any{"studentIds": []uuid.UUID{uuid.New()}}, true)
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
	_ = res.Body.Close()
}

// Covers SPEC-041 section 5.2, CA-14: roles, invalid id and the 404 of a class the student cannot read.
func TestMyClassRoute_RolesAndNotFound(t *testing.T) {
	srv, svc, _ := setupServer(authn.RoleStudent)
	defer srv.Close()

	res := doRequest(t, srv, http.MethodGet, "/api/v1/me/classes/"+uuid.New().String(), nil, false)
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
	_ = res.Body.Close()

	res = doRequest(t, srv, http.MethodGet, "/api/v1/me/classes/abc", nil, true)
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
	assert.Equal(t, "invalid-uuid", readJSON(t, res)["type"])

	svc.myClassErr = domain.ErrClassNotFound
	res = doRequest(t, srv, http.MethodGet, "/api/v1/me/classes/"+uuid.New().String(), nil, true)
	require.Equal(t, http.StatusNotFound, res.StatusCode)
	assert.Equal(t, "class-not-found", readJSON(t, res)["type"])

	teacherSrv, _, _ := setupServer(authn.RoleTeacher)
	defer teacherSrv.Close()
	res = doRequest(t, teacherSrv, http.MethodGet, "/api/v1/me/classes/"+uuid.New().String(), nil, true)
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
	_ = res.Body.Close()
}

// Covers SPEC-041 RN-09 and CA-13: the student reads only the presentation of the class.
func TestMyClassRoute_HidesTeacherOnlyFields(t *testing.T) {
	srv, svc, _ := setupServer(authn.RoleStudent)
	defer srv.Close()
	token := "secret-token"
	reason := "fim"
	teacherName := "Profa. Sediane"
	start := time.Date(2026, 8, 1, 3, 0, 0, 0, time.UTC)
	id := uuid.New()
	svc.myClass = service.StudentClassView{
		Class: domain.ClassGroup{
			Model: database.Model{ID: id}, TeacherID: uuid.New(), Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
			Summary: "Resumo", Syllabus: "<p>Ementa</p>", InstitutionalGuidelines: "<p>Regras</p>",
			StartDate: start, EndDate: start.Add(time.Hour), ScheduleDescription: "Seg 08:20",
			EnableVirtualClassroom: true, EnableInviteLink: true, InviteLinkToken: &token,
			Status: domain.ClassStatusArchived, ArchiveReason: &reason,
		},
		TeacherName: &teacherName,
	}

	res := doRequest(t, srv, http.MethodGet, "/api/v1/me/classes/"+id.String(), nil, true)
	require.Equal(t, http.StatusOK, res.StatusCode)
	body := readJSON(t, res)
	keys := make([]string, 0, len(body))
	for k := range body {
		keys = append(keys, k)
	}
	assert.ElementsMatch(t, []string{"id", "name", "courseCode", "semester", "status", "summary", "syllabus",
		"institutionalGuidelines", "startDate", "endDate", "scheduleDescription", "enableVirtualClassroom", "teacherName"}, keys)
	assert.Equal(t, "Resumo", body["summary"])
	assert.Equal(t, "<p>Ementa</p>", body["syllabus"])
	assert.Equal(t, teacherName, body["teacherName"])
}

// Covers SPEC-041 section 5.3 and CA-10: create and update carry the summary, and its errors are problems on the field.
func TestClassRoutes_SummaryAndContentErrors(t *testing.T) {
	srv, svc, _ := setupServer(authn.RoleTeacher)
	defer srv.Close()
	body := map[string]any{
		"name": "SO", "courseCode": "SO34E", "semester": "2026/2", "summary": "Resumo curto",
		"startDate": "2026-08-01T03:00:00Z", "endDate": "2026-12-01T02:59:59Z",
	}
	res := doRequest(t, srv, http.MethodPost, "/api/v1/classes", body, true)
	require.Equal(t, http.StatusCreated, res.StatusCode)
	_ = res.Body.Close()
	require.NotNil(t, svc.createInput)
	assert.Equal(t, "Resumo curto", svc.createInput.Summary)

	svc.createErr = domain.ErrSummaryTooLong
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", body, true)
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
	problem := readJSON(t, res)
	assert.Equal(t, "invalid-summary", problem["type"])
	assert.Equal(t, "summary", problem["field"])

	svc.createErr = domain.ErrContentTooLong
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", body, true)
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
	assert.Equal(t, "content-too-long", readJSON(t, res)["type"])
}
