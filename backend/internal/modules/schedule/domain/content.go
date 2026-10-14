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

// Limits of the content of a lesson (SPEC-053 RN-01).
const (
	MaxTopicLength       = 120
	MaxSessionLinks      = 10
	MaxLinkNameLength    = 80
	MaxLinkURLLength     = 2000
	MaxContentDescLength = 20000 // the same as the syllabus of a class (SPEC-041 RN-02)
)

// Errors of the content of a lesson.
var (
	ErrInvalidSessionContent = errors.New("invalid class session content")
	ErrContentTooLong        = errors.New("the description has more than 20000 characters")
	ErrDeckNotFound          = errors.New("presentation not found")
	ErrModuleNotFound        = errors.New("teaching module not found")
)

// SessionLink is a link of a lesson: a name and an https address (SPEC-053).
type SessionLink struct {
	database.Model
	SessionID uuid.UUID
	Position  int
	Name      string
	URL       string `gorm:"column:url"`
}

// TableName maps SessionLink to its table.
func (SessionLink) TableName() string { return "class_session_links" }

// LinkInput is a link as the teacher sent it.
type LinkInput struct {
	Name string
	URL  string
}

// NormalizeTopic trims the topic and checks its length; an empty topic means none (SPEC-053 RN-01).
func NormalizeTopic(topic string) (*string, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(topic) > MaxTopicLength {
		return nil, fieldError("topic", ErrInvalidSessionContent)
	}
	return &topic, nil
}

// BuildSessionLinks checks the links and turns them into links of the lesson, trimmed and in the order sent (SPEC-053 RN-01).
func BuildSessionLinks(sessionID uuid.UUID, in []LinkInput) ([]SessionLink, error) {
	if len(in) > MaxSessionLinks {
		return nil, fieldError("links", ErrInvalidSessionContent)
	}
	links := make([]SessionLink, 0, len(in))
	for i, item := range in {
		name := strings.TrimSpace(item.Name)
		if n := utf8.RuneCountInString(name); n < 1 || n > MaxLinkNameLength {
			return nil, fieldError(fmt.Sprintf("links[%d].name", i), ErrInvalidSessionContent)
		}
		address := strings.TrimSpace(item.URL)
		if !httpsAddress(address) {
			return nil, fieldError(fmt.Sprintf("links[%d].url", i), ErrInvalidSessionContent)
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, err
		}
		links = append(links, SessionLink{Model: database.Model{ID: id}, SessionID: sessionID, Position: i, Name: name, URL: address})
	}
	return links, nil
}

// httpsAddress tells an absolute https address with a host, without spaces.
func httpsAddress(s string) bool {
	if s == "" || len(s) > MaxLinkURLLength || strings.ContainsAny(s, " \t\r\n") {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != ""
}
