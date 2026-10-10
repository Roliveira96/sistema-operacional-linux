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
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeTokenService struct {
	created   domain.AccessToken
	raw       string
	list      []domain.AccessToken
	err       error
	createdBy authn.Principal
	gotName   string
	gotDays   int
	revoked   uuid.UUID
}

func (f *fakeTokenService) CreateAccessToken(_ context.Context, p authn.Principal, name string, days int) (domain.AccessToken, string, error) {
	f.createdBy, f.gotName, f.gotDays = p, name, days
	return f.created, f.raw, f.err
}

func (f *fakeTokenService) ListAccessTokens(context.Context, authn.Principal) ([]domain.AccessToken, error) {
	return f.list, f.err
}

func (f *fakeTokenService) RevokeAccessToken(_ context.Context, _ authn.Principal, id uuid.UUID) error {
	f.revoked = id
	return f.err
}

// cookieOnly is the session validator: it accepts only the token "raw-token"
// and never an Authorization header, which is the point of the endpoints.
type cookieOnly struct{ principal authn.Principal }

func (c cookieOnly) Authenticate(_ context.Context, token string) (authn.Principal, error) {
	if token != "raw-token" {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	return c.principal, nil
}

func tokenEngine(svc *fakeTokenService, p authn.Principal, limit int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	return server.NewEngine(zap.NewNop(), nil,
		NewAccessTokens(svc, cookieOnly{principal: p}, ratelimit.New(limit, time.Hour)))
}

func teacher() authn.Principal {
	return authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher}
}

func tokenCall(e *gin.Engine, method, path, body string, cookie bool, header string) response {
	req := httptest.NewRequest(method, "/api/v1/access-tokens"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie {
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "raw-token"})
	}
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	r := response{code: rec.Code, header: rec.Header()}
	_ = json.Unmarshal(rec.Body.Bytes(), &r.body)
	return r
}

// Covers SPEC-024 section 5: 201 returns the value once.
func TestCreateAccessTokenReturnsTheValueOnce(t *testing.T) {
	p := teacher()
	id := uuid.New()
	exp := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	svc := &fakeTokenService{created: domain.AccessToken{UserID: p.UserID, Name: "claude", ExpiresAt: exp}, raw: "the-raw-token"}
	svc.created.ID = id
	e := tokenEngine(svc, p, 10)

	r := tokenCall(e, http.MethodPost, "", `{"name":"claude","validityDays":30}`, true, "")
	require.Equal(t, http.StatusCreated, r.code)
	assert.Equal(t, id.String(), r.body["id"])
	assert.Equal(t, "claude", r.body["name"])
	assert.Equal(t, "the-raw-token", r.body["token"])
	assert.Equal(t, "2026-11-09T12:00:00Z", r.body["expiresAt"])
	assert.Equal(t, "claude", svc.gotName)
	assert.Equal(t, 30, svc.gotDays)
	assert.Equal(t, p.UserID, svc.createdBy.UserID)

	svc.list = []domain.AccessToken{svc.created}
	r = tokenCall(e, http.MethodGet, "", "", true, "")
	require.Equal(t, http.StatusOK, r.code)
	items := r.body["items"].([]any)
	require.Len(t, items, 1)
	item := items[0].(map[string]any)
	assert.NotContains(t, item, "token")
	assert.NotContains(t, item, "tokenHash")
	assert.Equal(t, "claude", item["name"])
}

func TestListAccessTokensShowsStatus(t *testing.T) {
	now := time.Now()
	revoked := now.Add(-time.Hour)
	svc := &fakeTokenService{list: []domain.AccessToken{
		{Name: "a", ExpiresAt: now.Add(time.Hour)},
		{Name: "b", ExpiresAt: now.Add(-time.Hour)},
		{Name: "c", ExpiresAt: now.Add(time.Hour), RevokedAt: &revoked},
	}}
	r := tokenCall(tokenEngine(svc, teacher(), 10), http.MethodGet, "", "", true, "")
	var statuses []any
	for _, it := range r.body["items"].([]any) {
		statuses = append(statuses, it.(map[string]any)["status"])
	}
	assert.Equal(t, []any{"ACTIVE", "EXPIRED", "REVOKED"}, statuses)

	empty := tokenCall(tokenEngine(&fakeTokenService{}, teacher(), 10), http.MethodGet, "", "", true, "")
	assert.Equal(t, []any{}, empty.body["items"])

	failing := tokenCall(tokenEngine(&fakeTokenService{err: errors.New("db down")}, teacher(), 10), http.MethodGet, "", "", true, "")
	assert.Equal(t, http.StatusInternalServerError, failing.code)
}

// Covers SPEC-024 section 5: 400 validation-error.
func TestCreateAccessTokenValidationErrors(t *testing.T) {
	cases := map[string]struct {
		body  string
		err   error
		param string
	}{
		"bad name":     {`{"name":"","validityDays":30}`, domain.ErrAccessTokenName, "name"},
		"bad validity": {`{"name":"x","validityDays":7}`, domain.ErrAccessTokenValidity, "validityDays"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			r := tokenCall(tokenEngine(&fakeTokenService{err: tc.err}, teacher(), 10), http.MethodPost, "", tc.body, true, "")
			assert.Equal(t, http.StatusBadRequest, r.code)
			assert.Equal(t, "validation-error", r.body["type"])
			params := r.body["invalidParams"].([]any)
			assert.Equal(t, tc.param, params[0].(map[string]any)["name"])
		})
	}

	r := tokenCall(tokenEngine(&fakeTokenService{}, teacher(), 10), http.MethodPost, "", `{not json`, true, "")
	assert.Equal(t, http.StatusBadRequest, r.code)
	assert.Equal(t, "validation-error", r.body["type"])
}

// Covers SPEC-024 section 5: 429 on creation.
func TestCreateAccessTokenIsRateLimitedPerUser(t *testing.T) {
	p := teacher()
	e := tokenEngine(&fakeTokenService{}, p, 2)
	body := `{"name":"x","validityDays":30}`
	assert.Equal(t, http.StatusCreated, tokenCall(e, http.MethodPost, "", body, true, "").code)
	assert.Equal(t, http.StatusCreated, tokenCall(e, http.MethodPost, "", body, true, "").code)
	r := tokenCall(e, http.MethodPost, "", body, true, "")
	assert.Equal(t, http.StatusTooManyRequests, r.code)
	assert.Equal(t, "rate-limited", r.body["type"])
	assert.NotEmpty(t, r.header.Get("Retry-After"))
}

// Covers SPEC-024 section 5: 204 and 404.
func TestRevokeAccessToken(t *testing.T) {
	svc := &fakeTokenService{}
	e := tokenEngine(svc, teacher(), 10)
	id := uuid.New()

	r := tokenCall(e, http.MethodDelete, "/"+id.String(), "", true, "")
	assert.Equal(t, http.StatusNoContent, r.code)
	assert.Equal(t, id, svc.revoked)

	svc.err = domain.ErrAccessTokenNotFound
	r = tokenCall(e, http.MethodDelete, "/"+id.String(), "", true, "")
	assert.Equal(t, http.StatusNotFound, r.code)
	assert.Equal(t, "access-token-not-found", r.body["type"])

	r = tokenCall(e, http.MethodDelete, "/not-a-uuid", "", true, "")
	assert.Equal(t, http.StatusNotFound, r.code)
	assert.Equal(t, "access-token-not-found", r.body["type"])
}

// Covers SPEC-024 section 5: 401 and 403, and RN-08 (cookie only).
func TestAccessTokenRoutesAreSessionCookieOnly(t *testing.T) {
	svc := &fakeTokenService{}
	e := tokenEngine(svc, teacher(), 10)
	id := uuid.New().String()

	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, ""}, {http.MethodPost, ""}, {http.MethodDelete, "/" + id},
	} {
		r := tokenCall(e, rt.method, rt.path, `{"name":"x","validityDays":30}`, false, "")
		assert.Equal(t, http.StatusUnauthorized, r.code, "no session: %s", rt.method)
		assert.Equal(t, "not-authenticated", r.body["type"])

		r = tokenCall(e, rt.method, rt.path, `{"name":"x","validityDays":30}`, false, "Bearer raw-token")
		assert.Equal(t, http.StatusUnauthorized, r.code, "Bearer is refused: %s", rt.method)
		assert.Equal(t, "not-authenticated", r.body["type"])
	}

	student := tokenEngine(svc, authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}, 10)
	r := tokenCall(student, http.MethodGet, "", "", true, "")
	assert.Equal(t, http.StatusForbidden, r.code)
	assert.Equal(t, "forbidden", r.body["type"])

	mustChange := tokenEngine(svc, authn.Principal{UserID: uuid.New(), Role: authn.RoleAdmin, MustChangePassword: true}, 10)
	r = tokenCall(mustChange, http.MethodGet, "", "", true, "")
	assert.Equal(t, http.StatusForbidden, r.code)
	assert.Equal(t, "password-change-required", r.body["type"])
}

func TestAccessTokenProblemMapping(t *testing.T) {
	r := tokenCall(tokenEngine(&fakeTokenService{err: domain.ErrAccessTokenForbidden}, teacher(), 10),
		http.MethodPost, "", `{"name":"x","validityDays":30}`, true, "")
	assert.Equal(t, http.StatusForbidden, r.code)
	assert.Equal(t, "forbidden", r.body["type"])

	r = tokenCall(tokenEngine(&fakeTokenService{err: errors.New("db down")}, teacher(), 10),
		http.MethodDelete, "/"+uuid.New().String(), "", true, "")
	assert.Equal(t, http.StatusInternalServerError, r.code)
}

