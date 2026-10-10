package service

import (
	"context"
	"errors"
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

// fakeTokens is an in-memory AccessTokenStore.
type fakeTokens struct {
	byID    map[uuid.UUID]domain.AccessToken
	touches int
	err     error
}

func newFakeTokens() *fakeTokens { return &fakeTokens{byID: map[uuid.UUID]domain.AccessToken{}} }

func (f *fakeTokens) CreateAccessToken(_ context.Context, t *domain.AccessToken) error {
	if f.err != nil {
		return f.err
	}
	t.ID = uuid.New()
	f.byID[t.ID] = *t
	return nil
}

func (f *fakeTokens) ListAccessTokensByUser(_ context.Context, userID uuid.UUID) ([]domain.AccessToken, error) {
	if f.err != nil {
		return nil, f.err
	}
	var out []domain.AccessToken
	for _, t := range f.byID {
		if t.UserID == userID {
			out = append(out, t)
		}
	}
	return out, nil
}

func (f *fakeTokens) FindAccessTokenByID(_ context.Context, id uuid.UUID) (domain.AccessToken, error) {
	if f.err != nil {
		return domain.AccessToken{}, f.err
	}
	t, ok := f.byID[id]
	if !ok {
		return domain.AccessToken{}, errNotFound
	}
	return t, nil
}

func (f *fakeTokens) FindAccessTokenByHash(_ context.Context, hash string) (domain.AccessToken, error) {
	if f.err != nil {
		return domain.AccessToken{}, f.err
	}
	for _, t := range f.byID {
		if t.TokenHash == hash {
			return t, nil
		}
	}
	return domain.AccessToken{}, errNotFound
}

func (f *fakeTokens) RevokeAccessToken(_ context.Context, id uuid.UUID, at time.Time) error {
	t := f.byID[id]
	t.RevokedAt = &at
	f.byID[id] = t
	return nil
}

func (f *fakeTokens) TouchAccessToken(_ context.Context, id uuid.UUID, at time.Time) error {
	if f.err != nil {
		return f.err
	}
	f.touches++
	t := f.byID[id]
	t.LastUsedAt = &at
	f.byID[id] = t
	return nil
}

type tokenHarness struct {
	*harness
	tokens  *fakeTokens
	teacher userdomain.User
}

func newTokenHarness() *tokenHarness {
	h := newHarness()
	tk := newFakeTokens()
	h.svc.AccessTokens = tk
	teacher := h.users.add(userdomain.User{Email: "t@example.com", Role: userdomain.RoleTeacher})
	return &tokenHarness{harness: h, tokens: tk, teacher: teacher}
}

func (h *tokenHarness) principal(u userdomain.User) authn.Principal {
	return authn.Principal{UserID: u.ID, Role: string(u.Role)}
}

func (h *tokenHarness) create(t *testing.T) (domain.AccessToken, string) {
	t.Helper()
	tok, raw, err := h.svc.CreateAccessToken(context.Background(), h.principal(h.teacher), "claude", 30)
	require.NoError(t, err)
	return tok, raw
}

// Covers SPEC-024 RN-02: only the hash is stored and the value is shown once.
func TestCreateAccessTokenStoresOnlyTheHash(t *testing.T) {
	h := newTokenHarness()
	tok, raw := h.create(t)

	assert.Len(t, raw, 43, "256 bits in unpadded base64url")
	assert.Equal(t, hashToken(raw), tok.TokenHash)
	assert.NotContains(t, tok.TokenHash, raw)
	assert.Equal(t, h.now.AddDate(0, 0, 30), tok.ExpiresAt)
	assert.Equal(t, h.teacher.ID, tok.UserID)
	for _, stored := range h.tokens.byID {
		assert.NotEqual(t, raw, stored.TokenHash)
		assert.NotEqual(t, raw, stored.Name)
	}

	_, raw2 := h.create(t)
	assert.NotEqual(t, raw, raw2)

	listed, err := h.svc.ListAccessTokens(context.Background(), h.principal(h.teacher))
	require.NoError(t, err)
	assert.Len(t, listed, 2)
}

func TestCreateAccessTokenValidation(t *testing.T) {
	h := newTokenHarness()
	p := h.principal(h.teacher)
	ctx := context.Background()

	for _, name := range []string{"", "   ", strings.Repeat("a", 81)} {
		_, _, err := h.svc.CreateAccessToken(ctx, p, name, 30)
		assert.ErrorIs(t, err, domain.ErrAccessTokenName, "name %q", name)
	}
	for _, days := range []int{0, 1, 29, 31, 366, -90} {
		_, _, err := h.svc.CreateAccessToken(ctx, p, "ok", days)
		assert.ErrorIs(t, err, domain.ErrAccessTokenValidity, "days %d", days)
	}
	_, _, err := h.svc.CreateAccessToken(ctx, p, strings.Repeat("ã", 80), 365)
	assert.NoError(t, err, "80 characters, not bytes")
	_, tok90, err := h.svc.CreateAccessToken(ctx, p, "x", 90)
	require.NoError(t, err)
	assert.NotEmpty(t, tok90)

	student := h.student("pw")
	_, _, err = h.svc.CreateAccessToken(ctx, h.principal(student), "x", 30)
	assert.ErrorIs(t, err, domain.ErrAccessTokenForbidden)

	admin := h.users.add(userdomain.User{Email: "a@example.com", Role: userdomain.RoleAdmin})
	_, _, err = h.svc.CreateAccessToken(ctx, h.principal(admin), "x", 30)
	assert.NoError(t, err)

	h.tokens.err = errors.New("db down")
	_, _, err = h.svc.CreateAccessToken(ctx, p, "x", 30)
	assert.ErrorContains(t, err, "db down")
}

func TestAuthenticateAccessTokenResolvesCurrentUser(t *testing.T) {
	h := newTokenHarness()
	_, raw := h.create(t)

	p, err := h.svc.AuthenticateAccessToken(context.Background(), raw)
	require.NoError(t, err)
	assert.Equal(t, h.teacher.ID, p.UserID)
	assert.Equal(t, authn.RoleTeacher, p.Role)
	assert.Equal(t, uuid.Nil, p.SessionID)

	_, err = h.svc.AuthenticateAccessToken(context.Background(), "unknown")
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)
}

// Covers SPEC-024 RN-02: expiry.
func TestAuthenticateAccessTokenRejectsExpired(t *testing.T) {
	h := newTokenHarness()
	tok, raw := h.create(t)

	h.now = tok.ExpiresAt.Add(-time.Second)
	_, err := h.svc.AuthenticateAccessToken(context.Background(), raw)
	assert.NoError(t, err)

	h.now = tok.ExpiresAt
	_, err = h.svc.AuthenticateAccessToken(context.Background(), raw)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)
}

// Covers SPEC-024 RN-02: revoking is immediate.
func TestRevokeAccessToken(t *testing.T) {
	h := newTokenHarness()
	ctx := context.Background()
	tok, raw := h.create(t)
	p := h.principal(h.teacher)

	require.NoError(t, h.svc.RevokeAccessToken(ctx, p, tok.ID))
	_, err := h.svc.AuthenticateAccessToken(ctx, raw)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)

	revokedAt := *h.tokens.byID[tok.ID].RevokedAt
	h.now = h.now.Add(time.Hour)
	require.NoError(t, h.svc.RevokeAccessToken(ctx, p, tok.ID), "revoking twice is a no-op")
	assert.True(t, revokedAt.Equal(*h.tokens.byID[tok.ID].RevokedAt))

	assert.ErrorIs(t, h.svc.RevokeAccessToken(ctx, p, uuid.New()), domain.ErrAccessTokenNotFound)
}

// Covers SPEC-024 section 5: a token of another user does not exist, except
// for ADMIN.
func TestRevokeAccessTokenOwnership(t *testing.T) {
	h := newTokenHarness()
	ctx := context.Background()
	tok, raw := h.create(t)
	other := h.users.add(userdomain.User{Email: "o@example.com", Role: userdomain.RoleTeacher})

	err := h.svc.RevokeAccessToken(ctx, h.principal(other), tok.ID)
	assert.ErrorIs(t, err, domain.ErrAccessTokenNotFound)
	_, err = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.NoError(t, err, "the token was not revoked")

	admin := h.users.add(userdomain.User{Email: "a@example.com", Role: userdomain.RoleAdmin})
	require.NoError(t, h.svc.RevokeAccessToken(ctx, h.principal(admin), tok.ID))
	_, err = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)

	h.tokens.err = errors.New("db down")
	assert.ErrorContains(t, h.svc.RevokeAccessToken(ctx, h.principal(admin), tok.ID), "db down")
}

// Covers SPEC-024 RN-03: the role is read from the user on every call.
func TestAccessTokenFollowsTheCurrentUser(t *testing.T) {
	h := newTokenHarness()
	ctx := context.Background()
	_, raw := h.create(t)

	admin := h.teacher
	admin.Role = userdomain.RoleAdmin
	h.users.byID[admin.ID] = admin
	p, err := h.svc.AuthenticateAccessToken(ctx, raw)
	require.NoError(t, err)
	assert.Equal(t, authn.RoleAdmin, p.Role, "promotion applies at once")

	student := h.teacher
	student.Role = userdomain.RoleStudent
	h.users.byID[student.ID] = student
	_, err = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.ErrorIs(t, err, authn.ErrForbidden, "demotion to STUDENT cuts access")

	inactive := h.teacher
	inactive.Status = userdomain.StatusInactive
	h.users.byID[inactive.ID] = inactive
	_, err = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated, "deactivated user")

	delete(h.users.byID, h.teacher.ID)
	_, err = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated, "deleted user")

	h.users.findErr = errors.New("db down")
	_, err = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.ErrorContains(t, err, "db down")
}

// Covers SPEC-024 section 4: last_used_at at most once per minute.
func TestAccessTokenLastUsedIsThrottled(t *testing.T) {
	h := newTokenHarness()
	ctx := context.Background()
	_, raw := h.create(t)

	for range 3 {
		_, err := h.svc.AuthenticateAccessToken(ctx, raw)
		require.NoError(t, err)
	}
	assert.Equal(t, 1, h.tokens.touches)

	h.now = h.now.Add(59 * time.Second)
	_, _ = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.Equal(t, 1, h.tokens.touches)

	h.now = h.now.Add(time.Second)
	_, _ = h.svc.AuthenticateAccessToken(ctx, raw)
	assert.Equal(t, 2, h.tokens.touches)
}

func TestAccessTokenBookkeepingFailureDoesNotFailTheRequest(t *testing.T) {
	h := newTokenHarness()
	_, raw := h.create(t)
	// Reads work, writes fail.
	h.svc.AccessTokens = &touchFails{fakeTokens: h.tokens}
	_, err := h.svc.AuthenticateAccessToken(context.Background(), raw)
	assert.NoError(t, err)
}

type touchFails struct{ *fakeTokens }

func (touchFails) TouchAccessToken(context.Context, uuid.UUID, time.Time) error {
	return errors.New("touch failed")
}

func TestAccessTokenStoreErrorsPropagate(t *testing.T) {
	h := newTokenHarness()
	h.tokens.err = errors.New("db down")
	_, err := h.svc.AuthenticateAccessToken(context.Background(), "x")
	assert.ErrorContains(t, err, "db down")
	_, err = h.svc.ListAccessTokens(context.Background(), h.principal(h.teacher))
	assert.ErrorContains(t, err, "db down")
}

// Covers SPEC-024 RN-02: the two credentials are not interchangeable.
func TestSessionAndAccessTokensAreSeparate(t *testing.T) {
	h := newTokenHarness()
	ctx := context.Background()
	_, access := h.create(t)

	ra := "7654321"
	pw := "hashed:correct horse battery"
	h.users.add(userdomain.User{Email: "s@example.com", AcademicID: &ra, PasswordHash: &pw, Role: userdomain.RoleTeacher})
	login, err := h.svc.Login(ctx, userdomain.Identifier{Email: "s@example.com"}, "s@example.com", "correct horse battery",
		domain.RequestInfo{})
	require.NoError(t, err)

	_, err = h.svc.Authenticate(ctx, access)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated, "access token is not a session")
	_, err = h.svc.AuthenticateAccessToken(ctx, login.Token)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated, "session token is not an access token")
}
