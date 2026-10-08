// Package domain holds the User entity and its identifier rules (SPEC-003).
package domain

import (
	"errors"
	"strings"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Role is the access role of a user.
type Role string

// Roles.
const (
	RoleAdmin   Role = "ADMIN"
	RoleTeacher Role = "TEACHER"
	RoleStudent Role = "STUDENT"
)

// Status is the account status. INACTIVE is a permanent administrative
// shutdown; SUSPENDED is a temporary, reversible block.
type Status string

// Account statuses.
const (
	StatusActive    Status = "ACTIVE"
	StatusInactive  Status = "INACTIVE"
	StatusSuspended Status = "SUSPENDED"
)

// User is the canonical account of the platform.
type User struct {
	database.Model
	Name               *string
	Email              string
	AcademicID         *string
	PasswordHash       *string
	Role               Role
	Status             Status
	MustChangePassword bool
}

// TableName pins the table name.
func (User) TableName() string { return "users" }

// HasPassword reports whether the account already has a password set.
func (u User) HasPassword() bool {
	return u.PasswordHash != nil && *u.PasswordHash != ""
}

// Errors.
var (
	ErrNotFound          = errors.New("user not found")
	ErrInvalidAcademicID = errors.New("academic id must have exactly 7 digits, optionally prefixed by 'a'")
	ErrInvalidEmail      = errors.New("invalid e-mail address")
	ErrEmailTaken        = errors.New("e-mail already registered")
	ErrAcademicIDTaken   = errors.New("academic id already registered")
)

// academicIDLength is the size of a UTFPR academic id (RA).
const academicIDLength = 7

// NormalizeAcademicID applies RN-01: trims spaces, drops one optional "a" or
// "A" prefix and requires exactly 7 digits.
func NormalizeAcademicID(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if strings.HasPrefix(v, "a") || strings.HasPrefix(v, "A") {
		v = v[1:]
	}
	if len(v) != academicIDLength {
		return "", ErrInvalidAcademicID
	}
	for _, c := range v {
		if c < '0' || c > '9' {
			return "", ErrInvalidAcademicID
		}
	}
	return v, nil
}

// NormalizeEmail applies RN-02: trims spaces and lowercases. It performs a
// minimal structural check; deliverability is not verified.
func NormalizeEmail(raw string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	at := strings.LastIndex(v, "@")
	if at < 1 || at == len(v)-1 || strings.ContainsAny(v, " \t\r\n") || !strings.Contains(v[at+1:], ".") {
		return "", ErrInvalidEmail
	}
	return v, nil
}

// Identifier is a login identifier: either an e-mail or an academic id.
type Identifier struct {
	Email      string
	AcademicID string
}

// IsEmail reports whether the identifier is an e-mail.
func (i Identifier) IsEmail() bool { return i.Email != "" }

// Key returns a stable key for rate limiting.
func (i Identifier) Key() string {
	if i.IsEmail() {
		return "email:" + i.Email
	}
	return "ra:" + i.AcademicID
}

// ParseIdentifier treats values containing "@" as e-mails and the rest as
// academic ids (RN-01, RN-02).
func ParseIdentifier(raw string) (Identifier, error) {
	if strings.Contains(raw, "@") {
		email, err := NormalizeEmail(raw)
		if err != nil {
			return Identifier{}, err
		}
		return Identifier{Email: email}, nil
	}
	ra, err := NormalizeAcademicID(raw)
	if err != nil {
		return Identifier{}, err
	}
	return Identifier{AcademicID: ra}, nil
}
