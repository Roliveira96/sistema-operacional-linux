// Package domain holds login sessions, password reset tokens, audit events
// and the password policy (SPEC-003).
package domain

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Session lifetime rules (RN-06, RN-07).
const (
	IdleTimeout     = time.Hour
	AbsoluteTimeout = 5 * time.Hour
	ResetTokenTTL   = time.Hour
)

// SessionStatus is the lifecycle state of a login session.
type SessionStatus string

// Session statuses.
const (
	SessionActive               SessionStatus = "ACTIVE"
	SessionExpiredIdle          SessionStatus = "EXPIRED_IDLE"
	SessionExpiredAbsolute      SessionStatus = "EXPIRED_ABSOLUTE"
	SessionRevokedLogout        SessionStatus = "REVOKED_LOGOUT"
	SessionRevokedConcurrency   SessionStatus = "REVOKED_CONCURRENCY"
	SessionRevokedPasswordReset SessionStatus = "REVOKED_PASSWORD_RESET"
)

// Session is a login session. Only the SHA-256 of the token is stored.
type Session struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID         uuid.UUID `gorm:"type:uuid"`
	TokenHash      string
	IPAddress      string
	UserAgent      string
	Status         SessionStatus
	LastActivityAt time.Time
	ExpiresAt      time.Time
	CreatedAt      time.Time
	RevokedAt      *time.Time
}

// TableName pins the table name.
func (Session) TableName() string { return "auth_sessions" }

// IdleExpired reports whether the session exceeded the inactivity window.
func (s Session) IdleExpired(now time.Time) bool {
	return now.Sub(s.LastActivityAt) > IdleTimeout
}

// AbsoluteExpired reports whether the session passed its absolute limit.
func (s Session) AbsoluteExpired(now time.Time) bool {
	return now.After(s.ExpiresAt)
}

// PasswordResetToken is a single-use reset token. Only its hash is stored.
type PasswordResetToken struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID `gorm:"type:uuid"`
	TokenHash string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

// TableName pins the table name.
func (PasswordResetToken) TableName() string { return "password_reset_tokens" }

// Usable reports whether the token can still be consumed.
func (t PasswordResetToken) Usable(now time.Time) bool {
	return t.UsedAt == nil && now.Before(t.ExpiresAt)
}

// EventType is a security audit event.
type EventType string

// Audit events.
const (
	EventLoginSucceeded              EventType = "LOGIN_SUCCEEDED"
	EventLoginFailedWrongPassword    EventType = "LOGIN_FAILED_WRONG_PASSWORD"
	EventLoginFailedUnknownUser      EventType = "LOGIN_FAILED_UNKNOWN_USER"
	EventLoginFailedAccountNotActive EventType = "LOGIN_FAILED_ACCOUNT_NOT_ACTIVE"
	EventLoginBlockedRateLimit       EventType = "LOGIN_BLOCKED_RATE_LIMIT"
	EventLogout                      EventType = "LOGOUT"
	EventSessionExpiredIdle          EventType = "SESSION_EXPIRED_IDLE"
	EventSessionExpiredAbsolute      EventType = "SESSION_EXPIRED_ABSOLUTE"
	EventSessionRevokedConcurrency   EventType = "SESSION_REVOKED_CONCURRENCY"
	EventPasswordResetRequested      EventType = "PASSWORD_RESET_REQUESTED"
	EventPasswordResetCompleted      EventType = "PASSWORD_RESET_COMPLETED"
	EventPasswordChanged             EventType = "PASSWORD_CHANGED"
	EventAdminSeeded                 EventType = "ADMIN_SEEDED"
	EventOAuthLoginSucceeded        EventType = "OAUTH_LOGIN_SUCCEEDED"
	EventOAuthLoginFailed           EventType = "OAUTH_LOGIN_FAILED"
	EventRegisterSucceeded          EventType = "REGISTER_SUCCEEDED"
	EventRegisterFailed             EventType = "REGISTER_FAILED"
)

// AuditLog is one append-only security audit entry.
type AuditLog struct {
	ID                  uuid.UUID  `gorm:"type:uuid;primaryKey"`
	UserID              *uuid.UUID `gorm:"type:uuid"`
	EventType           EventType
	AttemptedIdentifier *string
	IPAddress           string
	UserAgent           string
	Metadata            json.RawMessage `gorm:"type:jsonb"`
	OccurredAt          time.Time
}

// TableName pins the table name.
func (AuditLog) TableName() string { return "security_audit_logs" }

// RequestInfo is the network context of a request, recorded in audits.
type RequestInfo struct {
	IP        string
	UserAgent string
}

// Errors returned by the auth service.
var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrResetTokenInvalid  = errors.New("password reset token is invalid, expired or used")
)

// Password policy limits (RN-14).
const (
	MinPasswordLength = 10
	MaxPasswordLength = 128
)

// Policy violation codes, returned to the client.
const (
	ViolationTooShort       = "TOO_SHORT"
	ViolationTooLong        = "TOO_LONG"
	ViolationEqualsEmail    = "EQUALS_EMAIL"
	ViolationEqualsAcademic = "EQUALS_ACADEMIC_ID"
	ViolationSameAsCurrent  = "SAME_AS_CURRENT"
)

// PolicyError lists every rule a password violates.
type PolicyError struct {
	Violations []string
}

func (e *PolicyError) Error() string {
	return "password violates policy: " + strings.Join(e.Violations, ", ")
}

// CheckPassword applies RN-14: 10 to 128 characters, different from the
// user's e-mail and academic id, no composition rules.
func CheckPassword(password, email, academicID string) error {
	var v []string
	n := utf8.RuneCountInString(password)
	if n < MinPasswordLength {
		v = append(v, ViolationTooShort)
	}
	if n > MaxPasswordLength {
		v = append(v, ViolationTooLong)
	}
	if email != "" && strings.EqualFold(password, email) {
		v = append(v, ViolationEqualsEmail)
	}
	if academicID != "" && (password == academicID || strings.EqualFold(password, "a"+academicID)) {
		v = append(v, ViolationEqualsAcademic)
	}
	if len(v) > 0 {
		return &PolicyError{Violations: v}
	}
	return nil
}
