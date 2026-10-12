package domain

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func matchingInput(left, right, pairs string) ExerciseInput {
	return ExerciseInput{
		Kind: KindTheoreticalMatching, Title: "commands", Difficulty: "EASY", Statement: "<p>Link each command to what it does.</p>",
		Left: json.RawMessage(left), Right: json.RawMessage(right), Pairs: json.RawMessage(pairs), Explanation: "<p>why</p>",
	}
}

const (
	twoLeft  = `[{"id":"l1","text":" chmod "},{"id":"l2","text":"chown"}]`
	twoRight = `[{"id":"r1","text":"changes the owner"},{"id":"r2","text":"changes the mode"}]`
	twoPairs = `[{"left":"l1","right":"r2"},{"left":"l2","right":"r1"}]`
)

// Covers SPEC-037 RN-01 to RN-03, D-09 and D-10: the columns keep the order of the teacher, the pairs she selected are the answer key,
// and shuffling is the default.
func TestNormalizeMatching(t *testing.T) {
	_, ok := TypeOf(KindTheoreticalMatching)
	require.True(t, ok, "the bank accepts the matching kind")
	assert.False(t, UsesTerminal(KindTheoreticalMatching))

	out, err := NormalizeExercise(matchingInput(twoLeft, twoRight, twoPairs), NewHTMLSanitizer())
	require.NoError(t, err)
	cols, ok := ReadColumns(out.Choices)
	require.True(t, ok)
	assert.Equal(t, []MatchItem{{ID: "l1", Text: "chmod"}, {ID: "l2", Text: "chown"}}, cols.Left)
	assert.Equal(t, "r1", cols.Right[0].ID, "the right column keeps the order of the teacher")
	assert.Equal(t, []MatchPair{{Left: "l1", Right: "r2"}, {Left: "l2", Right: "r1"}}, ReadPairs(out.AnswerKey))
	assert.True(t, out.ShuffleChoices)
	require.NotNil(t, out.Explanation)

	draft, err := NormalizeExercise(matchingInput(twoLeft, twoRight, `[]`), NewHTMLSanitizer())
	require.NoError(t, err, "a draft may miss the pairs")
	assert.Nil(t, draft.AnswerKey)
}

// Covers SPEC-037 CA-03 and CA-09 (domain): limits, ids, pairs that do not fit the columns and the fields of the other kinds.
func TestNormalizeMatchingRefusals(t *testing.T) {
	six := `[{"id":"a","text":"1"},{"id":"b","text":"2"},{"id":"c","text":"3"},{"id":"d","text":"4"},{"id":"e","text":"5"},{"id":"f","text":"6"}]`
	_, err := NormalizeExercise(matchingInput(six, six, `[]`), NewHTMLSanitizer())
	got := fields(t, err)
	assert.Contains(t, got, "left")
	assert.Contains(t, got, "right")

	_, err = NormalizeExercise(matchingInput(`[{"id":"l1","text":"x"},{"id":"l1","text":"y"},{"id":"bad id","text":"z"}]`, twoRight, `[]`), NewHTMLSanitizer())
	got = fields(t, err)
	assert.Contains(t, got, "left[1].id")
	assert.Contains(t, got, "left[2].id")

	long := `[{"id":"l1","text":"` + string(make([]byte, 0)) + `x"},{"id":"l2","text":"` + repeat("y", MaxMatchText+1) + `"}]`
	_, err = NormalizeExercise(matchingInput(long, twoRight, `[]`), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "left[1].text")

	_, err = NormalizeExercise(matchingInput(twoLeft, twoRight, `[{"left":"l1","right":"r2"},{"left":"l1","right":"r1"}]`), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "pairs[1].left", "a left item has one pair")
	_, err = NormalizeExercise(matchingInput(twoLeft, twoRight, `[{"left":"l1","right":"r2"},{"left":"l2","right":"r2"}]`), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "pairs[1].right", "a right item is the pair of one left item")
	_, err = NormalizeExercise(matchingInput(twoLeft, twoRight, `[{"left":"zz","right":"r9"}]`), NewHTMLSanitizer())
	got = fields(t, err)
	assert.Contains(t, got, "pairs[0].left")
	assert.Contains(t, got, "pairs[0].right")
	_, err = NormalizeExercise(matchingInput(`"x"`, `"y"`, `"z"`), NewHTMLSanitizer())
	got = fields(t, err)
	for _, f := range []string{"left", "right", "pairs"} {
		assert.Contains(t, got, f)
	}

	yes := true
	in := matchingInput(twoLeft, twoRight, twoPairs)
	in.Solution, in.Conditions, in.HasDependency, in.CorrectAnswer, in.CorrectChoice, in.Choices = json.RawMessage(`{"steps":[{"command":"ls"}]}`), json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`), true, &yes, strPtr("a"), json.RawMessage(`[{"html":"a"}]`)
	_, err = NormalizeExercise(in, NewHTMLSanitizer())
	got = fields(t, err)
	for _, f := range []string{"solution", "conditions", "dependsOn", "correctAnswer", "correctChoice", "choices"} {
		assert.Contains(t, got, f)
	}

	// The other kinds refuse the columns.
	for _, kind := range []string{KindPractical, KindTheoreticalBoolean, KindTheoreticalSingle} {
		_, err = NormalizeExercise(ExerciseInput{Kind: kind, Title: "x", Difficulty: "EASY", Left: json.RawMessage(twoLeft), Right: json.RawMessage(twoRight), Pairs: json.RawMessage(twoPairs)}, NewHTMLSanitizer())
		got = fields(t, err)
		assert.Contains(t, got, "left", kind)
	}
}

func repeat(s string, n int) string {
	out := make([]byte, 0, n)
	for len(out) < n {
		out = append(out, s...)
	}
	return string(out[:n])
}

// Covers SPEC-037 RN-04 and CA-04: what it needs to be published.
func TestMatchingMissing(t *testing.T) {
	matching, _ := TypeOf(KindTheoreticalMatching)
	cols := func(left, right string) json.RawMessage { return json.RawMessage(`{"left":` + left + `,"right":` + right + `}`) }
	ok := Question{Statement: "<p>?</p>", Choices: cols(twoLeft, twoRight), AnswerKey: json.RawMessage(`{"pairs":` + twoPairs + `}`)}
	assert.Empty(t, matching.Missing(ok))

	missing := matching.Missing(Question{Choices: cols(`[{"id":"l1","text":"Chmod"},{"id":"l2","text":"chmod "},{"id":"l3","text":""}]`, twoRight)})
	assert.ElementsMatch(t, []FieldError{
		{"statement", "required"},
		{"right", "must have as many items as the left column"},
		{"left[1].text", "repeats another item"},
		{"left[2].text", "required"},
		{"pairs", "each item of the left column needs its pair"},
	}, missing)

	missing = matching.Missing(Question{Statement: "<p>?</p>", Choices: cols(`[{"id":"l1","text":"a"}]`, `[{"id":"r1","text":"b"}]`), AnswerKey: json.RawMessage(`{"pairs":[{"left":"l1","right":"r1"}]}`)})
	assert.ElementsMatch(t, []FieldError{{"left", "must have from 2 to 5 items"}}, missing)
}

// Covers SPEC-037 RN-06, D-02 and CA-08, CA-09 (domain): every link checked, passed only with all of them right, and the answer key
// revealed after.
func TestGradeMatching(t *testing.T) {
	matching, _ := TypeOf(KindTheoreticalMatching)
	q := Question{Choices: json.RawMessage(`{"left":` + twoLeft + `,"right":` + twoRight + `}`), AnswerKey: json.RawMessage(`{"pairs":` + twoPairs + `}`)}

	v, err := matching.Grade(q, json.RawMessage(`{"links":[{"left":"l2","right":"r1"},{"left":"l1","right":"r2"}]}`))
	require.NoError(t, err)
	assert.True(t, v.Passed)
	assert.JSONEq(t, `[{"left":"l2","right":"r1","correct":true},{"left":"l1","right":"r2","correct":true}]`, string(v.Details))

	v, err = matching.Grade(q, json.RawMessage(`{"links":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"}]}`))
	require.NoError(t, err)
	assert.False(t, v.Passed)
	assert.JSONEq(t, `[{"left":"l1","right":"r1","correct":false},{"left":"l2","right":"r2","correct":false}]`, string(v.Details))
	assert.JSONEq(t, twoPairs, string(v.Correct))

	for _, bad := range []string{
		`{"links":[{"left":"l1","right":"r2"}]}`,
		`{"links":[{"left":"l1","right":"r2"},{"left":"l1","right":"r1"}]}`,
		`{"links":[{"left":"l1","right":"r2"},{"left":"l2","right":"r2"}]}`,
		`{"links":[{"left":"l1","right":"r2"},{"left":"zz","right":"r1"}]}`,
		`{}`, `nope`,
	} {
		_, err = matching.Grade(q, json.RawMessage(bad))
		assert.ErrorIs(t, err, ErrInvalidResponse, bad)
	}
	_, err = matching.Grade(Question{Choices: q.Choices}, json.RawMessage(`{"links":[]}`))
	assert.Error(t, err, "without an answer key it cannot be graded")

	field, value := matching.Revealed(q)
	assert.Equal(t, "pairs", field)
	assert.JSONEq(t, twoPairs, string(value))
	field, _ = matching.Revealed(Question{})
	assert.Empty(t, field)
}

// Covers SPEC-037 RN-09: the matching item of the exercises of a card is saved only complete.
func TestCardMatchingItem(t *testing.T) {
	s := NewHTMLSanitizer()
	out, err := NormalizePayload(BlockExercises, json.RawMessage(`{"items":[
        {"kind":"THEORETICAL_MATCHING","title":"commands","difficulty":"EASY","left":`+twoLeft+`,"right":`+twoRight+`,"pairs":`+twoPairs+`,"shuffleChoices":false}
    ]}`), s)
	require.NoError(t, err)
	var p exercisesPayload
	require.NoError(t, json.Unmarshal(out, &p))
	assert.Equal(t, "chmod", p.Items[0].Left[0].Text)
	assert.Len(t, p.Items[0].Pairs, 2)

	_, err = NormalizePayload(BlockExercises, json.RawMessage(`{"items":[
        {"kind":"THEORETICAL_MATCHING","title":"x","difficulty":"EASY","left":`+twoLeft+`,"right":`+twoRight+`,"pairs":[]},
        {"title":"p","difficulty":"EASY","left":`+twoLeft+`}
    ]}`), s)
	got := fields(t, err)
	assert.Contains(t, got, "items[0].pairs")
	assert.Contains(t, got, "items[1].left")
}
