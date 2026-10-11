package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeOAuthService struct {
	client       domain.OAuthClient
	err          error
	redirect     string
	gotName      string
	gotURIs      []string
	gotAuthorize service.OAuthAuthorizeInput
	gotExchange  service.OAuthExchangeInput
	token        string
}

func (f *fakeOAuthService) RegisterOAuthClient(_ context.Context, name string, uris []string) (domain.OAuthClient, error) {
	f.gotName, f.gotURIs = name, uris
	return f.client, f.err
}

func (f *fakeOAuthService) GetOAuthClient(context.Context, uuid.UUID) (domain.OAuthClient, error) {
	return f.client, f.err
}

func (f *fakeOAuthService) OAuthAuthorize(_ context.Context, _ authn.Principal, in service.OAuthAuthorizeInput) (string, error) {
	f.gotAuthorize = in
	return f.redirect, f.err
}

func (f *fakeOAuthService) OAuthExchange(_ context.Context, in service.OAuthExchangeInput) (string, time.Duration, error) {
	f.gotExchange = in
	return f.token, 30 * 24 * time.Hour, f.err
}

func oauthEngine(svc *fakeOAuthService, p authn.Principal, limit int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := NewMCPOAuth(svc, cookieOnly{principal: p},
		MCPOAuthURLs{Backend: "http://localhost:8080", Frontend: "http://localhost:3010"},
		ratelimit.New(limit, time.Hour), ratelimit.New(limit, time.Hour))
	e := server.NewEngine(zap.NewNop(), nil, h)
	h.RegisterRoot(e)
	return e
}

func oauthCall(e *gin.Engine, method, path, contentType, body string, cookie bool) (int, map[string]any, http.Header) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if cookie {
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "raw-token"})
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Header()
}

func newClient() domain.OAuthClient {
	c := domain.OAuthClient{ClientName: "Claude Code", RedirectURIs: []string{"http://localhost:5/cb"}}
	c.ID = uuid.New()
	return c
}

// Covers SPEC-024 CA-22: the metadata describes registration, authorization and token endpoints.
func TestOAuthDiscoveryMetadata(t *testing.T) {
	e := oauthEngine(&fakeOAuthService{}, teacher(), 10)

	for _, path := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		code, body, _ := oauthCall(e, http.MethodGet, path, "", "", false)
		require.Equal(t, http.StatusOK, code)
		assert.Equal(t, "http://localhost:8080/mcp", body["resource"])
		assert.Equal(t, []any{"http://localhost:8080"}, body["authorization_servers"])
	}

	code, body, _ := oauthCall(e, http.MethodGet, "/.well-known/oauth-authorization-server", "", "", false)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "http://localhost:8080", body["issuer"])
	assert.Equal(t, "http://localhost:3010/oauth/authorize", body["authorization_endpoint"])
	assert.Equal(t, "http://localhost:8080/oauth/token", body["token_endpoint"])
	assert.Equal(t, "http://localhost:8080/oauth/register", body["registration_endpoint"])
	assert.Equal(t, []any{"S256"}, body["code_challenge_methods_supported"])
	assert.Equal(t, []any{"none"}, body["token_endpoint_auth_methods_supported"])
}

func TestOAuthRegister(t *testing.T) {
	c := newClient()
	svc := &fakeOAuthService{client: c}
	e := oauthEngine(svc, teacher(), 10)

	code, body, _ := oauthCall(e, http.MethodPost, "/oauth/register", "application/json",
		`{"client_name":"Claude Code","redirect_uris":["http://localhost:5/cb"]}`, false)
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, c.ID.String(), body["client_id"])
	assert.Equal(t, "none", body["token_endpoint_auth_method"])
	assert.Equal(t, "Claude Code", svc.gotName)
	assert.Equal(t, []string{"http://localhost:5/cb"}, svc.gotURIs)

	code, _, _ = oauthCall(e, http.MethodPost, "/oauth/register", "application/json", `not json`, false)
	assert.Equal(t, http.StatusBadRequest, code)

	svc.err = domain.ErrOAuthInvalidRedirect
	code, body, _ = oauthCall(e, http.MethodPost, "/oauth/register", "application/json", `{"redirect_uris":["https://evil"]}`, false)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid_redirect_uri", body["error"])

	svc.err = errors.New("db down")
	code, _, _ = oauthCall(e, http.MethodPost, "/oauth/register", "application/json", `{"redirect_uris":["http://localhost/cb"]}`, false)
	assert.Equal(t, http.StatusInternalServerError, code)
}

// Covers SPEC-024 CA-23 and CA-24 at the wire.
func TestOAuthToken(t *testing.T) {
	id := uuid.New()
	svc := &fakeOAuthService{token: "the-token"}
	e := oauthEngine(svc, teacher(), 10)
	form := url.Values{"grant_type": {"authorization_code"}, "client_id": {id.String()}, "code": {"c"}, "code_verifier": {"v"}, "redirect_uri": {"http://localhost:5/cb"}}

	code, body, header := oauthCall(e, http.MethodPost, "/oauth/token", "application/x-www-form-urlencoded", form.Encode(), false)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "the-token", body["access_token"])
	assert.Equal(t, "Bearer", body["token_type"])
	assert.EqualValues(t, 30*24*3600, body["expires_in"])
	assert.Equal(t, "no-store", header.Get("Cache-Control"))
	assert.Equal(t, service.OAuthExchangeInput{ClientID: id, Code: "c", CodeVerifier: "v", RedirectURI: "http://localhost:5/cb"}, svc.gotExchange)

	bad := url.Values{"grant_type": {"password"}}
	code, body, _ = oauthCall(e, http.MethodPost, "/oauth/token", "application/x-www-form-urlencoded", bad.Encode(), false)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "unsupported_grant_type", body["error"])

	form.Del("code_verifier")
	code, body, _ = oauthCall(e, http.MethodPost, "/oauth/token", "application/x-www-form-urlencoded", form.Encode(), false)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid_request", body["error"])

	form.Set("code_verifier", "v")
	svc.err = domain.ErrOAuthInvalidGrant
	code, body, _ = oauthCall(e, http.MethodPost, "/oauth/token", "application/x-www-form-urlencoded", form.Encode(), false)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid_grant", body["error"])
	assert.Nil(t, body["access_token"])
}

func TestOAuthPublicEndpointsAreRateLimited(t *testing.T) {
	e := oauthEngine(&fakeOAuthService{client: newClient()}, teacher(), 1)
	body := `{"redirect_uris":["http://localhost/cb"]}`
	code, _, _ := oauthCall(e, http.MethodPost, "/oauth/register", "application/json", body, false)
	assert.Equal(t, http.StatusCreated, code)
	code, out, _ := oauthCall(e, http.MethodPost, "/oauth/register", "application/json", body, false)
	assert.Equal(t, http.StatusTooManyRequests, code)
	assert.Equal(t, "invalid_request", out["error"])
	code, _, _ = oauthCall(e, http.MethodPost, "/oauth/token", "application/x-www-form-urlencoded", "grant_type=authorization_code", false)
	assert.Equal(t, http.StatusTooManyRequests, code, "token shares the per-client budget")
}

func TestOAuthConsentAPI(t *testing.T) {
	c := newClient()
	svc := &fakeOAuthService{client: c, redirect: "http://localhost:5/cb?code=abc&state=s"}
	p := teacher()
	e := oauthEngine(svc, p, 10)

	code, body, _ := oauthCall(e, http.MethodGet, "/api/v1/oauth/clients/"+c.ID.String(), "", "", true)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "Claude Code", body["name"])

	code, _, _ = oauthCall(e, http.MethodGet, "/api/v1/oauth/clients/not-a-uuid", "", "", true)
	assert.Equal(t, http.StatusNotFound, code)

	code, _, _ = oauthCall(e, http.MethodGet, "/api/v1/oauth/clients/"+c.ID.String(), "", "", false)
	assert.Equal(t, http.StatusUnauthorized, code, "session cookie required")

	payload := `{"clientId":"` + c.ID.String() + `","redirectUri":"http://localhost:5/cb","codeChallenge":"ch","state":"s","allow":true}`
	code, body, _ = oauthCall(e, http.MethodPost, "/api/v1/oauth/authorize", "application/json", payload, true)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, svc.redirect, body["redirectUrl"])
	assert.Equal(t, service.OAuthAuthorizeInput{ClientID: c.ID, RedirectURI: "http://localhost:5/cb", CodeChallenge: "ch", State: "s", Allow: true}, svc.gotAuthorize)

	code, _, _ = oauthCall(e, http.MethodPost, "/api/v1/oauth/authorize", "application/json", "{", true)
	assert.Equal(t, http.StatusBadRequest, code)

	for err, want := range map[error]int{
		domain.ErrOAuthInvalidClient:   http.StatusNotFound,
		domain.ErrOAuthInvalidRedirect: http.StatusBadRequest,
		domain.ErrOAuthInvalidRequest:  http.StatusBadRequest,
		domain.ErrAccessTokenForbidden: http.StatusForbidden,
	} {
		svc.err = err
		code, _, _ = oauthCall(e, http.MethodPost, "/api/v1/oauth/authorize", "application/json", payload, true)
		assert.Equal(t, want, code, "error %v", err)
	}
}

// Covers SPEC-024 CA-25: STUDENT never reaches the consent API.
func TestOAuthConsentAPIRefusesStudents(t *testing.T) {
	svc := &fakeOAuthService{client: newClient()}
	e := oauthEngine(svc, authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}, 10)
	code, _, _ := oauthCall(e, http.MethodPost, "/api/v1/oauth/authorize", "application/json", `{}`, true)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, service.OAuthAuthorizeInput{}, svc.gotAuthorize)
}

func TestOAuthAuthorizeIsRateLimitedPerUser(t *testing.T) {
	svc := &fakeOAuthService{client: newClient(), redirect: "http://localhost:5/cb"}
	e := oauthEngine(svc, teacher(), 1)
	payload := `{"clientId":"` + uuid.NewString() + `","redirectUri":"x","codeChallenge":"c","allow":false}`
	code, _, _ := oauthCall(e, http.MethodPost, "/api/v1/oauth/authorize", "application/json", payload, true)
	assert.Equal(t, http.StatusOK, code)
	code, _, _ = oauthCall(e, http.MethodPost, "/api/v1/oauth/authorize", "application/json", payload, true)
	assert.Equal(t, http.StatusTooManyRequests, code)
}
