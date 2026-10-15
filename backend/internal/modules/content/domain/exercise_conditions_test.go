package domain

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-065 section 3.1 (Conferência): the conditions of finalization of an exercise of a block, as the teacher edits and the content
// stores them (the list under "conditions" of an item of the block EXERCISES), are translated into the catalog the server grades with, by one
// public function: the same translation that the module bank uses (SPEC-023 D-05).
func TestCatalogFromConditions_TranslatesTheListOfTheBlock(t *testing.T) {
	raw := json.RawMessage(`[
		{"kind":"DIR_EXISTS","path":"/home/ana/financeiro"},
		{"kind":"FILE_CONTENT","path":"/home/ana/nota.txt","match":"contains","content":"oi"},
		{"kind":"OWNER","path":"/home/ana","owner":"ana","group":"dev"},
		{"kind":"USER_EXISTS","name":"ana"},
		{"kind":"PROCESS_ENDED_BY","name":"yes","signal":15}
	]`)
	got, err := CatalogFromConditions(raw)
	require.NoError(t, err)
	types := make([]ConditionType, len(got))
	for i, c := range got {
		types[i] = c.Type
	}
	assert.Equal(t, []ConditionType{CondDirectoryExists, CondContentContains, CondOwner, CondGroupOwner, CondUserExists, CondProcessEndedBy}, types,
		"an owner with a group is two conditions of the catalog")
	assert.Equal(t, "oi", got[1].Value)
	assert.Equal(t, "dev", *got[3].Group)
	assert.Equal(t, 15, *got[5].Signal)
	assert.NoError(t, ValidateConditions(got), "what comes out is valid for the server")
}

// Covers SPEC-065 section 3.1 (Conferência): the catalog grades the machine like the conditions of the exercise say, whatever the way the
// student got there.
func TestCatalogFromConditions_GradesTheMachine(t *testing.T) {
	cond, err := CatalogFromConditions(json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/srv/x"},{"kind":"FILE_CONTENT","path":"/srv/x/a","match":"equals","content":"ok"}]`))
	require.NoError(t, err)
	content := "ok"
	solved := &Machine{Root: Node{Type: NodeDirectory, Children: []Node{{Name: "srv", Type: NodeDirectory, Children: []Node{
		{Name: "x", Type: NodeDirectory, Children: []Node{{Name: "a", Type: "arquivo", Content: &content}}}}}}}}
	verdict, err := Grade(solved, cond)
	require.NoError(t, err)
	assert.True(t, verdict.Passed)

	verdict, err = Grade(&Machine{Root: Node{Type: NodeDirectory}}, cond)
	require.NoError(t, err)
	assert.False(t, verdict.Passed)
}

// Covers SPEC-065 section 3.1 (live:exercise:start): an exercise with no condition has nothing to grade, and the caller refuses to start it:
// nothing, null and an empty list are no conditions, and it is not an error to ask.
func TestCatalogFromConditions_NoConditions(t *testing.T) {
	for _, raw := range []json.RawMessage{nil, json.RawMessage(``), json.RawMessage(`null`), json.RawMessage(`[]`), json.RawMessage(` [ ] `)} {
		got, err := CatalogFromConditions(raw)
		assert.NoError(t, err, "%q", raw)
		assert.Empty(t, got, "%q", raw)
	}
}

// Covers SPEC-065 section 3.1: a list that cannot be graded is an error, so that an exercise graded on less than the teacher wrote is never
// started: something that is not a list, a condition of a kind that does not exist (it would be left out and make the exercise easier) and
// a condition that lacks what its kind needs.
func TestCatalogFromConditions_RefusesWhatCannotBeGraded(t *testing.T) {
	for name, raw := range map[string]string{
		"an object":                    `{"kind":"DIR_EXISTS","path":"/a"}`,
		"a string":                     `"DIR_EXISTS"`,
		"not json":                     `[{`,
		"an unknown kind":              `[{"kind":"TELEPORT","path":"/a"}]`,
		"an unknown one among known":   `[{"kind":"DIR_EXISTS","path":"/a"},{"kind":"TELEPORT","path":"/b"}]`,
		"an empty kind":                `[{"path":"/a"}]`,
		"a condition with no path":     `[{"kind":"DIR_EXISTS"}]`,
		"a mode that is not octal":     `[{"kind":"MODE","path":"/a","mode":"rwx"}]`,
		"a process with a bad name":    `[{"kind":"PROCESS_RUNNING","name":"a b"}]`,
		"a condition that is a number": `[3]`,
	} {
		got, err := CatalogFromConditions(json.RawMessage(raw))
		assert.ErrorIs(t, err, ErrInvalidConditions, name)
		assert.Empty(t, got, name)
	}
}
