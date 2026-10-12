package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Limits of a matching question (SPEC-037 RN-02, D-01, D-06).
const (
	MinPairs     = 2
	MaxPairs     = 5
	MaxMatchText = 200
)

// MatchItem is one item of a column of a matching question: an opaque id and its plain text (SPEC-037 D-06).
type MatchItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// Columns are the two columns of a matching question, each in the order the teacher made (SPEC-037 D-09).
type Columns struct {
	Left  []MatchItem `json:"left"`
	Right []MatchItem `json:"right"`
}

// MatchPair links an item of the left column to its correct item of the right column, by their ids.
type MatchPair struct {
	Left  string `json:"left"`
	Right string `json:"right"`
}

// matchKey is the answer key of a matching question as answer_key stores it: the correct pairs.
type matchKey struct {
	Pairs []MatchPair `json:"pairs"`
}

// LinkResult is one link of the answer of a student with whether it is right (SPEC-037 RN-06).
type LinkResult struct {
	Left    string `json:"left"`
	Right   string `json:"right"`
	Correct bool   `json:"correct"`
}

// ReadColumns reads the columns of a matching question; false when they are missing or in another format.
func ReadColumns(raw json.RawMessage) (Columns, bool) {
	var cols Columns
	if len(raw) == 0 || json.Unmarshal(raw, &cols) != nil || cols.Left == nil || cols.Right == nil {
		return Columns{}, false
	}
	return cols, true
}

// ReadPairs reads the correct pairs of a matching question; nil when there are none.
func ReadPairs(answerKey json.RawMessage) []MatchPair {
	var key matchKey
	if len(answerKey) == 0 || json.Unmarshal(answerKey, &key) != nil {
		return nil
	}
	return key.Pairs
}

// checkColumn validates one column at `field`: at most 5 items, ids that are letters, digits, - or _ and do not repeat, and texts up to
// 200 characters, trimmed. It returns the set of its ids.
func checkColumn(c *checker, field string, items []MatchItem) map[string]bool {
	ids := map[string]bool{}
	if len(items) > MaxPairs {
		c.fail(field, fmt.Sprintf("must have at most %d items", MaxPairs))
		return ids
	}
	for i := range items {
		at := fmt.Sprintf("%s[%d]", field, i)
		id := strings.TrimSpace(items[i].ID)
		switch {
		case id == "" || len(id) > maxChoiceIDBytes || !choiceID.MatchString(id):
			c.fail(at+".id", "must be letters, digits, - or _, up to 40")
		case ids[id]:
			c.fail(at+".id", "must not repeat")
		}
		ids[id] = true
		items[i].ID = id
		items[i].Text = strings.TrimSpace(items[i].Text)
		if utf8.RuneCountInString(items[i].Text) > MaxMatchText {
			c.fail(at+".text", fmt.Sprintf("must have at most %d characters", MaxMatchText))
		}
	}
	return ids
}

// checkPairs validates the pairs at `field`: each refers to an item of each column, and no item of either column is used twice.
func checkPairs(c *checker, field string, pairs []MatchPair, left, right map[string]bool) {
	usedLeft, usedRight := map[string]bool{}, map[string]bool{}
	for i := range pairs {
		at := fmt.Sprintf("%s[%d]", field, i)
		pairs[i].Left, pairs[i].Right = strings.TrimSpace(pairs[i].Left), strings.TrimSpace(pairs[i].Right)
		switch {
		case !left[pairs[i].Left]:
			c.fail(at+".left", "must be the id of an item of the left column")
		case usedLeft[pairs[i].Left]:
			c.fail(at+".left", "each item of the left column has one pair")
		}
		switch {
		case !right[pairs[i].Right]:
			c.fail(at+".right", "must be the id of an item of the right column")
		case usedRight[pairs[i].Right]:
			c.fail(at+".right", "each item of the right column is the pair of one item")
		}
		usedLeft[pairs[i].Left], usedRight[pairs[i].Right] = true, true
	}
}

// normalizedText compares items: lower case, spaces collapsed.
func normalizedText(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }

// matchingProblems says what the columns and the pairs miss to be published (SPEC-037 RN-04): from 2 to 5 items, the same number in
// both columns, none empty, none repeated in the same column, and one pair for each item of the left column.
func matchingProblems(prefix string, cols Columns, pairs []MatchPair) []FieldError {
	var out []FieldError
	if len(cols.Left) < MinPairs || len(cols.Left) > MaxPairs {
		out = append(out, FieldError{prefix + "left", fmt.Sprintf("must have from %d to %d items", MinPairs, MaxPairs)})
	}
	if len(cols.Right) != len(cols.Left) {
		out = append(out, FieldError{prefix + "right", "must have as many items as the left column"})
	}
	for _, side := range []struct {
		name  string
		items []MatchItem
	}{{"left", cols.Left}, {"right", cols.Right}} {
		seen := map[string]bool{}
		for i, it := range side.items {
			at := fmt.Sprintf("%s%s[%d].text", prefix, side.name, i)
			text := normalizedText(it.Text)
			if text == "" {
				out = append(out, FieldError{at, "required"})
				continue
			}
			if seen[text] {
				out = append(out, FieldError{at, "repeats another item"})
			}
			seen[text] = true
		}
	}
	paired := map[string]bool{}
	for _, p := range pairs {
		paired[p.Left] = true
	}
	complete := len(pairs) == len(cols.Left)
	for _, it := range cols.Left {
		complete = complete && paired[it.ID]
	}
	if !complete {
		out = append(out, FieldError{prefix + "pairs", "each item of the left column needs its pair"})
	}
	return out
}

// normalizeMatching checks the columns and the pairs at `prefix` (empty for the bank, items[i]. for a card).
func normalizeMatching(c *checker, prefix string, cols Columns, pairs []MatchPair) (Columns, []MatchPair) {
	left := checkColumn(c, prefix+"left", cols.Left)
	right := checkColumn(c, prefix+"right", cols.Right)
	checkPairs(c, prefix+"pairs", pairs, left, right)
	if cols.Left == nil {
		cols.Left = []MatchItem{}
	}
	if cols.Right == nil {
		cols.Right = []MatchItem{}
	}
	return cols, pairs
}

// matchingType is the matching question (SPEC-037): two columns of 2 to 5 items, linked by the pairs the teacher selected.
type matchingType struct{}

func (matchingType) Kind() string       { return KindTheoreticalMatching }
func (matchingType) UsesTerminal() bool { return false }

func (matchingType) normalize(c *checker, in ExerciseInput, out *NormalizedExercise) {
	if hasValue(in.Solution) {
		c.fail("solution", "a matching question has no solution in the terminal")
	}
	if hasValue(in.Conditions) {
		c.fail("conditions", "a matching question has no conditions of finalization")
	}
	if in.HasDependency {
		c.fail("dependsOn", "a matching question does not depend on another exercise")
	}
	if in.CorrectAnswer != nil {
		c.fail("correctAnswer", "only a true or false question has a correct answer; use pairs")
	}
	if hasValue(in.Choices) || in.CorrectChoice != nil {
		c.fail("choices", "a matching question has columns, not choices")
		if in.CorrectChoice != nil {
			c.fail("correctChoice", "a matching question has pairs, not a correct choice")
		}
	}
	refuseDiscursive(c, in, "only a descriptive question has an expected answer and a size")
	var cols Columns
	var pairs []MatchPair
	for field, target := range map[string]any{"left": &cols.Left, "right": &cols.Right, "pairs": &pairs} {
		raw := map[string]json.RawMessage{"left": in.Left, "right": in.Right, "pairs": in.Pairs}[field]
		if err := decodeOptional(raw, target); err != nil {
			c.fail(field, "must be a list")
		}
	}
	cols, pairs = normalizeMatching(c, "", cols, pairs)
	explanation := c.html("explanation", in.Explanation, false)
	if len(c.errs) > 0 {
		return
	}
	out.Choices, _ = marshalNoEscape(cols)
	if len(pairs) > 0 {
		out.AnswerKey, _ = json.Marshal(matchKey{Pairs: pairs})
	}
	if explanation != "" {
		out.Explanation = &explanation
	}
}

func (matchingType) Missing(q Question) []FieldError {
	var missing []FieldError
	if !hasContent(q.Statement) {
		missing = append(missing, FieldError{"statement", "required"})
	}
	cols, _ := ReadColumns(q.Choices)
	return append(missing, matchingProblems("", cols, ReadPairs(q.AnswerKey))...)
}

func (matchingType) Grade(q Question, response json.RawMessage) (ResponseVerdict, error) {
	pairs := ReadPairs(q.AnswerKey)
	cols, ok := ReadColumns(q.Choices)
	if len(pairs) == 0 || !ok {
		return ResponseVerdict{}, errors.New("the matching question has no answer key")
	}
	var r struct {
		Links []MatchPair `json:"links"`
	}
	if err := json.Unmarshal(response, &r); err != nil || len(r.Links) != len(cols.Left) {
		return ResponseVerdict{}, ErrInvalidResponse
	}
	left, right := map[string]bool{}, map[string]bool{}
	for _, it := range cols.Left {
		left[it.ID] = true
	}
	for _, it := range cols.Right {
		right[it.ID] = true
	}
	correct := map[string]string{}
	for _, p := range pairs {
		correct[p.Left] = p.Right
	}
	results := make([]LinkResult, len(r.Links))
	passed := true
	usedLeft, usedRight := map[string]bool{}, map[string]bool{}
	for i, l := range r.Links {
		if !left[l.Left] || !right[l.Right] || usedLeft[l.Left] || usedRight[l.Right] {
			return ResponseVerdict{}, ErrInvalidResponse
		}
		usedLeft[l.Left], usedRight[l.Right] = true, true
		results[i] = LinkResult{Left: l.Left, Right: l.Right, Correct: correct[l.Left] == l.Right}
		passed = passed && results[i].Correct
	}
	key, _ := json.Marshal(pairs)
	details, _ := json.Marshal(results)
	return ResponseVerdict{Passed: passed, Correct: key, Details: details}, nil
}

func (matchingType) Revealed(q Question) (string, json.RawMessage) {
	pairs := ReadPairs(q.AnswerKey)
	if len(pairs) == 0 {
		return "", nil
	}
	value, _ := json.Marshal(pairs)
	return "pairs", value
}
