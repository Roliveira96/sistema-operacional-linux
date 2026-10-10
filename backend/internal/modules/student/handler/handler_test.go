package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
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

type fakeStudentService struct {
	registerManualFn func(ctx context.Context, req service.RegisterManualRequest) (service.RegisterManualResponse, error)
	importCSVFn      func(ctx context.Context, classGroupID *uuid.UUID, r io.Reader) (domain.CSVImportResult, error)
	joinByInviteFn   func(ctx context.Context, token string, req service.JoinByInviteRequest) (service.JoinByInviteResponse, error)
	updateAvatarFn   func(ctx context.Context, userID uuid.UUID, r io.Reader, size int64, contentType string) (string, error)
	getProfileFn     func(ctx context.Context, userID uuid.UUID) (domain.StudentProfileResponse, error)
	listStudentsFn   func(ctx context.Context, page, perPage int, search string) (service.ListStudentsResponse, error)
}

func (f *fakeStudentService) RegisterManual(ctx context.Context, req service.RegisterManualRequest) (service.RegisterManualResponse, error) {
	if f.registerManualFn != nil {
		return f.registerManualFn(ctx, req)
	}
	return service.RegisterManualResponse{
		ID:               uuid.New(),
		AcademicID:       req.AcademicID,
		Email:            req.Email,
		EnrollmentStatus: "NOT_ENROLLED",
		CreatedAt:        time.Now(),
	}, nil
}

func (f *fakeStudentService) ImportCSV(ctx context.Context, classGroupID *uuid.UUID, r io.Reader) (domain.CSVImportResult, error) {
	if f.importCSVFn != nil {
		return f.importCSVFn(ctx, classGroupID, r)
	}
	return domain.CSVImportResult{TotalRows: 2, Created: 2}, nil
}

func (f *fakeStudentService) JoinByInvite(ctx context.Context, token string, req service.JoinByInviteRequest) (service.JoinByInviteResponse, error) {
	if f.joinByInviteFn != nil {
		return f.joinByInviteFn(ctx, token, req)
	}
	return service.JoinByInviteResponse{
		UserID:           uuid.New(),
		AccountStatus:    "ACTIVE",
		EnrollmentStatus: "PENDING_MODERATION",
	}, nil
}

func (f *fakeStudentService) UpdateAvatar(ctx context.Context, userID uuid.UUID, r io.Reader, size int64, contentType string) (string, error) {
	if f.updateAvatarFn != nil {
		return f.updateAvatarFn(ctx, userID, r, size, contentType)
	}
	return "https://cdn.example.com/avatar.png", nil
}

func (f *fakeStudentService) GetProfile(ctx context.Context, userID uuid.UUID) (domain.StudentProfileResponse, error) {
	if f.getProfileFn != nil {
		return f.getProfileFn(ctx, userID)
	}
	return domain.StudentProfileResponse{
		ID:         userID,
		AcademicID: "1234567",
		Email:      "student@utfpr.edu.br",
		Name:       "Student Test",
	}, nil
}

func (f *fakeStudentService) ListStudents(ctx context.Context, page, perPage int, search string) (service.ListStudentsResponse, error) {
	if f.listStudentsFn != nil {
		return f.listStudentsFn(ctx, page, perPage, search)
	}
	return service.ListStudentsResponse{
		Items:      []domain.StudentSummary{},
		TotalCount: 0,
		Page:       page,
		PerPage:    perPage,
	}, nil
}

func setupTestRouter(svc *fakeStudentService, auth *fakeValidator) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := handler.New(svc, auth)
	return server.NewEngine(zap.NewNop(), nil, h)
}

func TestHandler_RegisterManual(t *testing.T) {
	t.Run("success as teacher", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{
			principal: authn.Principal{
				UserID: uuid.New(),
				Role:   authn.RoleTeacher,
			},
		}
		router := setupTestRouter(svc, auth)

		body := map[string]any{
			"academicId": "1234567",
			"email":      "student@utfpr.edu.br",
			"name":       "Carlos",
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/students", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusCreated, rec.Code)
	})

	t.Run("forbidden as student", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{
			principal: authn.Principal{
				UserID: uuid.New(),
				Role:   authn.RoleStudent,
			},
		}
		router := setupTestRouter(svc, auth)

		body := map[string]any{
			"academicId": "1234567",
			"email":      "student@utfpr.edu.br",
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/students", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("conflict email already registered", func(t *testing.T) {
		svc := &fakeStudentService{
			registerManualFn: func(ctx context.Context, req service.RegisterManualRequest) (service.RegisterManualResponse, error) {
				return service.RegisterManualResponse{}, domain.ErrEmailAlreadyRegistered
			},
		}
		auth := &fakeValidator{
			principal: authn.Principal{
				UserID: uuid.New(),
				Role:   authn.RoleTeacher,
			},
		}
		router := setupTestRouter(svc, auth)

		body := map[string]any{
			"academicId": "1234567",
			"email":      "dup@utfpr.edu.br",
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/students", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusConflict, rec.Code)
		assert.Contains(t, rec.Body.String(), "email-already-registered")
	})
}

func TestHandler_ImportCSV(t *testing.T) {
	t.Run("success multipart upload", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{
			principal: authn.Principal{
				UserID: uuid.New(),
				Role:   authn.RoleTeacher,
			},
		}
		router := setupTestRouter(svc, auth)

		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		part, err := w.CreateFormFile("file", "students.csv")
		require.NoError(t, err)
		_, _ = part.Write([]byte("email,academic_id\na@b.com,1111111\n"))
		_ = w.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/students/import-csv", &b)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), `"totalRows":2`)
	})

	t.Run("missing file returns 400", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{
			principal: authn.Principal{
				UserID: uuid.New(),
				Role:   authn.RoleTeacher,
			},
		}
		router := setupTestRouter(svc, auth)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/students/import-csv", strings.NewReader(""))
		req.Header.Set("Content-Type", "multipart/form-data")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})
}

func TestHandler_ListStudents(t *testing.T) {
	svc := &fakeStudentService{}
	auth := &fakeValidator{
		principal: authn.Principal{
			UserID: uuid.New(),
			Role:   authn.RoleTeacher,
		},
	}
	router := setupTestRouter(svc, auth)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/students?page=1&perPage=10", nil)
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestHandler_GetProfile(t *testing.T) {
	t.Run("success as student", func(t *testing.T) {
		studentID := uuid.New()
		svc := &fakeStudentService{}
		auth := &fakeValidator{
			principal: authn.Principal{
				UserID: studentID,
				Role:   authn.RoleStudent,
			},
		}
		router := setupTestRouter(svc, auth)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/students/me", nil)
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "student@utfpr.edu.br")
	})

	// SPEC-002 section 5.6: the profile uses camelCase fields, which the topic screen
	// (SPEC-016, CA-11) reads to show the academic ID and the photo.
	t.Run("uses the camelCase fields of the contract", func(t *testing.T) {
		avatar := "https://cdn.example.com/a.png"
		svc := &fakeStudentService{getProfileFn: func(_ context.Context, id uuid.UUID) (domain.StudentProfileResponse, error) {
			return domain.StudentProfileResponse{ID: id, AcademicID: "2345678", Email: "a@b.c", Name: "Ana", AvatarURL: &avatar}, nil
		}}
		auth := &fakeValidator{principal: authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}}
		router := setupTestRouter(svc, auth)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/students/me", nil)
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "2345678", body["academicId"])
		assert.Equal(t, "Ana", body["name"])
		assert.Equal(t, avatar, body["avatarUrl"])
		assert.Contains(t, body, "createdAt")
		assert.NotContains(t, body, "AcademicID")
		assert.NotContains(t, body, "whatsapp", "optional fields are left out when empty")
	})

	t.Run("forbidden as teacher", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{
			principal: authn.Principal{
				UserID: uuid.New(),
				Role:   authn.RoleTeacher,
			},
		}
		router := setupTestRouter(svc, auth)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/students/me", nil)
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusForbidden, rec.Code)
	})
}

func TestHandler_UpdateAvatar(t *testing.T) {
	svc := &fakeStudentService{}
	auth := &fakeValidator{
		principal: authn.Principal{
			UserID: uuid.New(),
			Role:   authn.RoleStudent,
		},
	}
	router := setupTestRouter(svc, auth)

	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	part, err := w.CreateFormFile("avatar", "photo.png")
	require.NoError(t, err)
	_, _ = part.Write([]byte("fake-image-bytes"))
	_ = w.Close()

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/students/me/avatar", &b)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "avatar.png")
}

func TestHandler_JoinByInvite(t *testing.T) {
	t.Run("success public registration", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{}
		router := setupTestRouter(svc, auth)

		body := map[string]any{
			"academicId": "1234567",
			"email":      "candidato@utfpr.edu.br",
			"name":       "Candidato",
			"password":   "SenhaSegura123!",
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/token-xyz/join", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusCreated, rec.Code)
		assert.Contains(t, rec.Body.String(), "PENDING_MODERATION")
	})

	t.Run("missing required fields returns 400", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{}
		router := setupTestRouter(svc, auth)

		body := map[string]any{
			"email": "incompleto@utfpr.edu.br",
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/token-xyz/join", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("rate limit exceeded returns 429", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{}
		h := handler.New(svc, auth)
		router := server.NewEngine(zap.NewNop(), nil, h)

		body := map[string]any{
			"academicId": "1234567",
			"email":      "test@utfpr.edu.br",
			"name":       "Test",
			"password":   "SenhaSegura123!",
		}
		jsonBytes, _ := json.Marshal(body)

		// Exceed rate limit (10 per hour)
		for i := 0; i < 10; i++ {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/token-xyz/join", bytes.NewReader(jsonBytes))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			assert.Equal(t, http.StatusCreated, rec.Code)
		}

		// 11th request should be rate-limited
		req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/token-xyz/join", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusTooManyRequests, rec.Code)
		assert.Contains(t, rec.Body.String(), "rate-limited")
	})

	t.Run("with custom clock", func(t *testing.T) {
		svc := &fakeStudentService{}
		auth := &fakeValidator{}
		fixedNow := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
		h := handler.New(svc, auth).WithClock(func() time.Time { return fixedNow })
		assert.NotNil(t, h)
	})
}

func TestHandler_ErrorBranches(t *testing.T) {
	svc := &fakeStudentService{
		registerManualFn: func(ctx context.Context, req service.RegisterManualRequest) (service.RegisterManualResponse, error) {
			return service.RegisterManualResponse{}, domain.ErrClassNotFound
		},
		getProfileFn: func(ctx context.Context, userID uuid.UUID) (domain.StudentProfileResponse, error) {
			return domain.StudentProfileResponse{}, domain.ErrStudentNotFound
		},
		updateAvatarFn: func(ctx context.Context, userID uuid.UUID, r io.Reader, size int64, contentType string) (string, error) {
			return "", domain.ErrUnsupportedImageFormat
		},
		listStudentsFn: func(ctx context.Context, page, perPage int, search string) (service.ListStudentsResponse, error) {
			return service.ListStudentsResponse{}, errors.New("db error")
		},
		joinByInviteFn: func(ctx context.Context, token string, req service.JoinByInviteRequest) (service.JoinByInviteResponse, error) {
			return service.JoinByInviteResponse{}, domain.ErrInviteNotFound
		},
	}
	authTeacher := &fakeValidator{
		principal: authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher},
	}
	authStudent := &fakeValidator{
		principal: authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent},
	}

	t.Run("register manual with invalid json or missing class", func(t *testing.T) {
		router := setupTestRouter(svc, authTeacher)

		// Invalid JSON
		req := httptest.NewRequest(http.MethodPost, "/api/v1/students", strings.NewReader("invalid-json"))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)

		// Missing academicId
		req = httptest.NewRequest(http.MethodPost, "/api/v1/students", strings.NewReader(`{"email":"a@b.com"}`))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)

		// Service returns ErrClassNotFound
		req = httptest.NewRequest(http.MethodPost, "/api/v1/students", strings.NewReader(`{"academicId":"1234567","email":"a@b.com"}`))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
		assert.Contains(t, rec.Body.String(), "class-group-not-found")
	})

	t.Run("import csv with invalid classGroupId", func(t *testing.T) {
		router := setupTestRouter(svc, authTeacher)
		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		part, _ := w.CreateFormFile("file", "test.csv")
		_, _ = part.Write([]byte("email,academic_id\na@b.com,1111111\n"))
		_ = w.WriteField("classGroupId", "invalid-uuid")
		_ = w.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/students/import-csv", &b)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("get profile service error", func(t *testing.T) {
		router := setupTestRouter(svc, authStudent)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/students/me", nil)
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("update avatar service error", func(t *testing.T) {
		router := setupTestRouter(svc, authStudent)
		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		part, _ := w.CreateFormFile("avatar", "bad.png")
		_, _ = part.Write([]byte("some-data"))
		_ = w.Close()

		req := httptest.NewRequest(http.MethodPatch, "/api/v1/students/me/avatar", &b)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "unsupported-image")
	})

	t.Run("list students service error", func(t *testing.T) {
		router := setupTestRouter(svc, authTeacher)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/students", nil)
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "test-token"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusInternalServerError, rec.Code)
	})

	t.Run("join by invite service error", func(t *testing.T) {
		router := setupTestRouter(svc, &fakeValidator{})
		body := `{"academicId":"1234567","email":"a@b.com","name":"A","password":"Password123!"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/bad-token/join", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})
}
