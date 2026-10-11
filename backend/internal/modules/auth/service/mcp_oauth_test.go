package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// fakeOAuth is an in-memory OAuthStore.
type fakeOAuth struct {
	clients map[uuid.UUID]domain.OAuthClient
	codes   map[uuid.UUID]domain.OAuthCode
}

func newFakeOAuth() *fakeOAuth {
	return &fakeOAuth{clients: map[uuid.UUID]domain.OAuthClient{}, codes: map[uuid.UUID]domain.OAuthCode{}}
}

func (f *fakeOAuth) CreateOAuthClient(_ context.Context, c *domain.OAuthClient) error {
	c.ID = uuid.New()
	f.clients[c.ID] = *c
	return nil
}

func (f *fakeOAuth) FindOAuthClient(_ context.Context, id uuid.UUID) (domain.OAuthClient, error) {
	c, ok := f.clients[id]
	if !ok {
		return domain.OAuthClient{}, errNotFound
	}
	return c, nil
}

func (f *fakeOAuth) CreateOAuthCode(_ context.Context, c *domain.OAuthCode) error {
	c.ID = uuid.New()
	f.codes[c.ID] = *c
	return nil
}

func (f *fakeOAuth) FindOAuthCodeByHash(_ context.Context, hash string) (domain.OAuthCode, error) {
	for _, c := range f.codes {
		if c.CodeHash == hash {
			return c, nil
		}
	}
	return domain.OAuthCode{}, errNotFound
}

func (f *fakeOAuth) MarkOAuthCodeUsed(_ context.Context, id, tokenID uuid.UUID, at time.Time) (bool, error) {
	c := f.codes[id]
	if c.UsedAt != nil {
		return false, nil
	}
	c.UsedAt, c.AccessTokenID = &at, &tokenID
	f.codes[id] = c
	return true, nil
}

const (
	testRedirect = "http://localhost:53682/callback"
	testVerifier = "a-verifier-with-enough-entropy-for-the-test-0123456789"
)

func testChallenge() string {
	sum := sha256.Sum256([]byte(testVerifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

type oauthHarness struct {
	*tokenHarness
	client domain.OAuthClient
}

func newOAuthHarness(t *testing.T) *oauthHarness {
	t.Helper()
	h := &oauthHarness{tokenHarness: newTokenHarness()}
	h.svc.OAuth = newFakeOAuth()
	var err error
	h.client, err = h.svc.RegisterOAuthClient(context.Background(), "Claude Code", []string{testRedirect})
	require.NoError(t, err)
	return h
}

// authorize returns the code the consent screen would hand to the client.
func (h *oauthHarness) authorize(t *testing.T) string {
	t.Helper()
	target, err := h.svc.OAuthAuthorize(context.Background(), h.principal(h.teacher), service2Input(h.client.ID, true))
	require.NoError(t, err)
	u, err := url.Parse(target)
	require.NoError(t, err)
	assert.Equal(t, "xyz", u.Query().Get("state"))
	return u.Query().Get("code")
}

func service2Input(clientID uuid.UUID, allow bool) OAuthAuthorizeInput {
	return OAuthAuthorizeInput{ClientID: clientID, RedirectURI: testRedirect, CodeChallenge: testChallenge(), State: "xyz", Allow: allow}
}

func (h *oauthHarness) exchange(code string) (string, error) {
	raw, _, err := h.svc.OAuthExchange(context.Background(), OAuthExchangeInput{
		ClientID: h.client.ID, Code: code, CodeVerifier: testVerifier, RedirectURI: testRedirect,
	})
	return raw, err
}

// Covers SPEC-024 CA-25: only loopback redirect URIs register.
func TestRegisterOAuthClientAcceptsOnlyLoopback(t *testing.T) {
	h := newOAuthHarness(t)
	ctx := context.Background()

	for _, uri := range []string{"https://evil.example/cb", "http://example.com/cb", "http://localhost.evil.com/cb", "javascript:alert(1)", "http://localhost/cb#frag", ""} {
		_, err := h.svc.RegisterOAuthClient(ctx, "x", []string{uri})
		assert.ErrorIs(t, err, domain.ErrOAuthInvalidRedirect, "uri %q", uri)
	}
	_, err := h.svc.RegisterOAuthClient(ctx, "x", nil)
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidRedirect)

	for _, uri := range []string{"http://localhost:1234/cb", "http://127.0.0.1:9/cb", "http://[::1]:9/cb"} {
		_, err := h.svc.RegisterOAuthClient(ctx, "x", []string{uri})
		assert.NoError(t, err, "uri %q", uri)
	}

	c, err := h.svc.RegisterOAuthClient(ctx, "  ", []string{testRedirect})
	require.NoError(t, err)
	assert.Equal(t, "MCP client", c.ClientName)
	c, err = h.svc.RegisterOAuthClient(ctx, strings.Repeat("n", 200), []string{testRedirect})
	require.NoError(t, err)
	assert.Len(t, c.ClientName, domain.MaxOAuthClientNameLength)
}

// Covers SPEC-024 CA-23: authorize, exchange and use the token.
func TestOAuthLoginIssuesAWorkingToken(t *testing.T) {
	h := newOAuthHarness(t)
	code := h.authorize(t)
	require.NotEmpty(t, code)

	raw, validity, err := h.svc.OAuthExchange(context.Background(), OAuthExchangeInput{
		ClientID: h.client.ID, Code: code, CodeVerifier: testVerifier, RedirectURI: testRedirect,
	})
	require.NoError(t, err)
	assert.Equal(t, 30*24*time.Hour, validity)

	p, err := h.svc.AuthenticateAccessToken(context.Background(), raw)
	require.NoError(t, err)
	assert.Equal(t, h.teacher.ID, p.UserID)

	listed, err := h.svc.ListAccessTokens(context.Background(), h.principal(h.teacher))
	require.NoError(t, err)
	require.Len(t, listed, 1)
	assert.Equal(t, "Claude Code (OAuth)", listed[0].Name)
	assert.Equal(t, h.now.AddDate(0, 0, 30), listed[0].ExpiresAt)
	for _, c := range h.svc.OAuth.(*fakeOAuth).codes {
		assert.NotEqual(t, code, c.CodeHash, "only the hash of the code is stored")
	}
}

// Covers SPEC-024 CA-24: a replayed code is refused and revokes the token it produced.
func TestOAuthCodeReplayRevokesTheToken(t *testing.T) {
	h := newOAuthHarness(t)
	code := h.authorize(t)

	raw, err := h.exchange(code)
	require.NoError(t, err)
	_, err = h.svc.AuthenticateAccessToken(context.Background(), raw)
	require.NoError(t, err)

	_, err = h.exchange(code)
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidGrant)
	_, err = h.svc.AuthenticateAccessToken(context.Background(), raw)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)
}

// Covers SPEC-024 CA-24: expiry, wrong verifier, wrong redirect, wrong client, unknown code.
func TestOAuthExchangeRefusals(t *testing.T) {
	h := newOAuthHarness(t)
	ctx := context.Background()
	exchange := func(mutate func(*OAuthExchangeInput)) error {
		code := h.authorize(t)
		in := OAuthExchangeInput{ClientID: h.client.ID, Code: code, CodeVerifier: testVerifier, RedirectURI: testRedirect}
		mutate(&in)
		_, _, err := h.svc.OAuthExchange(ctx, in)
		return err
	}

	assert.ErrorIs(t, exchange(func(in *OAuthExchangeInput) { in.CodeVerifier = "another-verifier" }), domain.ErrOAuthInvalidGrant)
	assert.ErrorIs(t, exchange(func(in *OAuthExchangeInput) { in.RedirectURI = "http://localhost:1/other" }), domain.ErrOAuthInvalidGrant)
	assert.ErrorIs(t, exchange(func(in *OAuthExchangeInput) { in.ClientID = uuid.New() }), domain.ErrOAuthInvalidGrant)
	assert.ErrorIs(t, exchange(func(in *OAuthExchangeInput) { in.Code = "unknown" }), domain.ErrOAuthInvalidGrant)

	code := h.authorize(t)
	h.now = h.now.Add(domain.OAuthCodeTTL)
	_, err := h.exchange(code)
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidGrant, "expired at exactly the TTL")
	assert.Empty(t, h.tokens.byID, "no token was issued by a refused exchange")
}

func TestOAuthExchangeRefusesUserThatLostAccess(t *testing.T) {
	h := newOAuthHarness(t)
	code := h.authorize(t)
	h.users.byID[h.teacher.ID] = withRole(h.users.byID[h.teacher.ID], userdomain.RoleStudent)

	_, err := h.exchange(code)
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidGrant)
}

func withRole(u userdomain.User, r userdomain.Role) userdomain.User {
	u.Role = r
	return u
}

// Covers SPEC-024 CA-25: STUDENT cannot authorize; denial and bad requests.
func TestOAuthAuthorizeRules(t *testing.T) {
	h := newOAuthHarness(t)
	ctx := context.Background()

	student := h.student("pw")
	_, err := h.svc.OAuthAuthorize(ctx, h.principal(student), service2Input(h.client.ID, true))
	assert.ErrorIs(t, err, domain.ErrAccessTokenForbidden)
	assert.Empty(t, h.svc.OAuth.(*fakeOAuth).codes)

	_, err = h.svc.OAuthAuthorize(ctx, h.principal(h.teacher), service2Input(uuid.New(), true))
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidClient)

	in := service2Input(h.client.ID, true)
	in.RedirectURI = "http://localhost:1/other"
	_, err = h.svc.OAuthAuthorize(ctx, h.principal(h.teacher), in)
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidRedirect)

	in = service2Input(h.client.ID, true)
	in.CodeChallenge = "short"
	_, err = h.svc.OAuthAuthorize(ctx, h.principal(h.teacher), in)
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidRequest)

	target, err := h.svc.OAuthAuthorize(ctx, h.principal(h.teacher), service2Input(h.client.ID, false))
	require.NoError(t, err)
	u, _ := url.Parse(target)
	assert.Equal(t, "access_denied", u.Query().Get("error"))
	assert.Equal(t, "xyz", u.Query().Get("state"))
	assert.Empty(t, u.Query().Get("code"))
	assert.Empty(t, h.svc.OAuth.(*fakeOAuth).codes, "denying issues no code")
}

func TestGetOAuthClient(t *testing.T) {
	h := newOAuthHarness(t)
	c, err := h.svc.GetOAuthClient(context.Background(), h.client.ID)
	require.NoError(t, err)
	assert.Equal(t, "Claude Code", c.ClientName)
	_, err = h.svc.GetOAuthClient(context.Background(), uuid.New())
	assert.ErrorIs(t, err, domain.ErrOAuthInvalidClient)
}

// Covers SPEC-024 RN-15: the local user is read on every call.
func TestDevPrincipal(t *testing.T) {
	h := newTokenHarness()
	ctx := context.Background()

	p, err := h.svc.DevPrincipal(ctx, "t@example.com")
	require.NoError(t, err)
	assert.Equal(t, h.teacher.ID, p.UserID)
	assert.Equal(t, authn.RoleTeacher, p.Role)

	_, err = h.svc.DevPrincipal(ctx, "nobody@example.com")
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)

	s := h.student("pw")
	_, err = h.svc.DevPrincipal(ctx, s.Email)
	assert.ErrorIs(t, err, authn.ErrForbidden)

	inactive := h.users.add(userdomain.User{Email: "i@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusSuspended})
	_, err = h.svc.DevPrincipal(ctx, inactive.Email)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)
}
