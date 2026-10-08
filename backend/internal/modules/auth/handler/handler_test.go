package handler

import (
	"context"
	"encoding/json"
	"errors"
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

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// fakeService is a hand-written Service with configurable results.
type fakeService struct {
	principal    authn.Principal
	authErr      error
	loginErr     error
	loginCalls   int
	rateLimited  int
	logoutErr    error
	meErr        error
	forgotCalls  int
	forgotErr    error
	resetErr     error
	resetRevoked int64
	changeErr    error
}

func (f *fakeService) Authenticate(context.Context, string) (authn.Principal, error) {
	return f.principal, f.authErr
}

func (f *fakeService) Login(_ context.Context, id userdomain.Identifier, _ string, _ string, _ domain.RequestInfo) (service.LoginResult, error) {
	f.loginCalls++
	if f.loginErr != nil {
		return service.LoginResult{}, f.loginErr
	}
	name := "Admin"
	return service.LoginResult{
		Token:   "raw-token",
		Session: domain.Session{ExpiresAt: time.Now().Add(5 * time.Hour)},
		User:    userdomain.User{Email: id.Email, Name: &name, Role: userdomain.RoleAdmin, MustChangePassword: true},
	}, nil
}

func (f *fakeService) RecordRateLimited(context.Context, string, domain.RequestInfo) { f.rateLimited++ }

func (f *fakeService) Logout(context.Context, authn.Principal, domain.RequestInfo) error {
	return f.logoutErr
}

func (f *fakeService) Me(_ context.Context, p authn.Principal) (userdomain.User, error) {
	if f.meErr != nil {
		return userdomain.User{}, f.meErr
	}
	return userdomain.User{Model: modelWithID(p.UserID), Email: "admin@rmo.dev.br", Role: userdomain.RoleAdmin, Status: userdomain.StatusActive}, nil
}

func (f *fakeService) ForgotPassword(context.Context, userdomain.Identifier, string, domain.RequestInfo) error {
	f.forgotCalls++
	return f.forgotErr
}

func (f *fakeService) ResetPassword(context.Context, string, string, domain.RequestInfo) (int64, error) {
	return f.resetRevoked, f.resetErr
}

func (f *fakeService) ChangePassword(context.Context, authn.Principal, string, string, domain.RequestInfo) error {
	return f.changeErr
}

func limiters() Limiters {
	return Limiters{
		LoginIP:       ratelimit.New(20, time.Minute),
		LoginFailures: ratelimit.New(5, 15*time.Minute),
		ForgotIP:      ratelimit.New(20, time.Minute),
		ForgotID:      ratelimit.New(3, time.Hour),
	}
}

func newEngine(svc *fakeService, secure bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	return server.NewEngine(zap.NewNop(), nil, New(svc, limiters(), secure))
}

type response struct {
	code   int
	body   map[string]any
	cookie *http.Cookie
	header http.Header
}

func send(e *gin.Engine, method, path, body string, withCookie bool) response {
	req := httptest.NewRequest(method, "/api/v1/auth"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "192.168.3.50:5000"
	if withCookie {
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "raw-token"})
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	r := response{code: rec.Code, header: rec.Header()}
	_ = json.Unmarshal(rec.Body.Bytes(), &r.body)
	for _, c := range rec.Result().Cookies() {
		if c.Name == authn.CookieName {
			r.cookie = c
		}
	}
	return r
}

const validLogin = `{"identifier":"admin@rmo.dev.br","password":"correct horse battery"}`

// Covers SPEC-003 CA-03.
func TestLoginSetsSessionCookie(t *testing.T) {
	r := send(newEngine(&fakeService{}, true), http.MethodPost, "/login", validLogin, false)
	require.Equal(t, http.StatusOK, r.code)
	assert.Equal(t, "ADMIN", r.body["role"])
	assert.Equal(t, true, r.body["mustChangePassword"])
	require.NotNil(t, r.cookie)
	assert.Equal(t, "raw-token", r.cookie.Value)
	assert.True(t, r.cookie.HttpOnly)
	assert.True(t, r.cookie.Secure)
	assert.Equal(t, http.SameSiteStrictMode, r.cookie.SameSite)
	assert.Equal(t, "/", r.cookie.Path)

	dev := send(newEngine(&fakeService{}, false), http.MethodPost, "/login", validLogin, false)
	assert.False(t, dev.cookie.Secure, "Secure is off only in development")
}

// Covers SPEC-003 CA-04.
func TestLoginValidation(t *testing.T) {
	svc := &fakeService{}
	e := newEngine(svc, false)

	r := send(e, http.MethodPost, "/login", `{}`, false)
	assert.Equal(t, http.StatusBadRequest, r.code)
	assert.Equal(t, "validation-error", r.body["type"])
	assert.Len(t, r.body["invalidParams"], 2)

	r = send(e, http.MethodPost, "/login", `{"identifier":"a123","password":"x"}`, false)
	assert.Equal(t, http.StatusBadRequest, r.code)
	assert.Equal(t, "validation-error", r.body["type"])

	r = send(e, http.MethodPost, "/login", `not json`, false)
	assert.Equal(t, http.StatusBadRequest, r.code)
	assert.Zero(t, svc.loginCalls)
}

// Covers SPEC-003 CA-05.
func TestLoginInvalidCredentials(t *testing.T) {
	r := send(newEngine(&fakeService{loginErr: domain.ErrInvalidCredentials}, false), http.MethodPost, "/login", validLogin, false)
	assert.Equal(t, http.StatusUnauthorized, r.code)
	assert.Equal(t, "invalid-credentials", r.body["type"])
	assert.Nil(t, r.cookie)
}

// Covers SPEC-003 CA-09: five failures per identifier, then 429 without
// calling the service.
func TestLoginFailureRateLimit(t *testing.T) {
	svc := &fakeService{loginErr: domain.ErrInvalidCredentials}
	e := newEngine(svc, false)
	for range 5 {
		assert.Equal(t, http.StatusUnauthorized, send(e, http.MethodPost, "/login", validLogin, false).code)
	}
	r := send(e, http.MethodPost, "/login", validLogin, false)
	assert.Equal(t, http.StatusTooManyRequests, r.code)
	assert.Equal(t, "rate-limited", r.body["type"])
	assert.NotEmpty(t, r.header.Get("Retry-After"))
	assert.Positive(t, r.body["retryAfterSeconds"])
	assert.Equal(t, 5, svc.loginCalls, "the service is not called once blocked")
	assert.Equal(t, 1, svc.rateLimited)

	other := send(e, http.MethodPost, "/login", `{"identifier":"a1234567","password":"x"}`, false)
	assert.Equal(t, http.StatusUnauthorized, other.code, "other identifiers are not blocked")
}

func TestLoginSuccessResetsFailures(t *testing.T) {
	svc := &fakeService{loginErr: domain.ErrInvalidCredentials}
	e := newEngine(svc, false)
	for range 4 {
		send(e, http.MethodPost, "/login", validLogin, false)
	}
	svc.loginErr = nil
	require.Equal(t, http.StatusOK, send(e, http.MethodPost, "/login", validLogin, false).code)
	svc.loginErr = domain.ErrInvalidCredentials
	for range 5 {
		assert.Equal(t, http.StatusUnauthorized, send(e, http.MethodPost, "/login", validLogin, false).code)
	}
}

func TestLoginIPRateLimit(t *testing.T) {
	svc := &fakeService{}
	e := newEngine(svc, false)
	for range 20 {
		require.Equal(t, http.StatusOK, send(e, http.MethodPost, "/login", validLogin, false).code)
	}
	r := send(e, http.MethodPost, "/login", validLogin, false)
	assert.Equal(t, http.StatusTooManyRequests, r.code)
	assert.Equal(t, 20, svc.loginCalls)
}

func TestLoginUnexpectedErrorIs500(t *testing.T) {
	r := send(newEngine(&fakeService{loginErr: errors.New("db down")}, false), http.MethodPost, "/login", validLogin, false)
	assert.Equal(t, http.StatusInternalServerError, r.code)
	assert.Equal(t, "internal-error", r.body["type"])
}

func TestLogoutClearsCookie(t *testing.T) {
	e := newEngine(&fakeService{}, false)
	r := send(e, http.MethodPost, "/logout", "", true)
	assert.Equal(t, http.StatusNoContent, r.code)
	require.NotNil(t, r.cookie)
	assert.Equal(t, -1, r.cookie.MaxAge)

	r = send(e, http.MethodPost, "/logout", "", false)
	assert.Equal(t, http.StatusUnauthorized, r.code)
	assert.Equal(t, "not-authenticated", r.body["type"])

	r = send(newEngine(&fakeService{logoutErr: errors.New("db down")}, false), http.MethodPost, "/logout", "", true)
	assert.Equal(t, http.StatusInternalServerError, r.code)
}

func TestMe(t *testing.T) {
	userID := uuid.New()
	created := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	svc := &fakeService{principal: authn.Principal{
		UserID: userID, Role: "ADMIN", MustChangePassword: true,
		SessionCreatedAt: created, SessionExpiresAt: created.Add(5 * time.Hour),
	}}
	r := send(newEngine(svc, false), http.MethodGet, "/me", "", true)
	require.Equal(t, http.StatusOK, r.code)
	assert.Equal(t, userID.String(), r.body["userId"])
	assert.Equal(t, "admin@rmo.dev.br", r.body["email"])
	assert.Equal(t, "2026-10-08T17:00:00Z", r.body["sessionExpiresAt"])

	expired := send(newEngine(&fakeService{authErr: &authn.SessionExpiredError{Reason: authn.ReasonAbsolute}}, false),
		http.MethodGet, "/me", "", true)
	assert.Equal(t, http.StatusUnauthorized, expired.code)
	assert.Equal(t, "session-expired", expired.body["type"])
	assert.Equal(t, "ABSOLUTE", expired.body["reason"])

	r = send(newEngine(&fakeService{meErr: errors.New("db down")}, false), http.MethodGet, "/me", "", true)
	assert.Equal(t, http.StatusInternalServerError, r.code)
}

// Covers SPEC-003 CA-10.
func TestForgotPassword(t *testing.T) {
	svc := &fakeService{}
	e := newEngine(svc, false)
	body := `{"identifier":"admin@rmo.dev.br"}`

	for range 3 {
		r := send(e, http.MethodPost, "/forgot-password", body, false)
		assert.Equal(t, http.StatusAccepted, r.code)
		assert.NotEmpty(t, r.body["message"])
	}
	r := send(e, http.MethodPost, "/forgot-password", body, false)
	assert.Equal(t, http.StatusTooManyRequests, r.code, "3 requests per identifier per hour")
	assert.Equal(t, 3, svc.forgotCalls)

	assert.Equal(t, http.StatusBadRequest, send(e, http.MethodPost, "/forgot-password", `{}`, false).code)
	assert.Equal(t, http.StatusBadRequest, send(e, http.MethodPost, "/forgot-password", `{"identifier":"x"}`, false).code)
	assert.Equal(t, http.StatusBadRequest, send(e, http.MethodPost, "/forgot-password", `[`, false).code)

	failing := newEngine(&fakeService{forgotErr: errors.New("db down")}, false)
	assert.Equal(t, http.StatusInternalServerError,
		send(failing, http.MethodPost, "/forgot-password", body, false).code)
}

func TestForgotPasswordIPRateLimit(t *testing.T) {
	e := newEngine(&fakeService{}, false)
	for i := range 20 {
		body := `{"identifier":"a` + strings.Repeat("1", 6) + string(rune('0'+i%10)) + `"}`
		send(e, http.MethodPost, "/forgot-password", body, false)
	}
	r := send(e, http.MethodPost, "/forgot-password", `{"identifier":"a7654321"}`, false)
	assert.Equal(t, http.StatusTooManyRequests, r.code)
}

// Covers SPEC-003 CA-11 and CA-12.
func TestResetPassword(t *testing.T) {
	ok := send(newEngine(&fakeService{resetRevoked: 2}, false), http.MethodPost, "/reset-password",
		`{"token":"t","newPassword":"a brand new passphrase"}`, false)
	assert.Equal(t, http.StatusOK, ok.code)
	assert.EqualValues(t, 2, ok.body["sessionsRevoked"])

	gone := send(newEngine(&fakeService{resetErr: domain.ErrResetTokenInvalid}, false), http.MethodPost,
		"/reset-password", `{"token":"t","newPassword":"a brand new passphrase"}`, false)
	assert.Equal(t, http.StatusGone, gone.code)
	assert.Equal(t, "reset-token-invalid", gone.body["type"])

	weak := send(newEngine(&fakeService{resetErr: &domain.PolicyError{Violations: []string{domain.ViolationTooShort}}}, false),
		http.MethodPost, "/reset-password", `{"token":"t","newPassword":"short"}`, false)
	assert.Equal(t, http.StatusBadRequest, weak.code)
	assert.Equal(t, "weak-password", weak.body["type"])
	assert.Equal(t, []any{"TOO_SHORT"}, weak.body["violations"])

	missing := send(newEngine(&fakeService{}, false), http.MethodPost, "/reset-password", `{}`, false)
	assert.Equal(t, http.StatusBadRequest, missing.code)
	assert.Len(t, missing.body["invalidParams"], 2)
	assert.Equal(t, http.StatusBadRequest, send(newEngine(&fakeService{}, false), http.MethodPost, "/reset-password", `x`, false).code)
}

func TestChangePassword(t *testing.T) {
	body := `{"currentPassword":"old password!","newPassword":"a brand new passphrase"}`
	assert.Equal(t, http.StatusNoContent,
		send(newEngine(&fakeService{}, false), http.MethodPost, "/change-password", body, true).code)

	wrong := send(newEngine(&fakeService{changeErr: domain.ErrInvalidCredentials}, false), http.MethodPost, "/change-password", body, true)
	assert.Equal(t, http.StatusUnauthorized, wrong.code)
	assert.Equal(t, "invalid-credentials", wrong.body["type"])

	weak := send(newEngine(&fakeService{changeErr: &domain.PolicyError{Violations: []string{domain.ViolationSameAsCurrent}}}, false),
		http.MethodPost, "/change-password", body, true)
	assert.Equal(t, http.StatusBadRequest, weak.code)

	missing := send(newEngine(&fakeService{}, false), http.MethodPost, "/change-password", `{}`, true)
	assert.Equal(t, http.StatusBadRequest, missing.code)
	assert.Len(t, missing.body["invalidParams"], 2)
	assert.Equal(t, http.StatusBadRequest, send(newEngine(&fakeService{}, false), http.MethodPost, "/change-password", `x`, true).code)
	assert.Equal(t, http.StatusUnauthorized,
		send(newEngine(&fakeService{}, false), http.MethodPost, "/change-password", body, false).code)
}

func modelWithID(id uuid.UUID) database.Model { return database.Model{ID: id} }
