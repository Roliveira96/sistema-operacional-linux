package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func intPtr(v int) *int { return &v }

func discursiveInput() ExerciseInput {
	return ExerciseInput{
		Kind: KindDiscursive, Title: "Permissions", Difficulty: "MEDIUM", Statement: "<p>Explain what <code>chmod 750</code> does.</p>",
		ExpectedAnswer: "<p>Owner rwx, group r-x, others nothing.</p>", MaxLength: intPtr(1000),
	}
}

// Covers SPEC-039 RN-01, D-03 and D-05: the descriptive question keeps the correct answer and the size the teacher chose.
func TestNormalizeDiscursive(t *testing.T) {
	_, ok := TypeOf(KindDiscursive)
	require.True(t, ok, "the bank accepts the descriptive kind")
	assert.False(t, UsesTerminal(KindDiscursive))

	out, err := NormalizeExercise(discursiveInput(), NewHTMLSanitizer())
	require.NoError(t, err)
	assert.JSONEq(t, `{"expectedAnswer":"<p>Owner rwx, group r-x, others nothing.</p>","maxLength":1000}`, string(out.AnswerKey))

	bare := discursiveInput()
	bare.ExpectedAnswer, bare.MaxLength = "", nil
	out, err = NormalizeExercise(bare, NewHTMLSanitizer())
	require.NoError(t, err)
	assert.JSONEq(t, `{"maxLength":2000}`, string(out.AnswerKey), "2000 is the default size")
}

// Covers SPEC-039 RN-01: the size is one of the list, and the fields of the other kinds are refused.
func TestNormalizeDiscursiveRefusals(t *testing.T) {
	in := discursiveInput()
	in.MaxLength = intPtr(1234)
	assert.Contains(t, fields(t, err2(NormalizeExercise(in, NewHTMLSanitizer()))), "maxLength")

	yes := true
	in = discursiveInput()
	in.Solution, in.Conditions, in.HasDependency, in.CorrectAnswer, in.CorrectChoice = json.RawMessage(`{"steps":[{"command":"ls"}]}`), json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`), true, &yes, strPtr("a")
	in.Choices, in.Left = json.RawMessage(`[{"html":"a"}]`), json.RawMessage(`[{"id":"l","text":"a"}]`)
	got := fields(t, err2(NormalizeExercise(in, NewHTMLSanitizer())))
	for _, f := range []string{"solution", "conditions", "dependsOn", "correctAnswer", "choices", "left"} {
		assert.Contains(t, got, f)
	}
	for _, kind := range []string{KindPractical, KindTheoreticalBoolean, KindTheoreticalSingle, KindTheoreticalMatching} {
		_, err := NormalizeExercise(ExerciseInput{Kind: kind, Title: "x", Difficulty: "EASY", ExpectedAnswer: "<p>x</p>", MaxLength: intPtr(500)}, NewHTMLSanitizer())
		got = fields(t, err)
		assert.Contains(t, got, "expectedAnswer", kind)
		assert.Contains(t, got, "maxLength", kind)
	}
}

// Covers SPEC-039 RN-02: publishing needs a description; the correct answer is optional.
func TestDiscursiveMissing(t *testing.T) {
	d, _ := TypeOf(KindDiscursive)
	assert.Equal(t, []FieldError{{"statement", "required"}}, d.Missing(Question{Statement: "<p> </p>"}))
	assert.Empty(t, d.Missing(Question{Statement: "<p>Explain.</p>"}))
}

// Covers SPEC-039 RN-03 and D-01: the answer keeps only text and commands, within the size; it is never graded on its own.
func TestGradeDiscursive(t *testing.T) {
	d, _ := TypeOf(KindDiscursive)
	q := Question{AnswerKey: json.RawMessage(`{"expectedAnswer":"<p>rwx</p>","maxLength":500}`)}

	v, err := d.Grade(q, json.RawMessage(`{"html":"<p>It gives <b>rwx</b> to the owner: <code>chmod 750 f</code></p><pre>ls -l f</pre><img src=\"https://x/a.png\"><script>x()</script>"}`))
	require.NoError(t, err)
	assert.True(t, v.Pending, "a descriptive answer waits for the teacher")
	assert.False(t, v.Passed)
	assert.JSONEq(t, `{"html":"<p>It gives rwx to the owner: <code>chmod 750 f</code></p><pre>ls -l f</pre>"}`, string(v.Stored))

	for _, bad := range []string{`{"html":"<p>  </p>"}`, `{}`, `nope`, `{"html":"` + strings.Repeat("a", 501) + `"}`} {
		_, err = d.Grade(q, json.RawMessage(bad))
		assert.ErrorIs(t, err, ErrInvalidResponse, bad)
	}
	_, err = d.Grade(Question{}, json.RawMessage(`{"html":"`+strings.Repeat("a", 2000)+`"}`))
	assert.NoError(t, err, "without a size the default 2000 applies")

	field, value := d.Revealed(q)
	assert.Equal(t, "expectedAnswer", field)
	assert.JSONEq(t, `"<p>rwx</p>"`, string(value))
	field, _ = d.Revealed(Question{AnswerKey: json.RawMessage(`{"maxLength":500}`)})
	assert.Empty(t, field, "nothing to reveal without a correct answer")
}

// Covers SPEC-039 CA-09 (domain): the grade is one of the five bands.
func TestValidScore(t *testing.T) {
	for _, ok := range []int{0, 25, 50, 75, 100} {
		assert.True(t, ValidScore(ok), ok)
	}
	for _, bad := range []int{-25, 10, 60, 101} {
		assert.False(t, ValidScore(bad), bad)
	}
	assert.Equal(t, []int{0, 25, 50, 75, 100}, ScoreBands)
}

// Covers SPEC-039 D-09: there is no descriptive item in the exercises of a card.
func TestCardRefusesDiscursive(t *testing.T) {
	_, err := NormalizePayload(BlockExercises, json.RawMessage(`{"items":[{"kind":"DISCURSIVE","title":"x","difficulty":"EASY"}]}`), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "items[0].kind")
}

// Covers SPEC-039 RN-04: the correction reads the HTML of the stored answer.
func TestAnswerHTML(t *testing.T) {
	assert.Equal(t, "<p>rwx</p>", AnswerHTML(json.RawMessage(`{"html":"<p>rwx</p>"}`)))
	assert.Empty(t, AnswerHTML(nil))
	assert.Empty(t, AnswerHTML(json.RawMessage(`true`)))
}
