package domain

import (
	"encoding/json"
	"fmt"
	"html"
	"strings"
	"unicode/utf8"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/htmlsafe"
)

// The sizes the teacher chooses for the answer of a descriptive question, in characters of text (SPEC-039 D-05).
var AnswerSizes = []int{500, 1000, 2000, 5000, 10000}

// DefaultAnswerSize is the size of an answer when the teacher does not choose one.
const DefaultAnswerSize = 2000

// ScoreBands are the grades a descriptive answer gets: the percentage of what is right (SPEC-039, the Tech Lead).
var ScoreBands = []int{0, 25, 50, 75, 100}

// ValidScore tells whether a grade is one of the five bands.
func ValidScore(score int) bool {
	for _, b := range ScoreBands {
		if b == score {
			return true
		}
	}
	return false
}

// discursiveKey is the answer key of a descriptive question as answer_key stores it.
type discursiveKey struct {
	ExpectedAnswer string `json:"expectedAnswer,omitempty"`
	MaxLength      int    `json:"maxLength"`
}

// ReadDiscursiveKey reads the correct answer and the size of a descriptive question; the size is the default when it is missing.
func ReadDiscursiveKey(answerKey json.RawMessage) (expected string, maxLength int) {
	var key discursiveKey
	if len(answerKey) > 0 {
		_ = json.Unmarshal(answerKey, &key)
	}
	if key.MaxLength == 0 {
		key.MaxLength = DefaultAnswerSize
	}
	return key.ExpectedAnswer, key.MaxLength
}

var answerSanitizer = htmlsafe.NewAnswer()

// answerText is the text of an answer, the way its size is counted.
func answerText(markup string) string {
	return strings.TrimSpace(html.UnescapeString(tags.ReplaceAllString(markup, "")))
}

// discursiveType is the descriptive question (SPEC-039): a free answer with text and commands, graded by the teacher with the help of
// an AI through the MCP.
type discursiveType struct{}

func (discursiveType) Kind() string       { return KindDiscursive }
func (discursiveType) UsesTerminal() bool { return false }

func (discursiveType) normalize(c *checker, in ExerciseInput, out *NormalizedExercise) {
	if hasValue(in.Solution) {
		c.fail("solution", "a descriptive question has no solution in the terminal")
	}
	if hasValue(in.Conditions) {
		c.fail("conditions", "a descriptive question has no conditions of finalization")
	}
	if in.HasDependency {
		c.fail("dependsOn", "a descriptive question does not depend on another exercise")
	}
	if in.CorrectAnswer != nil {
		c.fail("correctAnswer", "a descriptive question is graded by the teacher")
	}
	if hasValue(in.Choices) || in.CorrectChoice != nil {
		c.fail("choices", "a descriptive question has no choices")
	}
	refuseColumns(c, in, "a descriptive question has no columns")
	size := DefaultAnswerSize
	if in.MaxLength != nil {
		size = *in.MaxLength
		valid := false
		for _, s := range AnswerSizes {
			valid = valid || s == size
		}
		if !valid {
			c.fail("maxLength", fmt.Sprintf("must be one of %v", AnswerSizes))
		}
	}
	expected := c.html("expectedAnswer", in.ExpectedAnswer, false)
	if len(c.errs) > 0 {
		return
	}
	out.AnswerKey, _ = marshalNoEscape(discursiveKey{ExpectedAnswer: expected, MaxLength: size})
}

func (discursiveType) Missing(q Question) []FieldError {
	if !hasContent(q.Statement) {
		return []FieldError{{"statement", "required"}}
	}
	return nil
}

func (discursiveType) Grade(q Question, response json.RawMessage) (ResponseVerdict, error) {
	var r struct {
		HTML *string `json:"html"`
	}
	if err := json.Unmarshal(response, &r); err != nil || r.HTML == nil {
		return ResponseVerdict{}, ErrInvalidResponse
	}
	_, size := ReadDiscursiveKey(q.AnswerKey)
	clean := strings.TrimSpace(answerSanitizer.Sanitize(*r.HTML))
	text := answerText(clean)
	if text == "" || utf8.RuneCountInString(text) > size {
		return ResponseVerdict{}, ErrInvalidResponse
	}
	stored, err := marshalNoEscape(map[string]string{"html": clean})
	if err != nil {
		return ResponseVerdict{}, err
	}
	return ResponseVerdict{Pending: true, Stored: stored}, nil
}

func (discursiveType) Revealed(q Question) (string, json.RawMessage) {
	expected, _ := ReadDiscursiveKey(q.AnswerKey)
	if expected == "" {
		return "", nil
	}
	value, _ := marshalNoEscape(expected)
	return "expectedAnswer", value
}

// AnswerHTML reads the HTML of a descriptive answer as exercise_progress.response keeps it; empty when there is none.
func AnswerHTML(response json.RawMessage) string {
	var body struct {
		HTML string `json:"html"`
	}
	if len(response) > 0 {
		_ = json.Unmarshal(response, &body)
	}
	return body.HTML
}
