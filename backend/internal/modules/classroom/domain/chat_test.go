package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-063 CA-05, CA-10 and section 3.1: the text of a chat message is trimmed at the ends and has from 1 to 500 characters, counted by
// character and not by byte; the only control character allowed is the line break, and at most 3 in a row; the text is plain text and stays
// as it came.
func TestNormalizeChatText_Valid(t *testing.T) {
	zwj := "👨‍👩‍👧" // 5 characters: three people and two joiners
	for _, tc := range []struct{ name, in, want string }{
		{"plain", "Professor, não entendi o fork", "Professor, não entendi o fork"},
		{"one character", "a", "a"},
		{"trimmed at the ends", "  \n Já explico \t ", "Já explico"},
		{"500 characters", strings.Repeat("a", 500), strings.Repeat("a", 500)},
		{"500 accented characters, 1,000 bytes", strings.Repeat("ã", 500), strings.Repeat("ã", 500)},
		{"500 emoji, 2,000 bytes", strings.Repeat("😀", 500), strings.Repeat("😀", 500)},
		{"100 joined emoji are 500 characters", strings.Repeat(zwj, 100), strings.Repeat(zwj, 100)},
		{"the blanks of the ends are not counted", "  " + strings.Repeat("a", 500) + "  ", strings.Repeat("a", 500)},
		{"a line break", "linha um\nlinha dois", "linha um\nlinha dois"},
		{"three line breaks in a row", "a\n\n\nb", "a\n\n\nb"},
		{"two groups of three", "a\n\n\nb\n\n\nc", "a\n\n\nb\n\n\nc"},
		{"many line breaks at the ends are trimmed, not counted", "\n\n\n\n\na\n\n\n\n\n", "a"},
		{"a no-break space is not a control character", "a b", "a b"},
		{"the text stays as it is: it is plain text", "<b>oi</b> & 'aspas' \"duplas\" ${x}", "<b>oi</b> & 'aspas' \"duplas\" ${x}"},
	} {
		got, err := domain.NormalizeChatText(tc.in)
		assert.NoError(t, err, tc.name)
		assert.Equal(t, tc.want, got, tc.name)
	}
}

// Covers SPEC-063 CA-05: an empty text, more than 500 characters, a control character other than the line break, more than 3 line breaks in a
// row and text that is not UTF-8 are refused, with the error of the domain and no text.
func TestNormalizeChatText_Refused(t *testing.T) {
	zwj := "👨‍👩‍👧"
	for _, tc := range []struct{ name, in string }{
		{"empty", ""},
		{"blanks only", " \t\n  "},
		{"line breaks only", "\n\n\n"},
		{"501 characters", strings.Repeat("a", 501)},
		{"501 accented characters", strings.Repeat("ã", 501)},
		{"501 emoji", strings.Repeat("😀", 501)},
		{"101 joined emoji are 505 characters", strings.Repeat(zwj, 101)},
		{"501 after the trim", " " + strings.Repeat("a", 501) + " "},
		{"a tab", "a\tb"},
		{"a carriage return", "a\rb"},
		{"a windows line break", "a\r\nb"},
		{"a null", "a\x00b"},
		{"an escape", "a\x1bb"},
		{"a bell", "a\x07b"},
		{"a delete", "a\x7fb"},
		{"a next line", "a\u0085b"},
		{"a c1 control", "a\u009fb"},
		{"four line breaks in a row", "a\n\n\n\nb"},
		{"four line breaks after a group of three", "a\n\n\nb\n\n\n\nc"},
		{"not utf-8", "a\xffb"},
	} {
		got, err := domain.NormalizeChatText(tc.in)
		assert.ErrorIs(t, err, domain.ErrInvalidChatText, tc.name)
		assert.Empty(t, got, tc.name)
	}
}

// Covers SPEC-063 section 3.1: the limit of the text, the two senders and how much history each reader gets.
func TestChatConstants(t *testing.T) {
	assert.Equal(t, 500, domain.MaxChatLength)
	assert.Equal(t, 200, domain.ChatHistoryStudent)
	assert.Equal(t, 500, domain.ChatHistoryPanel)
	assert.Equal(t, "TEACHER", domain.ChatSenderTeacher)
	assert.Equal(t, "STUDENT", domain.ChatSenderStudent)
	assert.Equal(t, "live_chat_messages", domain.LiveChatMessage{}.TableName())
}
