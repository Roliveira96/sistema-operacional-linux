package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Personal access token rules (SPEC-024 RN-02).
const (
	MaxAccessTokenNameLength = 80
	// AccessTokenTouchInterval bounds how often last_used_at is written.
	AccessTokenTouchInterval = time.Minute
)

// AccessTokenValidityDays are the accepted validity choices.
var AccessTokenValidityDays = []int{30, 90, 365}

// AccessTokenStatus is the derived situation of a token.
type AccessTokenStatus string

// Access token statuses.
const (
	AccessTokenActive  AccessTokenStatus = "ACTIVE"
	AccessTokenExpired AccessTokenStatus = "EXPIRED"
	AccessTokenRevoked AccessTokenStatus = "REVOKED"
)

// AccessToken is a personal access token used by the MCP server. Only the
// SHA-256 of the token is stored, and the role is never stored: it is read
// from the user on every use (SPEC-024 RN-03).
type AccessToken struct {
	database.Model
	UserID     uuid.UUID `gorm:"type:uuid"`
	Name       string
	TokenHash  string
	ExpiresAt  time.Time
	LastUsedAt *time.Time
	RevokedAt  *time.Time
}

// TableName pins the table name.
func (AccessToken) TableName() string { return "access_tokens" }

// Status derives the situation of the token at now.
func (t AccessToken) Status(now time.Time) AccessTokenStatus {
	switch {
	case t.RevokedAt != nil:
		return AccessTokenRevoked
	case !now.Before(t.ExpiresAt):
		return AccessTokenExpired
	}
	return AccessTokenActive
}

// Usable reports whether the token can authenticate at now.
func (t AccessToken) Usable(now time.Time) bool { return t.Status(now) == AccessTokenActive }

// Errors returned by the access token use cases.
var (
	ErrAccessTokenNotFound  = errors.New("access token not found")
	ErrAccessTokenName      = errors.New("access token name must have 1 to 80 characters")
	ErrAccessTokenValidity  = errors.New("access token validity must be 30, 90 or 365 days")
	ErrAccessTokenForbidden = errors.New("access tokens are only available to ADMIN and TEACHER users")
)
