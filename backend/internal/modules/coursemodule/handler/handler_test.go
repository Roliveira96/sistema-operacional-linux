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

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
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
	modules      map[uuid.UUID]domain.CourseModule
	details      map[uuid.UUID]repository.ModuleDetails
	createErr    error
	updateErr    error
	getErr       error
	listErr      error
	listPubErr   error
	reorderErr   error
	lastUpdate   service.UpdateModuleInput
	lastCreate   service.CreateModuleInput
}

func newFakeService() *fakeService {
	return &fakeService{
		modules: make(map[uuid.UUID]domain.CourseModule),
		details: make(map[uuid.UUID]repository.ModuleDetails),
	}
}

func (f *fakeService) CreateModule(ctx context.Context, input service.CreateModuleInput) (domain.CourseModule, error) {
	f.lastCreate = input
	if f.createErr != nil {
		return domain.CourseModule{}, f.createErr
	}
	id := uuid.New()
	mod := domain.CourseModule{
		Model:           database.Model{ID: id, CreatedAt: time.Now(), UpdatedAt: time.Now()},
		TeacherID:       input.TeacherID,
		Title:           input.Title,
		Description:     input.Description,
		Visibility:      input.Visibility,
		Status:          domain.ModuleStatusActive,
		ActivationStart: input.ActivationStart,
		ActivationEnd:   input.ActivationEnd,
	}
	f.modules[id] = mod
	f.details[id] = repository.ModuleDetails{
		Module:           mod,
		AssignedClassIDs: input.ClassIDs,
	}
	return mod, nil
}

func (f *fakeService) UpdateModule(ctx context.Context, input service.UpdateModuleInput) (domain.CourseModule, error) {
	if f.updateErr != nil {
		return domain.CourseModule{}, f.updateErr
	}
	f.lastUpdate = input
	mod, ok := f.modules[input.ModuleID]
	if !ok {
		return domain.CourseModule{}, domain.ErrModuleNotFound
	}
	if !input.IsAdmin && mod.TeacherID != input.CallerID {
		return domain.CourseModule{}, domain.ErrForbidden
	}
	if input.Title != nil {
		mod.Title = *input.Title
	}
	if input.Description != nil {
		mod.Description = *input.Description
	}
	if input.Visibility != nil {
		mod.Visibility = *input.Visibility
	}
	if input.Status != nil {
		mod.Status = *input.Status
	}
	if input.ActivationStart.Set {
		mod.ActivationStart = input.ActivationStart.Value
	}
	if input.ActivationEnd.Set {
		mod.ActivationEnd = input.ActivationEnd.Value
	}
	if input.Slug.Set {
		mod.Slug = input.Slug.Value
	}
	f.modules[input.ModuleID] = mod
	det := f.details[input.ModuleID]
	det.Module = mod
	if input.ClassIDs != nil {
		det.AssignedClassIDs = input.ClassIDs
	}
	f.details[input.ModuleID] = det
	return mod, nil
}

func (f *fakeService) GetModuleByID(ctx context.Context, moduleID uuid.UUID, userCtx service.UserAccessContext) (repository.ModuleDetails, error) {
	if f.getErr != nil {
		return repository.ModuleDetails{}, f.getErr
	}
	det, ok := f.details[moduleID]
	if !ok {
		return repository.ModuleDetails{}, domain.ErrModuleNotFound
	}
	if !det.Module.IsActiveNow(time.Now()) && !userCtx.IsTeacher && !userCtx.IsAdmin {
		return repository.ModuleDetails{}, domain.ErrModuleExpired
	}
	return det, nil
}

func (f *fakeService) ListModules(ctx context.Context, userCtx service.UserAccessContext, filter repository.ListFilter) (repository.ListResult, error) {
	if f.listErr != nil {
		return repository.ListResult{}, f.listErr
	}
	var items []repository.ModuleSummary
	for _, m := range f.modules {
		items = append(items, repository.ModuleSummary{
			CourseModule:   m,
			TotalExercises: 2,
			TotalMaterials: 1,
		})
	}
	return repository.ListResult{
		Items:      items,
		TotalCount: int64(len(items)),
		Page:       1,
		Limit:      10,
	}, nil
}

func (f *fakeService) ListPublicModules(ctx context.Context, filter repository.ListFilter) (repository.ListResult, error) {
	if f.listPubErr != nil {
		return repository.ListResult{}, f.listPubErr
	}
	var items []repository.ModuleSummary
	for _, m := range f.modules {
		if m.Visibility == domain.VisibilityPublic && m.Status == domain.ModuleStatusActive {
			items = append(items, repository.ModuleSummary{
				CourseModule:   m,
				TotalExercises: 1,
				TotalMaterials: 1,
			})
		}
	}
	return repository.ListResult{
		Items:      items,
		TotalCount: int64(len(items)),
		Page:       1,
		Limit:      10,
	}, nil
}

func (f *fakeService) ReorderExercises(ctx context.Context, moduleID, callerID uuid.UUID, isAdmin bool, exerciseIDs []uuid.UUID) error {
	if f.reorderErr != nil {
		return f.reorderErr
	}
	mod, ok := f.modules[moduleID]
	if !ok {
		return domain.ErrModuleNotFound
	}
	if !isAdmin && mod.TeacherID != callerID {
		return domain.ErrForbidden
	}
	return nil
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
		req.AddCookie(&http.Cookie{
			Name:  authn.CookieName,
			Value: "dummy-session-token",
		})
	}

	resp, err := srv.Client().Do(req)
	require.NoError(t, err)
	return resp
}

func TestHandler_CreateModule(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	t.Run("401 without cookie", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPost, "/api/v1/modules", map[string]any{
			"title": "Title",
		}, false)
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("403 for student", func(t *testing.T) {
		studentSrv, _, _ := setupServer(authn.RoleStudent)
		defer studentSrv.Close()

		resp := doRequest(t, studentSrv, http.MethodPost, "/api/v1/modules", map[string]any{
			"title": "Title",
		}, true)
		assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	})

	t.Run("400 on malformed json body", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/modules", bytes.NewReader([]byte("{invalid-json")))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "tok"})

		resp, err := srv.Client().Do(req)
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("400 on invalid date format", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPost, "/api/v1/modules", map[string]any{
			"title":           "Title",
			"description":     "Desc",
			"visibility":      "PUBLIC",
			"activationStart": "not-a-date",
		}, true)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("400 on service validation error", func(t *testing.T) {
		svc.createErr = service.ErrTitleRequired
		resp := doRequest(t, srv, http.MethodPost, "/api/v1/modules", map[string]any{
			"title":       "",
			"description": "Desc",
			"visibility":  "PUBLIC",
		}, true)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
		svc.createErr = nil
	})

	t.Run("201 creates module successfully", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPost, "/api/v1/modules", map[string]any{
			"title":       "Sistemas de Arquivos",
			"description": "VFS e inodes",
			"visibility":  "PUBLIC",
		}, true)
		assert.Equal(t, http.StatusCreated, resp.StatusCode)

		var res map[string]any
		err := json.NewDecoder(resp.Body).Decode(&res)
		require.NoError(t, err)
		assert.Equal(t, "Sistemas de Arquivos", res["title"])
		assert.Equal(t, teacherID.String(), res["teacherId"])
	})
}

func TestHandler_GetModule(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	modID := uuid.New()
	svc.modules[modID] = domain.CourseModule{
		Model:       database.Model{ID: modID, CreatedAt: time.Now()},
		TeacherID:   teacherID,
		Title:       "Módulo Público",
		Description: "Aulas",
		Visibility:  domain.VisibilityPublic,
		Status:      domain.ModuleStatusActive,
	}
	svc.details[modID] = repository.ModuleDetails{
		Module: svc.modules[modID],
		ExerciseItems: []domain.ModuleExerciseItem{
			{ID: uuid.New(), ModuleID: modID, ExerciseID: uuid.New(), SequenceOrder: 1, IsMandatory: true},
		},
		Materials: []domain.ModuleMaterial{
			{Model: database.Model{ID: uuid.New()}, ModuleID: modID, Title: "PDF", URL: "https://example.com/pdf"},
		},
		TotalExercises: 1,
		TotalMaterials: 1,
	}

	t.Run("400 on invalid uuid parameter", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules/invalid-uuid", nil, false)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("404 when module does not exist", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules/"+uuid.New().String(), nil, false)
		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	})

	t.Run("403 when module is expired", func(t *testing.T) {
		svc.getErr = domain.ErrModuleExpired
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules/"+modID.String(), nil, false)
		assert.Equal(t, http.StatusForbidden, resp.StatusCode)
		svc.getErr = nil
	})

	t.Run("200 anonymous gets public module", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules/"+modID.String(), nil, false)
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var res map[string]any
		err := json.NewDecoder(resp.Body).Decode(&res)
		require.NoError(t, err)
		assert.Equal(t, "Módulo Público", res["title"])
		assert.Equal(t, float64(1), res["totalExercises"])
	})
}

func TestHandler_ListPublicModules(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	modID := uuid.New()
	svc.modules[modID] = domain.CourseModule{
		Model:       database.Model{ID: modID, CreatedAt: time.Now()},
		TeacherID:   teacherID,
		Title:       "Public Module",
		Description: "For everyone",
		Visibility:  domain.VisibilityPublic,
		Status:      domain.ModuleStatusActive,
	}

	t.Run("200 lists public modules anonymously", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules/public?page=1&limit=5", nil, false)
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var res map[string]any
		err := json.NewDecoder(resp.Body).Decode(&res)
		require.NoError(t, err)
		assert.Equal(t, float64(1), res["total"])
	})

	t.Run("500 on unexpected service error", func(t *testing.T) {
		svc.listPubErr = assert.AnError
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules/public", nil, false)
		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)
		svc.listPubErr = nil
	})
}

func TestHandler_ListModules(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	modID := uuid.New()
	svc.modules[modID] = domain.CourseModule{
		Model:       database.Model{ID: modID, CreatedAt: time.Now()},
		TeacherID:   teacherID,
		Title:       "My Module",
		Description: "Teacher's module",
		Visibility:  domain.VisibilityPrivate,
		Status:      domain.ModuleStatusActive,
	}

	t.Run("401 without cookie", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules", nil, false)
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("200 with cookie for teacher", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodGet, "/api/v1/modules?page=1&limit=10", nil, true)
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var res map[string]any
		err := json.NewDecoder(resp.Body).Decode(&res)
		require.NoError(t, err)
		assert.Equal(t, float64(1), res["total"])
	})
}

func TestHandler_UpdateModule(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	modID := uuid.New()
	svc.modules[modID] = domain.CourseModule{
		Model:       database.Model{ID: modID, CreatedAt: time.Now()},
		TeacherID:   teacherID,
		Title:       "Original",
		Description: "Desc",
		Visibility:  domain.VisibilityPublic,
		Status:      domain.ModuleStatusActive,
	}
	svc.details[modID] = repository.ModuleDetails{Module: svc.modules[modID]}

	t.Run("401 without cookie", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPatch, "/api/v1/modules/"+modID.String(), map[string]any{
			"title": "New Title",
		}, false)
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("400 on invalid uuid", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPatch, "/api/v1/modules/not-a-uuid", map[string]any{
			"title": "New",
		}, true)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("400 on invalid date format", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPatch, "/api/v1/modules/"+modID.String(), map[string]any{
			"activationEnd": "bad-date",
		}, true)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("400 on service error", func(t *testing.T) {
		svc.updateErr = service.ErrTitleRequired
		resp := doRequest(t, srv, http.MethodPatch, "/api/v1/modules/"+modID.String(), map[string]any{
			"title": "",
		}, true)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
		svc.updateErr = nil
	})

	t.Run("200 updates module successfully", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPatch, "/api/v1/modules/"+modID.String(), map[string]any{
			"title":  "Updated Title",
			"status": "INACTIVE",
		}, true)
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var res map[string]any
		err := json.NewDecoder(resp.Body).Decode(&res)
		require.NoError(t, err)
		assert.Equal(t, "Updated Title", res["title"])
		assert.Equal(t, "INACTIVE", res["status"])
	})
}

func TestHandler_ReorderExercises(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	modID := uuid.New()
	svc.modules[modID] = domain.CourseModule{
		Model:       database.Model{ID: modID, CreatedAt: time.Now()},
		TeacherID:   teacherID,
		Title:       "Module",
		Description: "Desc",
	}

	ex1 := uuid.New()
	ex2 := uuid.New()

	t.Run("401 without cookie", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPut, "/api/v1/modules/"+modID.String()+"/exercises/order", map[string]any{
			"orderedExerciseIds": []string{ex1.String(), ex2.String()},
		}, false)
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("400 on invalid uuid", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPut, "/api/v1/modules/invalid-id/exercises/order", map[string]any{
			"orderedExerciseIds": []string{ex1.String()},
		}, true)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("400 on malformed json body", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodPut, srv.URL+"/api/v1/modules/"+modID.String()+"/exercises/order", bytes.NewReader([]byte("{invalid-json")))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "tok"})

		resp, err := srv.Client().Do(req)
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})

	t.Run("200 reorders successfully", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPut, "/api/v1/modules/"+modID.String()+"/exercises/order", map[string]any{
			"orderedExerciseIds": []string{ex2.String(), ex1.String()},
		}, true)
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var res map[string]any
		err := json.NewDecoder(resp.Body).Decode(&res)
		require.NoError(t, err)
		assert.Equal(t, float64(2), res["reorderedCount"])
	})
}

func problemBody(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	return body
}

func invalidParamNames(body map[string]any) []string {
	var names []string
	for _, p := range body["invalidParams"].([]any) {
		names = append(names, p.(map[string]any)["name"].(string))
	}
	return names
}

// Covers SPEC-010: the update tells an absent field (keep) from a null (take away) from a value (set).
func TestHandler_UpdateModule_OptionalFields(t *testing.T) {
	srv, svc, teacherID := setupServer(authn.RoleTeacher)
	defer srv.Close()

	modID := uuid.New()
	start := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	slug := "historia"
	svc.modules[modID] = domain.CourseModule{
		Model: database.Model{ID: modID, CreatedAt: time.Now()}, TeacherID: teacherID, Title: "T", Description: "D",
		Visibility: domain.VisibilityPublic, Status: domain.ModuleStatusActive, ActivationStart: &start, ActivationEnd: &end, Slug: &slug,
	}
	svc.details[modID] = repository.ModuleDetails{Module: svc.modules[modID]}
	patch := func(body map[string]any) *http.Response {
		return doRequest(t, srv, http.MethodPatch, "/api/v1/modules/"+modID.String(), body, true)
	}

	t.Run("absent fields are left as they are", func(t *testing.T) {
		assert.Equal(t, http.StatusOK, patch(map[string]any{"title": "Novo"}).StatusCode)
		assert.False(t, svc.lastUpdate.ActivationStart.Set)
		assert.False(t, svc.lastUpdate.ActivationEnd.Set)
		assert.False(t, svc.lastUpdate.Slug.Set)
	})

	t.Run("null takes a date and the slug away", func(t *testing.T) {
		assert.Equal(t, http.StatusOK, patch(map[string]any{"activationEnd": nil, "slug": nil}).StatusCode)
		assert.True(t, svc.lastUpdate.ActivationEnd.Set)
		assert.Nil(t, svc.lastUpdate.ActivationEnd.Value)
		assert.True(t, svc.lastUpdate.Slug.Set)
		assert.Nil(t, svc.lastUpdate.Slug.Value)
		assert.False(t, svc.lastUpdate.ActivationStart.Set, "the start was not mentioned")
	})

	t.Run("an empty string takes a date away too", func(t *testing.T) {
		assert.Equal(t, http.StatusOK, patch(map[string]any{"activationStart": ""}).StatusCode)
		assert.True(t, svc.lastUpdate.ActivationStart.Set)
		assert.Nil(t, svc.lastUpdate.ActivationStart.Value)
	})

	t.Run("values set the date and the slug", func(t *testing.T) {
		assert.Equal(t, http.StatusOK, patch(map[string]any{"activationStart": "2026-11-01T10:00:00Z", "slug": "novo-slug"}).StatusCode)
		require.NotNil(t, svc.lastUpdate.ActivationStart.Value)
		assert.Equal(t, time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC), *svc.lastUpdate.ActivationStart.Value)
		assert.Equal(t, "novo-slug", *svc.lastUpdate.Slug.Value)
	})

	t.Run("a date that is not RFC 3339 is a 400 that names the field", func(t *testing.T) {
		for _, field := range []string{"activationStart", "activationEnd"} {
			resp := patch(map[string]any{field: "31/12/2026"})
			assert.Equal(t, http.StatusBadRequest, resp.StatusCode, field)
			body := problemBody(t, resp)
			assert.Equal(t, "invalid-date-format", body["type"])
			assert.Equal(t, []string{field}, invalidParamNames(body))
		}
	})

	t.Run("an end before the start is a 400 that names the end", func(t *testing.T) {
		svc.updateErr = domain.ErrInvalidDateRange
		resp := patch(map[string]any{"activationEnd": "2026-01-01T00:00:00Z"})
		svc.updateErr = nil
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
		body := problemBody(t, resp)
		assert.Equal(t, "invalid-date-range", body["type"])
		assert.Equal(t, []string{"activationEnd"}, invalidParamNames(body))
	})

	t.Run("an invalid slug is a 400 and a slug in use is a 409, both naming the slug", func(t *testing.T) {
		svc.updateErr = domain.ErrInvalidSlug
		resp := patch(map[string]any{"slug": "Nao Pode"})
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
		body := problemBody(t, resp)
		assert.Equal(t, "invalid-slug", body["type"])
		assert.Equal(t, []string{"slug"}, invalidParamNames(body))

		svc.updateErr = domain.ErrSlugTaken
		resp = patch(map[string]any{"slug": "pacotes"})
		assert.Equal(t, http.StatusConflict, resp.StatusCode)
		body = problemBody(t, resp)
		assert.Equal(t, "slug-taken", body["type"])
		assert.Equal(t, []string{"slug"}, invalidParamNames(body))
		svc.updateErr = nil
	})

	t.Run("creating accepts a slug and reports a slug in use as 409", func(t *testing.T) {
		resp := doRequest(t, srv, http.MethodPost, "/api/v1/modules", map[string]any{
			"title": "Novo", "description": "D", "visibility": "PUBLIC", "slug": "meu-novo",
		}, true)
		assert.Equal(t, http.StatusCreated, resp.StatusCode)
		require.NotNil(t, svc.lastCreate.Slug)
		assert.Equal(t, "meu-novo", *svc.lastCreate.Slug)

		svc.createErr = domain.ErrSlugTaken
		resp = doRequest(t, srv, http.MethodPost, "/api/v1/modules", map[string]any{
			"title": "Novo", "description": "D", "visibility": "PUBLIC", "slug": "meu-novo",
		}, true)
		assert.Equal(t, http.StatusConflict, resp.StatusCode)
		svc.createErr = nil
	})
}
