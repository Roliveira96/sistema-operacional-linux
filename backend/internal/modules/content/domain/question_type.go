package domain

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// ErrNotGradedByResponse means the kind is graded by another way (a practical question is graded by the machine of the student).
var ErrNotGradedByResponse = errors.New("this kind of question is not graded by a response")

// ErrInvalidResponse means the response of the student is not the one the kind of question expects.
var ErrInvalidResponse = errors.New("the response does not match the kind of question")

// ResponseVerdict is the result of grading the response of a student (SPEC-035 RN-06).
type ResponseVerdict struct {
	Passed bool
	// Correct is the answer key the student may see after answering, in the form of the kind (a boolean for true or false).
	Correct json.RawMessage
	// Details is the result of each part of the answer, when the kind has parts (each link of a matching question, SPEC-037 RN-06).
	Details json.RawMessage
}

// QuestionType is the contract every kind of question of the bank implements (SPEC-035 RN-02): it validates what the teacher
// writes, says what is missing to publish and grades a response. A new kind is a new implementation registered in questionTypes.
type QuestionType interface {
	// Kind is the value of questions.kind.
	Kind() string
	// UsesTerminal tells whether the student solves it in the terminal, with a machine, a solution and conditions.
	UsesTerminal() bool
	// normalize checks and trims the fields of the kind; the fields every kind shares are already checked.
	normalize(c *checker, in ExerciseInput, out *NormalizedExercise)
	// Missing lists what the question still needs to be published (SPEC-023 A-03, SPEC-035 RN-04).
	Missing(q Question) []FieldError
	// Grade checks the response of a student against the answer key.
	Grade(q Question, response json.RawMessage) (ResponseVerdict, error)
	// Revealed is the answer key the student may see after answering, and the name of the field it goes in; empty for a kind that
	// reveals nothing (SPEC-035 RN-06, SPEC-036 RN-05).
	Revealed(q Question) (field string, value json.RawMessage)
}

var questionTypes = map[string]QuestionType{
	KindPractical:           practicalType{},
	KindTheoreticalBoolean:  booleanType{},
	KindTheoreticalSingle:   singleType{},
	KindTheoreticalMatching: matchingType{},
}

// TypeOf returns the contract of a kind the bank accepts (SPEC-035 RN-01).
func TypeOf(kind string) (QuestionType, bool) {
	t, ok := questionTypes[kind]
	return t, ok
}

// BankKinds are the kinds of question the bank of the module holds, in a stable order.
func BankKinds() []string {
	out := make([]string, 0, len(questionTypes))
	for k := range questionTypes {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// UsesTerminal tells whether a question of the kind is solved in the terminal; an unknown kind is not.
func UsesTerminal(kind string) bool {
	t, ok := TypeOf(kind)
	return ok && t.UsesTerminal()
}

// practicalType is the Linux command question (SPEC-022, SPEC-023): solved in the terminal and graded by the machine.
type practicalType struct{}

func (practicalType) Kind() string       { return KindPractical }
func (practicalType) UsesTerminal() bool { return true }

func (practicalType) normalize(c *checker, in ExerciseInput, out *NormalizedExercise) {
	if in.CorrectAnswer != nil {
		c.fail("correctAnswer", "only a true or false question has a correct answer")
	}
	refuseChoices(c, in, "a Linux command question has no choices")
	if strings.TrimSpace(in.Explanation) != "" {
		c.fail("explanation", "only a question without a terminal has a justification")
	}
	var solution *setupPayload
	if err := decodeOptional(in.Solution, &solution); err != nil {
		c.fail("solution", "must be a snapshot")
	} else if solution != nil {
		c.setup("solution", solution)
	}
	var conditions []exerciseCondition
	if err := decodeOptional(in.Conditions, &conditions); err != nil {
		c.fail("conditions", "must be a list of conditions")
	}
	c.conditions("conditions", conditions)
	if conditions == nil {
		conditions = []exerciseCondition{}
	}
	if len(c.errs) > 0 {
		return
	}
	if solution != nil {
		out.Solution, _ = marshalNoEscape(solution)
	}
	out.EndConditions, _ = marshalNoEscape(conditions)
	out.Catalog = catalogFromEnd(conditions)
}

func (practicalType) Missing(q Question) []FieldError {
	raw := strings.TrimSpace(string(q.ValidationConditions))
	if raw == "" || raw == "[]" || raw == "null" {
		return []FieldError{{"conditions", "required"}}
	}
	return nil
}

func (practicalType) Grade(Question, json.RawMessage) (ResponseVerdict, error) {
	return ResponseVerdict{}, ErrNotGradedByResponse
}

func (practicalType) Revealed(Question) (string, json.RawMessage) { return "", nil }

// booleanType is the true or false question (SPEC-035): one statement, answered true or false, without a terminal.
type booleanType struct{}

func (booleanType) Kind() string       { return KindTheoreticalBoolean }
func (booleanType) UsesTerminal() bool { return false }

func (booleanType) normalize(c *checker, in ExerciseInput, out *NormalizedExercise) {
	if hasValue(in.Solution) {
		c.fail("solution", "a true or false question has no solution in the terminal")
	}
	if hasValue(in.Conditions) {
		c.fail("conditions", "a true or false question has no conditions of finalization")
	}
	if in.HasDependency {
		c.fail("dependsOn", "a true or false question does not depend on another exercise")
	}
	refuseChoices(c, in, "a true or false question has no choices")
	explanation := c.html("explanation", in.Explanation, false)
	if len(c.errs) > 0 {
		return
	}
	if in.CorrectAnswer != nil {
		out.AnswerKey, _ = json.Marshal(booleanKey{Correct: *in.CorrectAnswer})
	}
	if explanation != "" {
		out.Explanation = &explanation
	}
}

// hasContent tells whether html shows something: text, or at least an image.
func hasContent(html string) bool {
	return strings.TrimSpace(tags.ReplaceAllString(html, "")) != "" || strings.Contains(html, "<img")
}

func (booleanType) Missing(q Question) []FieldError {
	var missing []FieldError
	if !hasContent(q.Statement) {
		missing = append(missing, FieldError{"statement", "required"})
	}
	if _, ok := BooleanAnswer(q.AnswerKey); !ok {
		missing = append(missing, FieldError{"correctAnswer", "required"})
	}
	return missing
}

func (booleanType) Grade(q Question, response json.RawMessage) (ResponseVerdict, error) {
	correct, ok := BooleanAnswer(q.AnswerKey)
	if !ok {
		return ResponseVerdict{}, errors.New("the true or false question has no answer key")
	}
	var r struct {
		Value *bool `json:"value"`
	}
	if err := json.Unmarshal(response, &r); err != nil || r.Value == nil {
		return ResponseVerdict{}, ErrInvalidResponse
	}
	key, _ := json.Marshal(correct)
	return ResponseVerdict{Passed: *r.Value == correct, Correct: key}, nil
}

func (booleanType) Revealed(q Question) (string, json.RawMessage) {
	correct, ok := BooleanAnswer(q.AnswerKey)
	if !ok {
		return "", nil
	}
	value, _ := json.Marshal(correct)
	return "correctAnswer", value
}

// booleanKey is the answer key of a true or false question as answer_key stores it.
type booleanKey struct {
	Correct bool `json:"correct"`
}

// BooleanAnswer reads the correct answer of a true or false question; false when there is none.
func BooleanAnswer(answerKey json.RawMessage) (bool, bool) {
	var key struct {
		Correct *bool `json:"correct"`
	}
	if len(answerKey) == 0 || json.Unmarshal(answerKey, &key) != nil || key.Correct == nil {
		return false, false
	}
	return *key.Correct, true
}

// refuseChoices refuses the fields of a single choice question and of a matching question in a kind that has none.
func refuseChoices(c *checker, in ExerciseInput, reason string) {
	if hasValue(in.Choices) {
		c.fail("choices", reason)
	}
	if in.CorrectChoice != nil {
		c.fail("correctChoice", reason)
	}
	refuseColumns(c, in, reason)
}

// refuseColumns refuses the fields of a matching question in a kind that has none.
func refuseColumns(c *checker, in ExerciseInput, reason string) {
	for field, raw := range map[string]json.RawMessage{"left": in.Left, "right": in.Right, "pairs": in.Pairs} {
		if hasValue(raw) {
			c.fail(field, reason)
		}
	}
}

// hasValue tells whether an optional JSON field came with something: missing, null and an empty list are nothing.
func hasValue(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return s != "" && s != "null" && s != "[]"
}
