package domain

import (
	"errors"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// The chat of the lesson (SPEC-063).
const (
	MaxChatLength = 500 // characters, not bytes

	// ChatHistoryStudent and ChatHistoryPanel are how many of the last messages the snapshot of a student and of the panel carry.
	ChatHistoryStudent = 200
	ChatHistoryPanel   = 500

	// Who wrote a message of the chat.
	ChatSenderTeacher = "TEACHER"
	ChatSenderStudent = "STUDENT"
)

// ErrInvalidChatText is the answer to a message that is empty, too long, has a control character or too many line breaks in a row.
var ErrInvalidChatText = errors.New("the message must have from 1 to 500 characters, with no control characters but the line break, and at most 3 line breaks in a row")

// NormalizeChatText trims the text of a chat message and checks it: from 1 to MaxChatLength characters (counted by character), no control
// characters except the line break, and no more than 3 line breaks in a row. The text is plain text: nothing else is changed in it.
func NormalizeChatText(raw string) (string, error) {
	text, ok := normalizePlainText(raw, MaxChatLength)
	if !ok || text == "" {
		return "", ErrInvalidChatText
	}
	return text, nil
}

// LiveChatMessage is a message of the chat of a room. StudentID owns the conversation: it is the student, whoever wrote the message, and
// nil for a message of the teacher to everybody.
type LiveChatMessage struct {
	database.Model
	SessionID  uuid.UUID
	SenderID   uuid.UUID
	SenderRole string
	StudentID  *uuid.UUID
	Body       string
}

// TableName maps LiveChatMessage to its table.
func (LiveChatMessage) TableName() string { return "live_chat_messages" }
