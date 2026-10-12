package domain

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Limits of a single choice question (SPEC-036 RN-02, D-02).
const (
	MinChoices       = 2
	MaxChoices       = 7
	MaxChoiceHTML    = 5000
	maxChoiceIDBytes = 40
)

var choiceID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Choice is one alternative of a single choice question: a stable id and its content, filtered html written in the editor
// (SPEC-036 D-01, D-02).
type Choice struct {
	ID   string `json:"id"`
	HTML string `json:"html"`
}

// choiceKey is the answer key of a single choice question as answer_key stores it: the id of the correct alternative.
type choiceKey struct {
	Correct string `json:"correct"`
}

// newChoiceID makes an opaque id for an alternative that comes without one.
func newChoiceID() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Errorf("random choice id: %w", err))
	}
	return hex.EncodeToString(b)
}

// checkChoices validates the alternatives and the correct one at `prefix` (empty for the bank, items[i]. for a card), filters their
// html and gives an id to the ones without it. Only one alternative is correct (SPEC-036, the reinforcement of the Tech Lead).
func checkChoices(c *checker, prefix string, choices []Choice, correct *string) []Choice {
	if len(choices) > MaxChoices {
		c.fail(prefix+"choices", fmt.Sprintf("must have at most %d choices", MaxChoices))
		return choices
	}
	if len(choices) > 0 && len(choices) < MinChoices {
		c.fail(prefix+"choices", fmt.Sprintf("must have at least %d choices", MinChoices))
	}
	seen := map[string]bool{}
	for i := range choices {
		at := fmt.Sprintf("%schoices[%d]", prefix, i)
		id := strings.TrimSpace(choices[i].ID)
		if id == "" {
			id = newChoiceID()
		}
		if len(id) > maxChoiceIDBytes || !choiceID.MatchString(id) {
			c.fail(at+".id", "must be letters, digits, - or _, up to 40")
		} else if seen[id] {
			c.fail(at+".id", "must not repeat")
		}
		seen[id] = true
		choices[i].ID = id
		if utf8.RuneCountInString(choices[i].HTML) > MaxChoiceHTML {
			c.fail(at+".html", fmt.Sprintf("must have at most %d characters", MaxChoiceHTML))
			continue
		}
		choices[i].HTML = strings.TrimSpace(c.s.Sanitize(choices[i].HTML))
	}
	if correct != nil && !seen[strings.TrimSpace(*correct)] {
		c.fail(prefix+"correctChoice", "must be the id of one of the choices")
	}
	return choices
}

// choiceProblems says what a set of alternatives misses to be published: between 2 and 7, none empty, none repeated (comparing the
// text without the markup, ignoring case and spaces at the ends) and the correct one among them (SPEC-036 RN-04).
func choiceProblems(prefix string, choices []Choice, correct string) []FieldError {
	var out []FieldError
	if len(choices) < MinChoices || len(choices) > MaxChoices {
		out = append(out, FieldError{prefix + "choices", fmt.Sprintf("must have from %d to %d choices", MinChoices, MaxChoices)})
	}
	texts := map[string]bool{}
	found := false
	for i, ch := range choices {
		at := fmt.Sprintf("%schoices[%d].html", prefix, i)
		if !hasContent(ch.HTML) {
			out = append(out, FieldError{at, "required"})
			continue
		}
		text := strings.ToLower(strings.Join(strings.Fields(html.UnescapeString(tags.ReplaceAllString(ch.HTML, " "))), " "))
		if text != "" && texts[text] {
			out = append(out, FieldError{at, "repeats another choice"})
		}
		texts[text] = true
		found = found || ch.ID == correct
	}
	if correct == "" || !found {
		out = append(out, FieldError{prefix + "correctChoice", "required"})
	}
	return out
}

// ReadChoices reads the alternatives of a single choice question; nil when there are none or they are not in the format of SPEC-036.
func ReadChoices(raw json.RawMessage) []Choice {
	var choices []Choice
	if len(raw) == 0 || json.Unmarshal(raw, &choices) != nil {
		return nil
	}
	return choices
}

// CorrectChoice reads the id of the correct alternative; false when there is none.
func CorrectChoice(answerKey json.RawMessage) (string, bool) {
	var key struct {
		Correct *string `json:"correct"`
	}
	if len(answerKey) == 0 || json.Unmarshal(answerKey, &key) != nil || key.Correct == nil || *key.Correct == "" {
		return "", false
	}
	return *key.Correct, true
}

// LegacyChoiceID is the id the conversion of the initial load gives to the alternative at `index` of a question (SPEC-036 D-04): the
// same as migration 00022, so the load and the migration agree.
func LegacyChoiceID(questionID string, index int) string {
	sum := md5.Sum([]byte(fmt.Sprintf("%s:%d", questionID, index)))
	return hex.EncodeToString(sum[:])[:8]
}

// LegacySingleChoice converts the alternatives of the initial load (plain texts, the correct one by position) to the format of
// SPEC-036, with the same correct alternative.
func LegacySingleChoice(questionID string, texts []string, answerKey json.RawMessage, s *HTMLSanitizer) (json.RawMessage, json.RawMessage, error) {
	choices := make([]Choice, len(texts))
	for i, t := range texts {
		// The same html the initial load used to keep for the text (the filter turns it into safe text).
		choices[i] = Choice{ID: LegacyChoiceID(questionID, i), HTML: s.Sanitize(t)}
	}
	raw, err := marshalNoEscape(choices)
	if err != nil {
		return nil, nil, err
	}
	var key struct {
		Correct *int `json:"correct"`
	}
	if len(answerKey) == 0 || json.Unmarshal(answerKey, &key) != nil || key.Correct == nil {
		return raw, nil, nil
	}
	if *key.Correct < 0 || *key.Correct >= len(choices) {
		return nil, nil, errors.New("the correct choice is out of the list")
	}
	k, err := json.Marshal(choiceKey{Correct: choices[*key.Correct].ID})
	return raw, k, err
}

// singleType is the single choice question (SPEC-036): from 2 to 7 alternatives written in the editor, exactly one correct.
type singleType struct{}

func (singleType) Kind() string       { return KindTheoreticalSingle }
func (singleType) UsesTerminal() bool { return false }

func (singleType) normalize(c *checker, in ExerciseInput, out *NormalizedExercise) {
	if hasValue(in.Solution) {
		c.fail("solution", "a single choice question has no solution in the terminal")
	}
	if hasValue(in.Conditions) {
		c.fail("conditions", "a single choice question has no conditions of finalization")
	}
	if in.HasDependency {
		c.fail("dependsOn", "a single choice question does not depend on another exercise")
	}
	if in.CorrectAnswer != nil {
		c.fail("correctAnswer", "only a true or false question has a correct answer; use correctChoice")
	}
	refuseColumns(c, in, "a single choice question has no columns")
	refuseDiscursive(c, in, "only a descriptive question has an expected answer and a size")
	var choices []Choice
	if err := decodeOptional(in.Choices, &choices); err != nil {
		c.fail("choices", "must be a list of choices")
	}
	choices = checkChoices(c, "", choices, in.CorrectChoice)
	explanation := c.html("explanation", in.Explanation, false)
	if len(c.errs) > 0 {
		return
	}
	if choices == nil {
		choices = []Choice{}
	}
	out.Choices, _ = marshalNoEscape(choices)
	if in.CorrectChoice != nil {
		out.AnswerKey, _ = json.Marshal(choiceKey{Correct: strings.TrimSpace(*in.CorrectChoice)})
	}
	if explanation != "" {
		out.Explanation = &explanation
	}
}

func (singleType) Missing(q Question) []FieldError {
	var missing []FieldError
	if !hasContent(q.Statement) {
		missing = append(missing, FieldError{"statement", "required"})
	}
	correct, _ := CorrectChoice(q.AnswerKey)
	return append(missing, choiceProblems("", ReadChoices(q.Choices), correct)...)
}

func (singleType) Grade(q Question, response json.RawMessage) (ResponseVerdict, error) {
	correct, ok := CorrectChoice(q.AnswerKey)
	if !ok {
		return ResponseVerdict{}, errors.New("the single choice question has no answer key")
	}
	var r struct {
		Choice *string `json:"choice"`
	}
	if err := json.Unmarshal(response, &r); err != nil || r.Choice == nil {
		return ResponseVerdict{}, ErrInvalidResponse
	}
	known := false
	for _, ch := range ReadChoices(q.Choices) {
		known = known || ch.ID == *r.Choice
	}
	if !known {
		return ResponseVerdict{}, ErrInvalidResponse
	}
	key, _ := json.Marshal(correct)
	return ResponseVerdict{Passed: *r.Choice == correct, Correct: key}, nil
}

func (singleType) Revealed(q Question) (string, json.RawMessage) {
	correct, ok := CorrectChoice(q.AnswerKey)
	if !ok {
		return "", nil
	}
	value, _ := json.Marshal(correct)
	return "correctChoice", value
}
