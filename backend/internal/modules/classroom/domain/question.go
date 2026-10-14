package domain

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// The doubt that a student writes when he raises his hand (SPEC-058).
const (
	MaxQuestionLength     = 300 // characters, not bytes
	maxQuestionLineBreaks = 3   // in a row
)

// ErrInvalidQuestion is the answer to a question that is too long, has a control character or too many line breaks in a row.
var ErrInvalidQuestion = errors.New("the question must have up to 300 characters, with no control characters but the line break, and at most 3 line breaks in a row")

// NormalizeQuestion trims the question and checks it: up to MaxQuestionLength characters (counted by character), no control characters
// except the line break, and no more than 3 line breaks in a row. Empty means no question, and the result is then "". The text is plain
// text: nothing else is changed in it.
func NormalizeQuestion(raw string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", ErrInvalidQuestion
	}
	text := strings.TrimSpace(raw)
	if utf8.RuneCountInString(text) > MaxQuestionLength {
		return "", ErrInvalidQuestion
	}
	breaks := 0
	for _, r := range text {
		if r == '\n' {
			if breaks++; breaks > maxQuestionLineBreaks {
				return "", ErrInvalidQuestion
			}
			continue
		}
		if unicode.IsControl(r) {
			return "", ErrInvalidQuestion
		}
		breaks = 0
	}
	return text, nil
}
