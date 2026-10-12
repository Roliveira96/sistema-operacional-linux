package domain

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func boolPtr(v bool) *bool { return &v }

// Covers SPEC-035 RN-01 and RN-02: the bank knows the practical and the true or false kinds, and nothing else.
func TestQuestionTypeRegistry(t *testing.T) {
	assert.Equal(t, []string{KindPractical, KindTheoreticalBoolean}, BankKinds())
	assert.True(t, UsesTerminal(KindPractical))
	assert.False(t, UsesTerminal(KindTheoreticalBoolean))
	assert.False(t, UsesTerminal(KindDiscursive))
	for _, kind := range BankKinds() {
		typ, ok := TypeOf(kind)
		require.True(t, ok)
		assert.Equal(t, kind, typ.Kind())
	}
	_, ok := TypeOf(KindTheoreticalSingle)
	assert.False(t, ok, "the other kinds wait for their own spec")

	_, err := NormalizeExercise(ExerciseInput{Kind: KindDiscursive, Title: "x", Difficulty: "EASY"}, NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "kind")
}

// Covers SPEC-035 RN-03 and CA-02: a true or false question keeps title, level, description, tips, answer and justification.
func TestNormalizeTrueFalse(t *testing.T) {
	out, err := NormalizeExercise(ExerciseInput{
		Kind: KindTheoreticalBoolean, Title: "  rm -r  ", Difficulty: "MEDIUM",
		Statement:     `<p>rm -r removes non-empty directories.</p><script>x()</script>`,
		Hints:         json.RawMessage(`[{"text":"Think of -r"}]`),
		CorrectAnswer: boolPtr(true), Explanation: `<p>It is <b>recursive</b>.</p><img src="javascript:x">`,
		Conditions:    json.RawMessage(`[]`), Solution: json.RawMessage(`null`),
	}, NewHTMLSanitizer())
	require.NoError(t, err)
	assert.Equal(t, KindTheoreticalBoolean, out.Kind)
	assert.Equal(t, "rm -r", out.Title)
	assert.NotContains(t, out.Statement, "script")
	assert.JSONEq(t, `[{"text":"Think of -r"}]`, string(out.Hints))
	assert.JSONEq(t, `{"correct":true}`, string(out.AnswerKey))
	require.NotNil(t, out.Explanation)
	assert.Contains(t, *out.Explanation, "<b>recursive</b>")
	assert.NotContains(t, *out.Explanation, "javascript")
	assert.Nil(t, out.Solution)
	assert.Nil(t, out.EndConditions)
	assert.Nil(t, out.Catalog)

	draft, err := NormalizeExercise(ExerciseInput{Kind: KindTheoreticalBoolean, Title: "draft", Difficulty: "EASY"}, NewHTMLSanitizer())
	require.NoError(t, err, "a draft may still miss the answer")
	assert.Nil(t, draft.AnswerKey)
	assert.Nil(t, draft.Explanation)
}

// Covers SPEC-035 CA-05: what belongs to the terminal is refused in a true or false question, and the other way around.
func TestNormalizeRefusesTheFieldsOfTheOtherKind(t *testing.T) {
	_, err := NormalizeExercise(ExerciseInput{
		Kind: KindTheoreticalBoolean, Title: "x", Difficulty: "EASY", HasDependency: true,
		Solution:   json.RawMessage(`{"steps":[{"command":"ls"}]}`),
		Conditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`),
	}, NewHTMLSanitizer())
	got := fields(t, err)
	assert.Contains(t, got, "solution")
	assert.Contains(t, got, "conditions")
	assert.Contains(t, got, "dependsOn")

	_, err = NormalizeExercise(ExerciseInput{Title: "x", Difficulty: "EASY", CorrectAnswer: boolPtr(false), Explanation: "why"}, NewHTMLSanitizer())
	got = fields(t, err)
	assert.Contains(t, got, "correctAnswer")
	assert.Contains(t, got, "explanation")
}

// The practical kind keeps the rules of SPEC-022 and SPEC-023.
func TestNormalizePracticalStillTranslatesTheConditions(t *testing.T) {
	out, err := NormalizeExercise(ExerciseInput{
		Title: "mkdir", Difficulty: "EASY", Solution: json.RawMessage(`{"steps":[{"command":"mkdir /a"}]}`),
		Conditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`),
	}, NewHTMLSanitizer())
	require.NoError(t, err)
	assert.Equal(t, KindPractical, out.Kind)
	assert.Equal(t, []Condition{{Type: CondDirectoryExists, Path: "/a"}}, out.Catalog)
	assert.NotNil(t, out.Solution)

	_, err = NormalizeExercise(ExerciseInput{Title: "x", Difficulty: "EASY", Solution: json.RawMessage(`"x"`), Conditions: json.RawMessage(`"x"`)}, NewHTMLSanitizer())
	got := fields(t, err)
	assert.Contains(t, got, "solution")
	assert.Contains(t, got, "conditions")
}

// Covers SPEC-035 RN-04 and CA-04: what each kind needs to be published.
func TestMissingToPublish(t *testing.T) {
	boolean, _ := TypeOf(KindTheoreticalBoolean)
	missing := boolean.Missing(Question{Statement: "<p> </p>"})
	assert.ElementsMatch(t, []FieldError{{"statement", "required"}, {"correctAnswer", "required"}}, missing)
	assert.Empty(t, boolean.Missing(Question{Statement: "<p>Yes?</p>", AnswerKey: json.RawMessage(`{"correct":false}`)}))
	assert.Empty(t, boolean.Missing(Question{Statement: `<img src="https://x/a.avif" alt="a">`, AnswerKey: json.RawMessage(`{"correct":true}`)}),
		"an image alone is a description")

	practical, _ := TypeOf(KindPractical)
	for _, raw := range []string{"", "[]", "null"} {
		assert.Equal(t, []FieldError{{"conditions", "required"}}, practical.Missing(Question{ValidationConditions: json.RawMessage(raw)}), raw)
	}
	assert.Empty(t, practical.Missing(Question{ValidationConditions: json.RawMessage(`[{"type":"NODE_EXISTS","path":"/a"}]`)}))
}

// Covers SPEC-035 RN-06 and CA-09: the answer is graded against the key, and the key comes back.
func TestGradeTrueFalse(t *testing.T) {
	boolean, _ := TypeOf(KindTheoreticalBoolean)
	q := Question{AnswerKey: json.RawMessage(`{"correct":false}`)}

	v, err := boolean.Grade(q, json.RawMessage(`{"value":false}`))
	require.NoError(t, err)
	assert.True(t, v.Passed)
	assert.JSONEq(t, "false", string(v.Correct))

	v, err = boolean.Grade(q, json.RawMessage(`{"value":true}`))
	require.NoError(t, err)
	assert.False(t, v.Passed)

	for _, bad := range []string{`{}`, `{"value":"true"}`, `true`, `nope`} {
		_, err = boolean.Grade(q, json.RawMessage(bad))
		assert.ErrorIs(t, err, ErrInvalidResponse, bad)
	}
	_, err = boolean.Grade(Question{}, json.RawMessage(`{"value":true}`))
	assert.Error(t, err, "a question without a key cannot be graded")

	practical, _ := TypeOf(KindPractical)
	_, err = practical.Grade(q, json.RawMessage(`{"value":true}`))
	assert.ErrorIs(t, err, ErrNotGradedByResponse)
}

func TestBooleanAnswer(t *testing.T) {
	for raw, want := range map[string]bool{`{"correct":true}`: true, `{"correct":false}`: false} {
		got, ok := BooleanAnswer(json.RawMessage(raw))
		assert.True(t, ok)
		assert.Equal(t, want, got)
	}
	for _, raw := range []string{"", `{}`, `{"correct":1}`, `[]`} {
		_, ok := BooleanAnswer(json.RawMessage(raw))
		assert.False(t, ok, raw)
	}
}

// Covers SPEC-035 RN-14 and CA-19: the true or false item of the exercises of a card.
func TestCardTrueFalseItem(t *testing.T) {
	s := NewHTMLSanitizer()
	out, err := NormalizePayload(BlockExercises, json.RawMessage(`{"items":[
        {"title":"old","difficulty":"EASY"},
        {"kind":"THEORETICAL_BOOLEAN","title":"tf","difficulty":"HARD","description":"<p>ls lists.</p>","correctAnswer":false,"explanation":"<p>Why<script>x</script></p>"}
    ]}`), s)
	require.NoError(t, err)
	var p exercisesPayload
	require.NoError(t, json.Unmarshal(out, &p))
	assert.Equal(t, "", p.Items[0].Kind, "an item without a kind stays practical")
	assert.Equal(t, KindTheoreticalBoolean, p.Items[1].Kind)
	require.NotNil(t, p.Items[1].CorrectAnswer)
	assert.False(t, *p.Items[1].CorrectAnswer)
	assert.NotContains(t, p.Items[1].Explanation, "script")

	_, err = NormalizePayload(BlockExercises, json.RawMessage(`{"items":[
        {"kind":"THEORETICAL_BOOLEAN","title":"tf","difficulty":"EASY","solution":{"steps":[{"command":"ls"}]},"conditions":[{"kind":"DIR_EXISTS","path":"/a"}]},
        {"title":"p","difficulty":"EASY","correctAnswer":true,"explanation":"x"},
        {"kind":"DISCURSIVE","title":"d","difficulty":"EASY"}
    ]}`), s)
	got := fields(t, err)
	for _, f := range []string{"items[0].correctAnswer", "items[0].solution", "items[0].conditions", "items[1].correctAnswer", "items[1].explanation", "items[2].kind"} {
		assert.Contains(t, got, f)
	}
}
