package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func strPtr(s string) *string { return &s }

func singleInput(choices string, correct *string) ExerciseInput {
	return ExerciseInput{
		Kind: KindTheoreticalSingle, Title: "chmod", Difficulty: "EASY", Statement: "<p>Which command changes permissions?</p>",
		Choices: json.RawMessage(choices), CorrectChoice: correct, Explanation: "<p>chmod changes the mode.</p>",
	}
}

// Covers SPEC-036 RN-02, RN-03, D-01, D-02 and CA-02: the alternatives are kept with an id and filtered html, the answer key points to
// the id, and a choice without id gets one.
func TestNormalizeSingleChoice(t *testing.T) {
	out, err := NormalizeExercise(singleInput(`[{"id":"a","html":"<p><code>chmod</code><script>x()</script></p>"},{"html":"<p>chown</p>"}]`, strPtr("a")), NewHTMLSanitizer())
	require.NoError(t, err)
	assert.Equal(t, KindTheoreticalSingle, out.Kind)
	choices := ReadChoices(out.Choices)
	require.Len(t, choices, 2)
	assert.Equal(t, "a", choices[0].ID)
	assert.Equal(t, "<p><code>chmod</code></p>", choices[0].HTML)
	assert.Regexp(t, `^[0-9a-f]{8}$`, choices[1].ID, "a choice without id gets an opaque one")
	assert.JSONEq(t, `{"correct":"a"}`, string(out.AnswerKey))
	assert.True(t, out.ShuffleChoices, "shuffling is the default (D-07)")
	require.NotNil(t, out.Explanation)

	keep := false
	in := singleInput(`[{"id":"a","html":"x"},{"id":"b","html":"y"}]`, nil)
	in.ShuffleChoices = &keep
	out, err = NormalizeExercise(in, NewHTMLSanitizer())
	require.NoError(t, err)
	assert.False(t, out.ShuffleChoices)
	assert.Nil(t, out.AnswerKey, "a draft may miss the correct choice")
}

// Covers SPEC-036 CA-03 and CA-08 (domain): limits of the list, ids and the fields of the other kinds.
func TestNormalizeSingleChoiceRefusals(t *testing.T) {
	eight := make([]string, 8)
	for i := range eight {
		eight[i] = `{"html":"c` + string(rune('a'+i)) + `"}`
	}
	_, err := NormalizeExercise(singleInput("["+strings.Join(eight, ",")+"]", nil), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "choices")

	_, err = NormalizeExercise(singleInput(`[{"id":"a","html":"x"}]`, nil), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "choices", "one choice is not enough")

	_, err = NormalizeExercise(singleInput(`[{"id":"a","html":"x"},{"id":"a","html":"y"},{"id":"bad id","html":"z"}]`, strPtr("zz")), NewHTMLSanitizer())
	got := fields(t, err)
	assert.Contains(t, got, "choices[1].id")
	assert.Contains(t, got, "choices[2].id")
	assert.Contains(t, got, "correctChoice")

	long := `[{"id":"a","html":"` + strings.Repeat("x", MaxChoiceHTML+1) + `"},{"id":"b","html":"y"}]`
	_, err = NormalizeExercise(singleInput(long, nil), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "choices[0].html")

	_, err = NormalizeExercise(singleInput(`"x"`, nil), NewHTMLSanitizer())
	assert.Contains(t, fields(t, err), "choices")

	yes := true
	in := singleInput(`[{"id":"a","html":"x"},{"id":"b","html":"y"}]`, strPtr("a"))
	in.Solution, in.Conditions, in.HasDependency, in.CorrectAnswer = json.RawMessage(`{"steps":[{"command":"ls"}]}`), json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`), true, &yes
	got = fields(t, err2(NormalizeExercise(in, NewHTMLSanitizer())))
	for _, f := range []string{"solution", "conditions", "dependsOn", "correctAnswer"} {
		assert.Contains(t, got, f)
	}

	// The other kinds refuse the choices.
	for _, kind := range []string{KindPractical, KindTheoreticalBoolean} {
		_, err = NormalizeExercise(ExerciseInput{Kind: kind, Title: "x", Difficulty: "EASY", Choices: json.RawMessage(`[{"html":"a"}]`), CorrectChoice: strPtr("a")}, NewHTMLSanitizer())
		got = fields(t, err)
		assert.Contains(t, got, "choices", kind)
		assert.Contains(t, got, "correctChoice", kind)
	}
}

func err2(_ NormalizedExercise, err error) error { return err }

// Covers SPEC-036 RN-04 and CA-04: what it needs to be published.
func TestSingleChoiceMissing(t *testing.T) {
	single, _ := TypeOf(KindTheoreticalSingle)
	ok := Question{Statement: "<p>?</p>", Choices: json.RawMessage(`[{"id":"a","html":"<p>chmod</p>"},{"id":"b","html":"<img src=\"https://x/a.avif\" alt=\"a\">"}]`), AnswerKey: json.RawMessage(`{"correct":"b"}`)}
	assert.Empty(t, single.Missing(ok), "an image alone is an alternative")

	missing := single.Missing(Question{Statement: "", Choices: json.RawMessage(`[{"id":"a","html":"<p> Chmod </p>"},{"id":"b","html":"<b>chmod</b>"},{"id":"c","html":"<p></p>"}]`)})
	assert.ElementsMatch(t, []FieldError{
		{"statement", "required"},
		{"choices[1].html", "repeats another choice"},
		{"choices[2].html", "required"},
		{"correctChoice", "required"},
	}, missing)

	missing = single.Missing(Question{Statement: "<p>?</p>", Choices: json.RawMessage(`[{"id":"a","html":"x"}]`), AnswerKey: json.RawMessage(`{"correct":"zz"}`)})
	assert.ElementsMatch(t, []FieldError{{"choices", "must have from 2 to 7 choices"}, {"correctChoice", "required"}}, missing)
}

// Covers SPEC-036 RN-05 and CA-08 (domain): grading by id, and the answer key revealed after it.
func TestGradeSingleChoice(t *testing.T) {
	single, _ := TypeOf(KindTheoreticalSingle)
	q := Question{Choices: json.RawMessage(`[{"id":"a","html":"x"},{"id":"b","html":"y"}]`), AnswerKey: json.RawMessage(`{"correct":"b"}`)}

	v, err := single.Grade(q, json.RawMessage(`{"choice":"b"}`))
	require.NoError(t, err)
	assert.True(t, v.Passed)
	assert.JSONEq(t, `"b"`, string(v.Correct))
	v, err = single.Grade(q, json.RawMessage(`{"choice":"a"}`))
	require.NoError(t, err)
	assert.False(t, v.Passed)

	for _, bad := range []string{`{"choice":"zz"}`, `{}`, `{"value":true}`, `nope`} {
		_, err = single.Grade(q, json.RawMessage(bad))
		assert.ErrorIs(t, err, ErrInvalidResponse, bad)
	}
	_, err = single.Grade(Question{Choices: q.Choices}, json.RawMessage(`{"choice":"a"}`))
	assert.Error(t, err)

	field, value := single.Revealed(q)
	assert.Equal(t, "correctChoice", field)
	assert.JSONEq(t, `"b"`, string(value))
	field, _ = single.Revealed(Question{})
	assert.Empty(t, field)

	boolean, _ := TypeOf(KindTheoreticalBoolean)
	field, value = boolean.Revealed(Question{AnswerKey: json.RawMessage(`{"correct":false}`)})
	assert.Equal(t, "correctAnswer", field)
	assert.JSONEq(t, "false", string(value))
	field, _ = boolean.Revealed(Question{})
	assert.Empty(t, field)
	practical, _ := TypeOf(KindPractical)
	field, _ = practical.Revealed(Question{})
	assert.Empty(t, field)
}

// Covers SPEC-036 D-04 and CA-14 (domain): the conversion of the initial load keeps the same correct alternative, with the ids of the
// migration.
func TestLegacySingleChoice(t *testing.T) {
	choices, key, err := LegacySingleChoice("q-1", []string{"Bash", "Kernel & Linux"}, json.RawMessage(`{"correct":1}`), NewHTMLSanitizer())
	require.NoError(t, err)
	list := ReadChoices(choices)
	require.Len(t, list, 2)
	assert.Equal(t, LegacyChoiceID("q-1", 0), list[0].ID)
	assert.Equal(t, "Kernel &amp; Linux", list[1].HTML, "the same safe text the initial load kept")
	correct, ok := CorrectChoice(key)
	assert.True(t, ok)
	assert.Equal(t, list[1].ID, correct)
	assert.Len(t, LegacyChoiceID("q-1", 0), 8)
	assert.NotEqual(t, LegacyChoiceID("q-1", 0), LegacyChoiceID("q-1", 1))

	_, key, err = LegacySingleChoice("q", []string{"a", "b"}, nil, NewHTMLSanitizer())
	require.NoError(t, err)
	assert.Nil(t, key)
	_, _, err = LegacySingleChoice("q", []string{"a", "b"}, json.RawMessage(`{"correct":5}`), NewHTMLSanitizer())
	assert.Error(t, err)

	assert.Nil(t, ReadChoices(json.RawMessage(`["a"]`)), "the old format is not read as choices")
	_, ok = CorrectChoice(json.RawMessage(`{"correct":1}`))
	assert.False(t, ok)
}

// Covers SPEC-036 RN-09: the single choice item of the exercises of a card is saved only complete.
func TestCardSingleChoiceItem(t *testing.T) {
	s := NewHTMLSanitizer()
	out, err := NormalizePayload(BlockExercises, json.RawMessage(`{"items":[
        {"kind":"THEORETICAL_SINGLE","title":"chmod","difficulty":"EASY","choices":[{"id":"a","html":"chmod"},{"html":"chown"}],"correctChoice":"a","shuffleChoices":false}
    ]}`), s)
	require.NoError(t, err)
	var p exercisesPayload
	require.NoError(t, json.Unmarshal(out, &p))
	require.Len(t, p.Items[0].Choices, 2)
	assert.NotEmpty(t, p.Items[0].Choices[1].ID)
	require.NotNil(t, p.Items[0].ShuffleChoices)
	assert.False(t, *p.Items[0].ShuffleChoices)

	_, err = NormalizePayload(BlockExercises, json.RawMessage(`{"items":[
        {"kind":"THEORETICAL_SINGLE","title":"x","difficulty":"EASY","choices":[{"id":"a","html":"x"},{"id":"b","html":"X"}],"correctAnswer":true,"solution":{"steps":[{"command":"ls"}]},"conditions":[{"kind":"DIR_EXISTS","path":"/a"}]},
        {"title":"p","difficulty":"EASY","choices":[{"html":"a"}]}
    ]}`), s)
	got := fields(t, err)
	for _, f := range []string{"items[0].solution", "items[0].conditions", "items[0].correctAnswer", "items[0].choices[1].html", "items[0].correctChoice", "items[1].choices"} {
		assert.Contains(t, got, f)
	}
}
