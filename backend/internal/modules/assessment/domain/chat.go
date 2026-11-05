package domain

import (
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// MaxChatLength is the longest message of the conversation of the exam, in characters (SPEC-093 RN-02).
const MaxChatLength = 500

// ChatScope says whether a message is of the conversation of one student or for all of them.
type ChatScope string

// A message with an attempt is of its conversation; without one, the teacher wrote it to all (SPEC-093 RN-03).
const (
	ChatPrivate ChatScope = "private"
	ChatAll     ChatScope = "all"
)

// ChatRole is who wrote a message.
type ChatRole string

// The teacher (or the administrator) and the student.
const (
	ChatTeacher ChatRole = "TEACHER"
	ChatStudent ChatRole = "STUDENT"
)

// ChatMessage is a message of the conversation of the exam, kept with the attempt (SPEC-093 RN-03). StudentID is the owner of the conversation, read
// from its attempt; both are nil in a message to all.
type ChatMessage struct {
	ID           uuid.UUID
	AssessmentID uuid.UUID
	AttemptID    *uuid.UUID
	StudentID    *uuid.UUID
	SenderID     uuid.UUID
	SenderRole   ChatRole
	Position     *int
	Body         string
	CreatedAt    time.Time
}

// Scope says whose the message is.
func (m ChatMessage) Scope() ChatScope {
	if m.AttemptID == nil {
		return ChatAll
	}
	return ChatPrivate
}

// NormalizeChat trims the text and checks it: 1 to 500 characters, no control character but the new line, at most 3 new lines in a row (RN-02).
func NormalizeChat(text string) (string, error) {
	clean := strings.TrimSpace(text)
	for _, r := range clean {
		if unicode.IsControl(r) && r != '\n' {
			return "", ErrInvalidChat
		}
	}
	if n := utf8.RuneCountInString(clean); n == 0 || n > MaxChatLength || strings.Contains(clean, "\n\n\n\n") {
		return "", ErrInvalidChat
	}
	return clean, nil
}
