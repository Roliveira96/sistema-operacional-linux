package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-058 CA-08 and section 3.2: the question of a raised hand is trimmed at the ends and has from 0 to 300 characters, counted by
// character and not by byte; empty means no question; the only control character allowed is the line break, and at most 3 in a row.
func TestNormalizeQuestion_Valid(t *testing.T) {
	zwj := "👨‍👩‍👧" // 5 characters: three people and two joiners
	for _, tc := range []struct{ name, in, want string }{
		{"empty is no question", "", ""},
		{"blanks only is no question", " \t\n  ", ""},
		{"plain", "Como funciona o fork?", "Como funciona o fork?"},
		{"trimmed at the ends", "  \n Como funciona o fork? \t ", "Como funciona o fork?"},
		{"300 characters", strings.Repeat("a", 300), strings.Repeat("a", 300)},
		{"300 accented characters, 600 bytes", strings.Repeat("ã", 300), strings.Repeat("ã", 300)},
		{"300 emoji, 1,200 bytes", strings.Repeat("😀", 300), strings.Repeat("😀", 300)},
		{"60 joined emoji are 300 characters", strings.Repeat(zwj, 60), strings.Repeat(zwj, 60)},
		{"the blanks of the ends are not counted", "  " + strings.Repeat("a", 300) + "  ", strings.Repeat("a", 300)},
		{"a line break", "linha um\nlinha dois", "linha um\nlinha dois"},
		{"three line breaks in a row", "a\n\n\nb", "a\n\n\nb"},
		{"two groups of three", "a\n\n\nb\n\n\nc", "a\n\n\nb\n\n\nc"},
		{"many line breaks at the ends are trimmed, not counted", "\n\n\n\n\na\n\n\n\n\n", "a"},
		{"a no-break space is not a control character", "a b", "a b"},
		{"the text stays as it is: it is plain text", "<b>oi</b> & 'aspas'", "<b>oi</b> & 'aspas'"},
	} {
		got, err := domain.NormalizeQuestion(tc.in)
		assert.NoError(t, err, tc.name)
		assert.Equal(t, tc.want, got, tc.name)
	}
}

// Covers SPEC-058 CA-08: more than 300 characters, a control character other than the line break, more than 3 line breaks in a row, and
// text that is not UTF-8 are refused, with the error of the domain and no text.
func TestNormalizeQuestion_Refused(t *testing.T) {
	zwj := "👨‍👩‍👧"
	for _, tc := range []struct{ name, in string }{
		{"301 characters", strings.Repeat("a", 301)},
		{"301 accented characters", strings.Repeat("ã", 301)},
		{"301 emoji", strings.Repeat("😀", 301)},
		{"61 joined emoji are 305 characters", strings.Repeat(zwj, 61)},
		{"301 after the trim", " " + strings.Repeat("a", 301) + " "},
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
		got, err := domain.NormalizeQuestion(tc.in)
		assert.ErrorIs(t, err, domain.ErrInvalidQuestion, tc.name)
		assert.Empty(t, got, tc.name)
	}
	assert.Equal(t, 300, domain.MaxQuestionLength)
}
