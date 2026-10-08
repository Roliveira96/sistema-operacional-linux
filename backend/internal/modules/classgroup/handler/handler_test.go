package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeValidator struct {
	principal authn.Principal
	err       error
}

func (f *fakeValidator) Authenticate(ctx context.Context, token string) (authn.Principal, error) {
	if f.err != nil {
		return authn.Principal{}, f.err
	}
	return f.principal, nil
}

type fakeService struct {
	classes      map[uuid.UUID]domain.ClassGroup
	enrollments  map[uuid.UUID]domain.Enrollment
	createErr    error
	listErr      error
	getErr       error
	updateErr    error
	archiveErr   error
	joinErr      error
	listMemErr   error
	moderateErr  error
}

func newFakeService() *fakeService {
	return &fakeService{
		classes:     make(map[uuid.UUID]domain.ClassGroup),
		enrollments: make(map[uuid.UUID]domain.Enrollment),
	}
}

func (f *fakeService) CreateClass(ctx context.Context, teacherID uuid.UUID, input service.CreateClassInput) (domain.ClassGroup, error) {
	if f.createErr != nil {
		return domain.ClassGroup{}, f.createErr
	}
	tok := "token123"
	class := domain.ClassGroup{
		Model:                   database.Model{ID: uuid.New(), CreatedAt: time.Now(), UpdatedAt: time.Now()},
		TeacherID:               teacherID,
		Name:                    input.Name,
		CourseCode:              input.CourseCode,
		Semester:                input.Semester,
		Syllabus:                input.Syllabus,
		InstitutionalGuidelines: input.InstitutionalGuidelines,
		StartDate:               input.StartDate,
		EndDate:                 input.EndDate,
		ScheduleDescription:     input.ScheduleDescription,
		EnableVirtualClassroom:  input.EnableVirtualClassroom,
		EnableInviteLink:        input.EnableInviteLink,
		InviteLinkToken:         &tok,
		Status:                  domain.ClassStatusActive,
	}
	f.classes[class.ID] = class
	return class, nil
}

func (f *fakeService) ListClasses(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error) {
	if f.listErr != nil {
		return repository.ListResult{}, f.listErr
	}
	var items []repository.ClassSummary
	for _, c := range f.classes {
		if c.TeacherID == teacherID {
			items = append(items, repository.ClassSummary{
				Class:                c,
				TotalActiveStudents:  5,
				TotalPendingRequests: 1,
			})
		}
	}
	return repository.ListResult{
		Items:      items,
		TotalCount: int64(len(items)),
		Page:       filter.Page,
		Limit:      filter.Limit,
	}, nil
}

func (f *fakeService) GetClass(ctx context.Context, teacherID, classID uuid.UUID) (domain.ClassGroup, error) {
	if f.getErr != nil {
		return domain.ClassGroup{}, f.getErr
	}
	c, ok := f.classes[classID]
	if !ok {
		return domain.ClassGroup{}, domain.ErrClassNotFound
	}
	if c.TeacherID != teacherID {
		return domain.ClassGroup{}, domain.ErrForbidden
	}
	return c, nil
}

func (f *fakeService) UpdateClass(ctx context.Context, teacherID, classID uuid.UUID, input service.UpdateClassInput) (domain.ClassGroup, error) {
	if f.updateErr != nil {
		return domain.ClassGroup{}, f.updateErr
	}
	c, ok := f.classes[classID]
	if !ok {
		return domain.ClassGroup{}, domain.ErrClassNotFound
	}
	if c.TeacherID != teacherID {
		return domain.ClassGroup{}, domain.ErrForbidden
	}
	if input.Name != nil {
		c.Name = *input.Name
	}
	f.classes[classID] = c
	return c, nil
}

func (f *fakeService) ArchiveClass(ctx context.Context, teacherID, classID uuid.UUID, reason string) (domain.ClassGroup, error) {
	if f.archiveErr != nil {
		return domain.ClassGroup{}, f.archiveErr
	}
	c, ok := f.classes[classID]
	if !ok {
		return domain.ClassGroup{}, domain.ErrClassNotFound
	}
	if c.TeacherID != teacherID {
		return domain.ClassGroup{}, domain.ErrForbidden
	}
	c.Status = domain.ClassStatusArchived
	c.ArchiveReason = &reason
	f.classes[classID] = c
	return c, nil
}

func (f *fakeService) JoinByToken(ctx context.Context, studentID uuid.UUID, token string) (service.JoinResult, error) {
	if f.joinErr != nil {
		return service.JoinResult{}, f.joinErr
	}
	return service.JoinResult{
		EnrollmentID: uuid.New(),
		ClassName:    "SO Turma A",
		Status:       domain.EnrollmentPendingModeration,
	}, nil
}

func (f *fakeService) ListMembers(ctx context.Context, teacherID, classID uuid.UUID, status string) ([]repository.EnrollmentWithUser, error) {
	if f.listMemErr != nil {
		return nil, f.listMemErr
	}
	name := "Discente"
	email := "discente@utfpr.edu.br"
	ra := "1234567"
	return []repository.EnrollmentWithUser{
		{
			Enrollment: domain.Enrollment{
				Model:       database.Model{ID: uuid.New(), CreatedAt: time.Now()},
				ClassID:     classID,
				UserID:      uuid.New(),
				Status:      domain.EnrollmentPendingModeration,
				Origin:      domain.OriginInviteLink,
				RequestedAt: time.Now(),
			},
			UserName:       &name,
			UserEmail:      email,
			UserAcademicID: &ra,
		},
	}, nil
}

func (f *fakeService) ModerateMember(ctx context.Context, teacherID, classID, enrollmentID uuid.UUID, approve bool, rejectionReason *string) (domain.Enrollment, error) {
	if f.moderateErr != nil {
		return domain.Enrollment{}, f.moderateErr
	}
	status := domain.EnrollmentActive
	if !approve {
		status = domain.EnrollmentRejected
	}
	now := time.Now()
	return domain.Enrollment{
		Model:           database.Model{ID: enrollmentID},
		ClassID:         classID,
		Status:          status,
		RejectionReason: rejectionReason,
		DecidedAt:       &now,
	}, nil
}

func setupServer(role string) (*httptest.Server, *fakeService, uuid.UUID) {
	userID := uuid.New()
	validator := &fakeValidator{
		principal: authn.Principal{
			UserID: userID,
			Role:   role,
		},
	}
	svc := newFakeService()
	h := handler.New(svc, validator).WithNow(time.Now)

	engine := server.NewEngine(zap.NewNop(), nil, h)
	srv := httptest.NewServer(engine)
	return srv, svc, userID
}

func doRequest(t *testing.T, srv *httptest.Server, method, path string, body any, withCookie bool) *http.Response {
	t.Helper()
	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = json.Marshal(body)
		require.NoError(t, err)
	}

	req, err := http.NewRequest(method, srv.URL+path, bytes.NewReader(bodyBytes))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if withCookie {
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "valid-session"})
	}

	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

func TestClassEndpointsFlow(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	// 1. Unauthenticated request to teacher endpoint
	unauthRes := doRequest(t, srv, http.MethodGet, "/api/v1/classes", nil, false)
	assert.Equal(t, http.StatusUnauthorized, unauthRes.StatusCode)

	// 2. Create class
	createBody := map[string]any{
		"name":                    "Sistemas Operacionais 2026",
		"courseCode":              "SO34E",
		"semester":                "2026/2",
		"syllabus":                "Processos e escalonamento",
		"institutionalGuidelines": "Presença 75%",
		"startDate":               "2026-10-01T00:00:00Z",
		"endDate":                 "2026-12-20T23:59:59Z",
		"scheduleDescription":     "Terças e Quintas",
		"enableVirtualClassroom":  true,
		"enableInviteLink":        true,
		"inviteLinkStart":         "2026-10-01T00:00:00Z",
		"inviteLinkEnd":           "2026-10-15T23:59:59Z",
	}

	res := doRequest(t, srv, http.MethodPost, "/api/v1/classes", createBody, true)
	assert.Equal(t, http.StatusCreated, res.StatusCode)

	var created domain.ClassGroup
	err := json.NewDecoder(res.Body).Decode(&created)
	require.NoError(t, err)
	assert.NotEqual(t, uuid.Nil, created.ID)
	assert.Equal(t, "Sistemas Operacionais 2026", created.Name)

	// 3. Create validation error (missing name)
	badBody := map[string]any{
		"courseCode": "SO34E",
		"semester":   "2026/2",
		"startDate":  "2026-10-01T00:00:00Z",
		"endDate":    "2026-12-20T23:59:59Z",
	}
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", badBody, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	// 4. List classes
	res = doRequest(t, srv, http.MethodGet, "/api/v1/classes?page=1&limit=10", nil, true)
	assert.Equal(t, http.StatusOK, res.StatusCode)

	// 5. Get class by ID
	res = doRequest(t, srv, http.MethodGet, "/api/v1/classes/"+created.ID.String(), nil, true)
	assert.Equal(t, http.StatusOK, res.StatusCode)

	// 6. Update class
	newTitle := "SO 2026 - Atualizada"
	res = doRequest(t, srv, http.MethodPatch, "/api/v1/classes/"+created.ID.String(), map[string]any{
		"name": newTitle,
	}, true)
	assert.Equal(t, http.StatusOK, res.StatusCode)

	// 7. Archive class
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/"+created.ID.String()+"/archive", map[string]any{
		"reason": "Semestre concluído",
	}, true)
	assert.Equal(t, http.StatusOK, res.StatusCode)

	// 8. List members
	res = doRequest(t, srv, http.MethodGet, "/api/v1/classes/"+created.ID.String()+"/members", nil, true)
	assert.Equal(t, http.StatusOK, res.StatusCode)

	// 9. Moderate member
	memberID := uuid.New()
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/"+created.ID.String()+"/members/"+memberID.String()+"/moderate", map[string]any{
		"approve": true,
	}, true)
	assert.Equal(t, http.StatusOK, res.StatusCode)

	// 10. Student join via token
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/join/token123", nil, true)
	assert.Equal(t, http.StatusCreated, res.StatusCode)

	// Join with expired token
	svc.joinErr = domain.ErrInviteLinkExpired
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/join/expired-token", nil, true)
	assert.Equal(t, http.StatusGone, res.StatusCode)

	// Join when already enrolled
	svc.joinErr = domain.ErrAlreadyEnrolled
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/join/token123", nil, true)
	assert.Equal(t, http.StatusConflict, res.StatusCode)

	_ = teacherID
}

func TestStudentForbiddenOnTeacherRoutes(t *testing.T) {
	srv, _, _ := setupServer(authn.RoleStudent)
	defer srv.Close()

	res := doRequest(t, srv, http.MethodGet, "/api/v1/classes", nil, true)
	assert.Equal(t, http.StatusForbidden, res.StatusCode)

	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", map[string]any{"name": "test"}, true)
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
}

func TestHandlerValidationAndErrorMappings(t *testing.T) {
	srv, svc, _ := setupServer(authn.RoleTeacher)
	defer srv.Close()

	// 1. Invalid UUIDs in parameters
	res := doRequest(t, srv, http.MethodGet, "/api/v1/classes/not-a-uuid", nil, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPatch, "/api/v1/classes/not-a-uuid", map[string]any{}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/not-a-uuid/archive", map[string]any{}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodGet, "/api/v1/classes/not-a-uuid/members", nil, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/not-a-uuid/members/not-a-uuid/moderate", map[string]any{"approve": true}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	validID := uuid.New().String()
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/"+validID+"/members/not-a-uuid/moderate", map[string]any{"approve": true}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	// 2. Date parsing errors in createClass
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", map[string]any{
		"name":       "Teste",
		"courseCode": "SO34E",
		"semester":   "2026/2",
		"startDate":  "data-invalida",
		"endDate":    "2026-12-01T00:00:00Z",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", map[string]any{
		"name":       "Teste",
		"courseCode": "SO34E",
		"semester":   "2026/2",
		"startDate":  "2026-10-01T00:00:00Z",
		"endDate":    "data-invalida",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", map[string]any{
		"name":            "Teste",
		"courseCode":      "SO34E",
		"semester":        "2026/2",
		"startDate":       "2026-10-01T00:00:00Z",
		"endDate":         "2026-12-01T00:00:00Z",
		"inviteLinkStart": "data-invalida",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", map[string]any{
		"name":          "Teste",
		"courseCode":    "SO34E",
		"semester":      "2026/2",
		"startDate":     "2026-10-01T00:00:00Z",
		"endDate":       "2026-12-01T00:00:00Z",
		"inviteLinkEnd": "data-invalida",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	// 3. Date parsing errors in updateClass
	res = doRequest(t, srv, http.MethodPatch, "/api/v1/classes/"+validID, map[string]any{
		"startDate": "data-invalida",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPatch, "/api/v1/classes/"+validID, map[string]any{
		"endDate": "data-invalida",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPatch, "/api/v1/classes/"+validID, map[string]any{
		"inviteLinkStart": "data-invalida",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	res = doRequest(t, srv, http.MethodPatch, "/api/v1/classes/"+validID, map[string]any{
		"inviteLinkEnd": "data-invalida",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	// 4. Domain error mappings
	svc.createErr = domain.ErrClassConflict
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", map[string]any{
		"name":       "Teste",
		"courseCode": "SO34E",
		"semester":   "2026/2",
		"startDate":  "2026-10-01T00:00:00Z",
		"endDate":    "2026-12-01T00:00:00Z",
	}, true)
	assert.Equal(t, http.StatusConflict, res.StatusCode)

	svc.createErr = domain.ErrInvalidDateRange
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", map[string]any{
		"name":       "Teste",
		"courseCode": "SO34E",
		"semester":   "2026/2",
		"startDate":  "2026-10-01T00:00:00Z",
		"endDate":    "2026-12-01T00:00:00Z",
	}, true)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	svc.archiveErr = domain.ErrArchiveReasonRequired
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/"+validID+"/archive", map[string]any{}, true)
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)

	svc.getErr = domain.ErrClassNotFound
	res = doRequest(t, srv, http.MethodGet, "/api/v1/classes/"+validID, nil, true)
	assert.Equal(t, http.StatusNotFound, res.StatusCode)

	svc.getErr = domain.ErrForbidden
	res = doRequest(t, srv, http.MethodGet, "/api/v1/classes/"+validID, nil, true)
	assert.Equal(t, http.StatusForbidden, res.StatusCode)

	svc.moderateErr = domain.ErrEnrollmentNotFound
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes/"+validID+"/members/"+uuid.New().String()+"/moderate", map[string]any{"approve": true}, true)
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

