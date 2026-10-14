// Package domain holds the links of a class: a name and an https address that the teacher publishes for the students (SPEC-048).
package domain

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Limits of a link and of a list (SPEC-048 RN-01, RN-02).
const (
	MaxLinks      = 20
	MaxNameLength = 80
	MaxURLLength  = 2000
)

// Errors of the domain.
var (
	ErrInvalidLink   = errors.New("the link is not valid")
	ErrTooManyLinks  = errors.New("a class has at most 20 links")
	ErrForbidden     = errors.New("you are not allowed to change the links of this class")
	ErrClassNotFound = errors.New("class not found")
	ErrClassArchived = errors.New("the links of an archived class cannot be changed")
)

// FieldError tells which field of which item broke a rule. It matches the sentinel it wraps.
type FieldError struct {
	Field string
	Err   error
}

func (e *FieldError) Error() string { return e.Field + ": " + e.Err.Error() }

// Unwrap returns the sentinel error.
func (e *FieldError) Unwrap() error { return e.Err }

// ClassLink is a link of a class.
type ClassLink struct {
	database.Model
	ClassID  uuid.UUID
	Position int
	Name     string
	URL      string `gorm:"column:url"`
}

// TableName maps ClassLink to its table.
func (ClassLink) TableName() string { return "class_links" }

// Input is a link as the teacher sent it.
type Input struct {
	Name string
	URL  string
}

// BuildLinks checks the list and turns it into links of the class, trimmed and in the order sent (SPEC-048 RN-01 to RN-03).
func BuildLinks(classID uuid.UUID, in []Input) ([]ClassLink, error) {
	if len(in) > MaxLinks {
		return nil, ErrTooManyLinks
	}
	links := make([]ClassLink, 0, len(in))
	for i, item := range in {
		name := strings.TrimSpace(item.Name)
		if n := utf8.RuneCountInString(name); n < 1 || n > MaxNameLength {
			return nil, &FieldError{Field: fmt.Sprintf("links[%d].name", i), Err: ErrInvalidLink}
		}
		address := strings.TrimSpace(item.URL)
		if !validAddress(address) {
			return nil, &FieldError{Field: fmt.Sprintf("links[%d].url", i), Err: ErrInvalidLink}
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, err
		}
		links = append(links, ClassLink{Model: database.Model{ID: id}, ClassID: classID, Position: i, Name: name, URL: address})
	}
	return links, nil
}

// validAddress tells an absolute https address with a host, without spaces (SPEC-048 RN-01).
func validAddress(s string) bool {
	if s == "" || len(s) > MaxURLLength || strings.ContainsAny(s, " \t\r\n") {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != ""
}
