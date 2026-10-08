package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers RN-14.
func TestCheckPassword(t *testing.T) {
	assert.NoError(t, CheckPassword("long enough phrase", "user@example.com", "1234567"))

	var pe *PolicyError
	require.ErrorAs(t, CheckPassword("short", "", ""), &pe)
	assert.Equal(t, []string{ViolationTooShort}, pe.Violations)

	require.ErrorAs(t, CheckPassword(string(make([]rune, 129)), "", ""), &pe)
	assert.Contains(t, pe.Violations, ViolationTooLong)

	require.ErrorAs(t, CheckPassword("User@Example.com", "user@example.com", ""), &pe)
	assert.Contains(t, pe.Violations, ViolationEqualsEmail)

	require.ErrorAs(t, CheckPassword("a1234567890", "", "1234567890"), &pe)
	assert.Contains(t, pe.Violations, ViolationEqualsAcademic)
	assert.Contains(t, pe.Error(), ViolationEqualsAcademic)
}

func TestPasswordLengthCountsCharactersNotBytes(t *testing.T) {
	assert.NoError(t, CheckPassword("ççççççççç10", "", ""))
}

// Covers RN-07.
func TestSessionExpiry(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	s := Session{LastActivityAt: now.Add(-61 * time.Minute), ExpiresAt: now.Add(time.Hour)}
	assert.True(t, s.IdleExpired(now))
	assert.False(t, s.AbsoluteExpired(now))

	s = Session{LastActivityAt: now, ExpiresAt: now.Add(-time.Second)}
	assert.False(t, s.IdleExpired(now))
	assert.True(t, s.AbsoluteExpired(now))
	assert.Equal(t, "auth_sessions", s.TableName())
}

func TestResetTokenUsable(t *testing.T) {
	now := time.Now()
	used := now
	assert.True(t, PasswordResetToken{ExpiresAt: now.Add(time.Minute)}.Usable(now))
	assert.False(t, PasswordResetToken{ExpiresAt: now.Add(-time.Minute)}.Usable(now))
	assert.False(t, PasswordResetToken{ExpiresAt: now.Add(time.Minute), UsedAt: &used}.Usable(now))
	assert.Equal(t, "password_reset_tokens", PasswordResetToken{}.TableName())
	assert.Equal(t, "security_audit_logs", AuditLog{}.TableName())
}
