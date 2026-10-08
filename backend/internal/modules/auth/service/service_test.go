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

var req = domain.RequestInfo{IP: "192.168.3.50", UserAgent: "test"}

const password = "correct horse battery"

func email(e string) userdomain.Identifier { return userdomain.Identifier{Email: e} }

func login(t *testing.T, h *harness) LoginResult {
	t.Helper()
	res, err := h.svc.Login(context.Background(), email("student@example.com"), "student@example.com", password, req)
	require.NoError(t, err)
	return res
}

// Covers SPEC-003 CA-03 (service side).
func TestLoginSucceedsByEmailAndAcademicID(t *testing.T) {
	h := newHarness()
	u := h.student(password)

	res := login(t, h)
	assert.NotEmpty(t, res.Token)
	assert.Equal(t, u.ID, res.User.ID)
	assert.Equal(t, h.now.Add(5*time.Hour), res.Session.ExpiresAt)
	stored := h.store.sessions[res.Session.ID]
	assert.Equal(t, hashToken(res.Token), stored.TokenHash)
	assert.NotContains(t, stored.TokenHash, res.Token, "CA-15: raw token is never stored")

	_, err := h.svc.Login(context.Background(), userdomain.Identifier{AcademicID: "1234567"}, "a1234567", password, req)
	require.NoError(t, err)
	assert.Equal(t, []domain.EventType{domain.EventLoginSucceeded, domain.EventLoginSucceeded}, h.auditor.events())
}

// Covers SPEC-003 CA-05 and RN-04.
func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	h := newHarness()
	h.student(password)
	suspendedHash := "hashed:" + password
	h.users.add(userdomain.User{Email: "suspended@example.com", PasswordHash: &suspendedHash, Status: userdomain.StatusSuspended})
	h.users.add(userdomain.User{Email: "nopass@example.com"})

	cases := []struct {
		id    string
		pass  string
		event domain.EventType
	}{
		{"ghost@example.com", password, domain.EventLoginFailedUnknownUser},
		{"student@example.com", "wrong password!", domain.EventLoginFailedWrongPassword},
		{"suspended@example.com", password, domain.EventLoginFailedAccountNotActive},
		{"nopass@example.com", password, domain.EventLoginFailedAccountNotActive},
	}
	for _, tc := range cases {
		h.auditor.entries = nil
		calls := h.hasher.verifyCalls
		_, err := h.svc.Login(context.Background(), email(tc.id), tc.id, tc.pass, req)
		assert.ErrorIs(t, err, domain.ErrInvalidCredentials, tc.id)
		assert.Equal(t, []domain.EventType{tc.event}, h.auditor.events(), tc.id)
		assert.Equal(t, calls+1, h.hasher.verifyCalls, "%s: a hash is always verified", tc.id)
	}
	assert.Empty(t, h.store.sessions)
}

func TestLoginPropagatesInfrastructureErrors(t *testing.T) {
	h := newHarness()
	h.users.findErr = errors.New("db down")
	_, err := h.svc.Login(context.Background(), email("a@b.co"), "a@b.co", password, req)
	assert.EqualError(t, err, "db down")

	h = newHarness()
	h.student(password)
	h.store.failWrite = errors.New("insert failed")
	_, err = h.svc.Login(context.Background(), email("student@example.com"), "student@example.com", password, req)
	assert.ErrorContains(t, err, "insert failed")
}

func TestAuthenticateValidSessionTouchesActivity(t *testing.T) {
	h := newHarness()
	u := h.student(password)
	res := login(t, h)

	h.now = h.now.Add(30 * time.Minute)
	p, err := h.svc.Authenticate(context.Background(), res.Token)
	require.NoError(t, err)
	assert.Equal(t, u.ID, p.UserID)
	assert.Equal(t, string(userdomain.RoleStudent), p.Role)
	assert.Equal(t, h.now, h.store.sessions[res.Session.ID].LastActivityAt)
}

// Covers SPEC-003 CA-07.
func TestAuthenticateExpiresIdleSessions(t *testing.T) {
	h := newHarness()
	h.student(password)
	res := login(t, h)

	h.now = h.now.Add(61 * time.Minute)
	_, err := h.svc.Authenticate(context.Background(), res.Token)
	var expired *authn.SessionExpiredError
	require.ErrorAs(t, err, &expired)
	assert.Equal(t, authn.ReasonIdle, expired.Reason)
	assert.Equal(t, domain.SessionExpiredIdle, h.store.sessions[res.Session.ID].Status)
	assert.Contains(t, h.auditor.events(), domain.EventSessionExpiredIdle)

	_, err = h.svc.Authenticate(context.Background(), res.Token)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated, "an ended session stays ended")
}

// Covers SPEC-003 CA-08.
func TestAuthenticateEnforcesAbsoluteLimitDespiteActivity(t *testing.T) {
	h := newHarness()
	h.student(password)
	res := login(t, h)

	for range 10 {
		h.now = h.now.Add(30 * time.Minute)
		_, err := h.svc.Authenticate(context.Background(), res.Token)
		require.NoError(t, err)
	}
	h.now = h.now.Add(2 * time.Minute)
	_, err := h.svc.Authenticate(context.Background(), res.Token)
	var expired *authn.SessionExpiredError
	require.ErrorAs(t, err, &expired)
	assert.Equal(t, authn.ReasonAbsolute, expired.Reason)
	assert.Equal(t, domain.SessionExpiredAbsolute, h.store.sessions[res.Session.ID].Status)
}

func TestAuthenticateRejectsUnknownTokensAndInactiveUsers(t *testing.T) {
	h := newHarness()
	u := h.student(password)
	res := login(t, h)

	_, err := h.svc.Authenticate(context.Background(), "unknown-token")
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)

	u.Status = userdomain.StatusInactive
	h.users.byID[u.ID] = u
	_, err = h.svc.Authenticate(context.Background(), res.Token)
	assert.ErrorIs(t, err, authn.ErrNotAuthenticated)

	h.users.findErr = errors.New("db down")
	_, err = h.svc.Authenticate(context.Background(), res.Token)
	assert.EqualError(t, err, "db down")
}

func TestAuthenticatePropagatesWriteErrors(t *testing.T) {
	h := newHarness()
	h.student(password)
	res := login(t, h)
	h.store.failWrite = errors.New("write failed")

	_, err := h.svc.Authenticate(context.Background(), res.Token)
	assert.ErrorContains(t, err, "write failed")

	h.now = h.now.Add(2 * time.Hour)
	_, err = h.svc.Authenticate(context.Background(), res.Token)
	assert.ErrorContains(t, err, "write failed")
}

func TestLogoutAndMe(t *testing.T) {
	h := newHarness()
	u := h.student(password)
	res := login(t, h)
	p, err := h.svc.Authenticate(context.Background(), res.Token)
	require.NoError(t, err)

	me, err := h.svc.Me(context.Background(), p)
	require.NoError(t, err)
	assert.Equal(t, u.Email, me.Email)

	require.NoError(t, h.svc.Logout(context.Background(), p, req))
	assert.Equal(t, domain.SessionRevokedLogout, h.store.sessions[res.Session.ID].Status)
	assert.Contains(t, h.auditor.events(), domain.EventLogout)

	h.store.failWrite = errors.New("write failed")
	assert.Error(t, h.svc.Logout(context.Background(), p, req))
}

// Covers SPEC-003 CA-10.
func TestForgotPasswordSendsLinkOnlyForActiveAccounts(t *testing.T) {
	h := newHarness()
	u := h.student(password)

	require.NoError(t, h.svc.ForgotPassword(context.Background(), email("student@example.com"), "student@example.com", req))
	require.Len(t, h.mail.sent, 1)
	msg := h.mail.sent[0]
	assert.Equal(t, []string{u.Email}, msg.To)
	assert.Contains(t, msg.TextBody, "http://192.168.3.111:3010/reset-password?token=")
	require.Len(t, h.store.tokens, 1)
	for _, tok := range h.store.tokens {
		assert.Equal(t, h.now.Add(time.Hour), tok.ExpiresAt)
		assert.NotContains(t, msg.TextBody, tok.TokenHash, "CA-15: the e-mail carries the raw token, the store only the hash")
	}

	require.NoError(t, h.svc.ForgotPassword(context.Background(), email("ghost@example.com"), "ghost@example.com", req))
	u.Status = userdomain.StatusSuspended
	h.users.byID[u.ID] = u
	require.NoError(t, h.svc.ForgotPassword(context.Background(), email("student@example.com"), "student@example.com", req))
	assert.Len(t, h.mail.sent, 1, "no e-mail for unknown or inactive accounts")
	assert.Equal(t, []domain.EventType{
		domain.EventPasswordResetRequested, domain.EventPasswordResetRequested, domain.EventPasswordResetRequested,
	}, h.auditor.events())
}

func TestForgotPasswordFailures(t *testing.T) {
	h := newHarness()
	h.student(password)
	h.mail.err = errors.New("queue full")
	require.NoError(t, h.svc.ForgotPassword(context.Background(), email("student@example.com"), "x", req),
		"a mail failure does not change the neutral answer")
	assert.Equal(t, false, h.auditor.entries[0].Metadata["sent"])

	h.store.failWrite = errors.New("write failed")
	assert.Error(t, h.svc.ForgotPassword(context.Background(), email("student@example.com"), "x", req))

	h.users.findErr = errors.New("db down")
	assert.Error(t, h.svc.ForgotPassword(context.Background(), email("student@example.com"), "x", req))
}

func issueResetToken(t *testing.T, h *harness) string {
	t.Helper()
	require.NoError(t, h.svc.ForgotPassword(context.Background(), email("student@example.com"), "x", req))
	body := h.mail.sent[len(h.mail.sent)-1].TextBody
	start := strings.Index(body, "token=") + len("token=")
	return strings.Fields(body[start:])[0]
}

// Covers SPEC-003 CA-11.
func TestResetPasswordUpdatesAndRevokesEverything(t *testing.T) {
	h := newHarness()
	u := h.student(password)
	u.MustChangePassword = true
	h.users.byID[u.ID] = u
	first := login(t, h)
	second := login(t, h)
	token := issueResetToken(t, h)

	n, err := h.svc.ResetPassword(context.Background(), token, "a brand new passphrase", req)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n)
	assert.Equal(t, 1, h.tx.runs)
	assert.Equal(t, "hashed:a brand new passphrase", *h.users.byID[u.ID].PasswordHash)
	assert.False(t, h.users.byID[u.ID].MustChangePassword)
	assert.Equal(t, domain.SessionRevokedPasswordReset, h.store.sessions[first.Session.ID].Status)
	assert.Equal(t, domain.SessionRevokedPasswordReset, h.store.sessions[second.Session.ID].Status)
	assert.Contains(t, h.auditor.events(), domain.EventPasswordResetCompleted)

	_, err = h.svc.ResetPassword(context.Background(), token, "another new passphrase", req)
	assert.ErrorIs(t, err, domain.ErrResetTokenInvalid, "CA-12: a used token is rejected")
}

// Covers SPEC-003 CA-12.
func TestResetPasswordRejectsInvalidTokens(t *testing.T) {
	h := newHarness()
	h.student(password)
	_, err := h.svc.ResetPassword(context.Background(), "never-issued", "a brand new passphrase", req)
	assert.ErrorIs(t, err, domain.ErrResetTokenInvalid)

	token := issueResetToken(t, h)
	h.now = h.now.Add(61 * time.Minute)
	_, err = h.svc.ResetPassword(context.Background(), token, "a brand new passphrase", req)
	assert.ErrorIs(t, err, domain.ErrResetTokenInvalid)
}

func TestResetPasswordPolicyAndRaces(t *testing.T) {
	h := newHarness()
	h.student(password)
	token := issueResetToken(t, h)

	_, err := h.svc.ResetPassword(context.Background(), token, "short", req)
	var pe *domain.PolicyError
	require.ErrorAs(t, err, &pe)

	h.store.markErr = errNotFound
	_, err = h.svc.ResetPassword(context.Background(), token, "a brand new passphrase", req)
	assert.ErrorIs(t, err, domain.ErrResetTokenInvalid, "a concurrent consumption wins")

	h.store.markErr = nil
	h.users.setPassErr = errors.New("update failed")
	_, err = h.svc.ResetPassword(context.Background(), token, "a brand new passphrase", req)
	assert.EqualError(t, err, "update failed")
}

func TestChangePassword(t *testing.T) {
	h := newHarness()
	u := h.student(password)
	u.MustChangePassword = true
	h.users.byID[u.ID] = u
	current := login(t, h)
	other := login(t, h)
	p, err := h.svc.Authenticate(context.Background(), current.Token)
	require.NoError(t, err)

	assert.ErrorIs(t, h.svc.ChangePassword(context.Background(), p, "wrong current pw", "a brand new passphrase", req),
		domain.ErrInvalidCredentials)
	var pe *domain.PolicyError
	require.ErrorAs(t, h.svc.ChangePassword(context.Background(), p, password, "short", req), &pe)
	require.ErrorAs(t, h.svc.ChangePassword(context.Background(), p, password, password, req), &pe)
	assert.Equal(t, []string{domain.ViolationSameAsCurrent}, pe.Violations)

	require.NoError(t, h.svc.ChangePassword(context.Background(), p, password, "a brand new passphrase", req))
	assert.False(t, h.users.byID[u.ID].MustChangePassword)
	assert.Equal(t, domain.SessionActive, h.store.sessions[current.Session.ID].Status, "the current session survives")
	assert.Equal(t, domain.SessionRevokedPasswordReset, h.store.sessions[other.Session.ID].Status)
	assert.Contains(t, h.auditor.events(), domain.EventPasswordChanged)

	h.users.setPassErr = errors.New("update failed")
	assert.Error(t, h.svc.ChangePassword(context.Background(), p, "a brand new passphrase", "yet another passphrase", req))
	h.users.findErr = errors.New("db down")
	assert.Error(t, h.svc.ChangePassword(context.Background(), p, "x", "y", req))
}

// Covers SPEC-003 CA-13.
func TestRevokeOtherSessions(t *testing.T) {
	h := newHarness()
	u := h.student(password)
	keep := login(t, h)
	a := login(t, h)
	b := login(t, h)

	n, err := h.svc.RevokeOtherSessions(context.Background(), u.ID, keep.Session.ID, req)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n)
	assert.Equal(t, domain.SessionActive, h.store.sessions[keep.Session.ID].Status)
	assert.Equal(t, domain.SessionRevokedConcurrency, h.store.sessions[a.Session.ID].Status)
	assert.Equal(t, domain.SessionRevokedConcurrency, h.store.sessions[b.Session.ID].Status)
	assert.Contains(t, h.auditor.events(), domain.EventSessionRevokedConcurrency)

	h.store.failWrite = errors.New("write failed")
	_, err = h.svc.RevokeOtherSessions(context.Background(), u.ID, uuid.Nil, req)
	assert.Error(t, err)
}

// Covers SPEC-003 CA-01 and CA-02.
func TestSeedAdmin(t *testing.T) {
	h := newHarness()
	created, err := h.svc.SeedAdmin(context.Background(), "admin@rmo.dev.br", "initial admin password")
	require.NoError(t, err)
	assert.True(t, created)

	admin, err := h.users.FindByEmail(context.Background(), "admin@rmo.dev.br")
	require.NoError(t, err)
	assert.Equal(t, userdomain.RoleAdmin, admin.Role)
	assert.Equal(t, userdomain.StatusActive, admin.Status)
	assert.True(t, admin.MustChangePassword)
	assert.Equal(t, []domain.EventType{domain.EventAdminSeeded}, h.auditor.events())

	created, err = h.svc.SeedAdmin(context.Background(), "admin@rmo.dev.br", "a different password")
	require.NoError(t, err)
	assert.False(t, created)
	unchanged, _ := h.users.FindByEmail(context.Background(), "admin@rmo.dev.br")
	assert.Equal(t, *admin.PasswordHash, *unchanged.PasswordHash, "CA-02: the existing admin is untouched")
}

func TestSeedAdminRejectsWeakPasswordAndErrors(t *testing.T) {
	h := newHarness()
	_, err := h.svc.SeedAdmin(context.Background(), "admin@rmo.dev.br", "short")
	assert.ErrorContains(t, err, "ADMIN_INITIAL_PASSWORD")

	h.users.findErr = errors.New("db down")
	_, err = h.svc.SeedAdmin(context.Background(), "admin@rmo.dev.br", "initial admin password")
	assert.EqualError(t, err, "db down")
}

func TestRecordRateLimited(t *testing.T) {
	h := newHarness()
	h.svc.RecordRateLimited(context.Background(), "student@example.com", req)
	assert.Equal(t, []domain.EventType{domain.EventLoginBlockedRateLimit}, h.auditor.events())
	assert.Equal(t, "192.168.3.50", h.auditor.entries[0].Request.IP, "CA-14: the IP is recorded")
}
