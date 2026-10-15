package service

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-065 section 3.1 (Conferência): the state of a machine is read for the live exercise by the same function that the practice uses,
// public so that the composition root can give it to the classroom without the classroom importing the practice: a machine of the simulator
// (the format and the version) is read, and what is not one is ErrInvalidSnapshot.
func TestParseMachine_IsPublicForTheLiveExercise(t *testing.T) {
	m, err := ParseMachine(json.RawMessage(solvedMachine))
	require.NoError(t, err)
	assert.Equal(t, "exame-so/maquina", m.Format)
	assert.Equal(t, 1, m.Version)
	assert.Equal(t, "a", m.Root.Children[0].Name)

	for name, raw := range map[string]string{
		"not json":        `{`,
		"a string":        `"pass"`,
		"another kind":    `{"formato":"outro","versao":1}`,
		"another version": `{"formato":"exame-so/maquina","versao":2,"hostname":"h"}`,
		"no format":       `{"versao":1}`,
		"empty":           ``,
	} {
		got, err := ParseMachine(json.RawMessage(raw))
		assert.ErrorIs(t, err, ErrInvalidSnapshot, name)
		assert.Nil(t, got, name)
	}
}
