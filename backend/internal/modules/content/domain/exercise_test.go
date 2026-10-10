package domain

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func input(overrides func(*ExerciseInput)) ExerciseInput {
	in := ExerciseInput{
		Title:      " Criar a pasta ",
		Difficulty: "EASY",
		Statement:  "<p>Crie a pasta <script>x</script><b>financeiro</b></p>",
		Hints:      json.RawMessage(`[{"text":" Use o mkdir ","command":"mkdir /srv/x"}]`),
		Solution:   json.RawMessage(`{"steps":[{"command":"mkdir /srv/x"}]}`),
		Conditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/srv/x"}]`),
	}
	if overrides != nil {
		overrides(&in)
	}
	return in
}

func fields(t *testing.T, err error) []string {
	t.Helper()
	var perr *PayloadError
	require.True(t, errors.As(err, &perr), "want a PayloadError, got %v", err)
	out := make([]string, len(perr.Fields))
	for i, f := range perr.Fields {
		out[i] = f.Field
	}
	return out
}

// Covers SPEC-023 RN-05: an exercise of the module is checked with the rules of an exercise of a card.
func TestNormalizeExercise(t *testing.T) {
	s := NewHTMLSanitizer()

	t.Run("trims and filters what it stores, and keeps the conditions in both forms", func(t *testing.T) {
		out, err := NormalizeExercise(input(nil), s)
		require.NoError(t, err)
		assert.Equal(t, "Criar a pasta", out.Title)
		assert.NotContains(t, out.Statement, "script")
		assert.JSONEq(t, `[{"text":"Use o mkdir","command":"mkdir /srv/x"}]`, string(out.Hints))
		assert.JSONEq(t, `{"steps":[{"command":"mkdir /srv/x"}]}`, string(out.Solution))
		assert.JSONEq(t, `[{"kind":"DIR_EXISTS","path":"/srv/x"}]`, string(out.EndConditions))
		require.Len(t, out.Catalog, 1)
		assert.Equal(t, CondDirectoryExists, out.Catalog[0].Type)
	})

	t.Run("accepts an exercise with nothing but a title and a level, as a draft", func(t *testing.T) {
		out, err := NormalizeExercise(ExerciseInput{Title: "Rascunho", Difficulty: "HARD"}, s)
		require.NoError(t, err)
		assert.JSONEq(t, `[]`, string(out.Hints))
		assert.JSONEq(t, `[]`, string(out.EndConditions))
		assert.Nil(t, out.Solution)
		assert.Empty(t, out.Catalog)
	})

	t.Run("names every field that is wrong", func(t *testing.T) {
		_, err := NormalizeExercise(input(func(in *ExerciseInput) {
			in.Title = "  "
			in.Difficulty = "IMPOSSIBLE"
			in.Hints = json.RawMessage(`[{"text":""}]`)
			in.Solution = json.RawMessage(`{"steps":[{"command":""}]}`)
			in.Conditions = json.RawMessage(`[{"kind":"DIR_EXISTS","path":"relative"},{"kind":"MODE","path":"/a","mode":"888"}]`)
		}), s)
		assert.ElementsMatch(t, []string{"title", "difficulty", "hints[0].text", "solution.steps[0].command", "conditions[0].path", "conditions[1].mode"}, fields(t, err))
	})

	t.Run("refuses a list of tips or conditions that is not a list, and too many tips", func(t *testing.T) {
		_, err := NormalizeExercise(input(func(in *ExerciseInput) {
			in.Hints = json.RawMessage(`"x"`)
			in.Conditions = json.RawMessage(`{"a":1}`)
		}), s)
		assert.ElementsMatch(t, []string{"hints", "conditions"}, fields(t, err))

		many := make([]map[string]string, MaxExerciseHint+1)
		for i := range many {
			many[i] = map[string]string{"text": "t"}
		}
		raw, _ := json.Marshal(many)
		_, err = NormalizeExercise(input(func(in *ExerciseInput) { in.Hints = raw }), s)
		assert.Equal(t, []string{"hints"}, fields(t, err))
	})
}

// Covers SPEC-023 D-05: the conditions the teacher edits are translated to the catalog the server grades with.
func TestCatalogFromEnd(t *testing.T) {
	list := []exerciseCondition{
		{Kind: "DIR_EXISTS", Path: "/d"},
		{Kind: "FILE_EXISTS", Path: "/f"},
		{Kind: "PATH_ABSENT", Path: "/gone"},
		{Kind: "FILE_CONTENT", Path: "/f", Match: "equals", Content: "oi\n"},
		{Kind: "FILE_CONTENT", Path: "/f", Match: "contains", Content: "oi"},
		{Kind: "MODE", Path: "/f", Mode: "640"},
		{Kind: "OWNER", Path: "/f", Owner: "ana", Group: "dev"},
		{Kind: "OWNER", Path: "/g", Owner: "bia"},
		{Kind: "LINK", Path: "/l", Target: "/f"},
		{Kind: "USER_EXISTS", Name: "ana"},
		{Kind: "GROUP_EXISTS", Name: "dev"},
		{Kind: "USER_IN_GROUP", User: "ana", Name: "dev"},
	}
	got := catalogFromEnd(list)
	types := make([]ConditionType, len(got))
	for i, c := range got {
		types[i] = c.Type
	}
	assert.Equal(t, []ConditionType{CondDirectoryExists, CondFileExists, CondPathAbsent, CondContentEquals, CondContentContains, CondPermissionMode,
		CondOwner, CondGroupOwner, CondOwner, CondSymlink, CondUserExists, CondGroupExists, CondUserInGroup}, types)
	require.NoError(t, ValidateConditions(got), "every translated condition is valid for the server")
	assert.Equal(t, "oi\n", got[3].Value)
	assert.Equal(t, "dev", *got[7].Group)
	assert.Equal(t, "/f", *got[9].Target) // the link
}

// Covers SPEC-023 CA-06: what the teacher defines as the end of the exercise is what the server grades.
func TestCatalogFromEnd_GradesTheMachine(t *testing.T) {
	cond := catalogFromEnd([]exerciseCondition{{Kind: "DIR_EXISTS", Path: "/home/ricardo/financeiro"}, {Kind: "USER_EXISTS", Name: "ricardo"}})
	machine := &Machine{
		Root: Node{Name: "", Type: NodeDirectory, Children: []Node{{Name: "home", Type: NodeDirectory, Children: []Node{{Name: "ricardo", Type: NodeDirectory, Children: []Node{{Name: "financeiro", Type: NodeDirectory}}}}}}},
		Accounts: Accounts{Users: []Account{{Name: "ricardo", UID: 1000}}},
	}
	verdict, err := Grade(machine, cond)
	require.NoError(t, err)
	assert.True(t, verdict.Passed)
}
