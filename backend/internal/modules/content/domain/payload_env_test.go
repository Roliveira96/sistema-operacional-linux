package domain

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-020 RN-02: the environment of a card header.
func TestNormalizePayload_CardEnvironment(t *testing.T) {
	id := uuid.NewString()
	got, pe := normalize(t, BlockText, `{"title":"Card","html":"","environment":{"scenarioId":"`+id+`","summary":" pronto ","commands":[" mkdir /x ","useradd ana"]}}`)
	require.Nil(t, pe)
	assert.Contains(t, string(got), `"scenarioId":"`+id+`"`)
	assert.Contains(t, string(got), `"summary":"pronto"`)
	assert.Contains(t, string(got), `"mkdir /x"`)

	// Without the field nothing changes.
	got, pe = normalize(t, BlockText, `{"title":"Card","html":""}`)
	require.Nil(t, pe)
	assert.NotContains(t, string(got), "environment")
}

func TestNormalizePayload_CardEnvironmentErrors(t *testing.T) {
	id := uuid.NewString()
	_, pe := normalize(t, BlockText, `{"title":"Card","html":"","environment":{"scenarioId":"x"}}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"environment.scenarioId"}, fieldNames(pe))

	// Only a card with a title can have one.
	_, pe = normalize(t, BlockText, `{"html":"<p>a</p>","environment":{"scenarioId":"`+id+`"}}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"environment"}, fieldNames(pe))

	_, pe = normalize(t, BlockText, `{"title":"C","html":"","environment":{"scenarioId":"`+id+`","summary":"`+strings.Repeat("a", MaxEnvSummary+1)+`"}}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"environment.summary"}, fieldNames(pe))

	many := `"` + strings.Join(make([]string, MaxEnvCommands+2), `","`) + `"`
	_, pe = normalize(t, BlockText, `{"title":"C","html":"","environment":{"scenarioId":"`+id+`","commands":[`+many+`]}}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"environment.commands"}, fieldNames(pe))

	_, pe = normalize(t, BlockText, `{"title":"C","html":"","environment":{"scenarioId":"`+id+`","commands":["`+strings.Repeat("a", MaxCommandLength+1)+`"]}}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"environment.commands[0]"}, fieldNames(pe))
}

// Covers SPEC-020 RN-06.
func TestNormalizePayload_ExpectError(t *testing.T) {
	got, pe := normalize(t, BlockCommand, `{"steps":[{"command":"curl http://localhost","expectError":true},{"command":"ls"}]}`)
	require.Nil(t, pe)
	assert.Contains(t, string(got), `"expectError":true`)
	assert.Equal(t, 1, strings.Count(string(got), "expectError"), "false is not written")
}

// Covers SPEC-020 RN-01.
func TestValidateSnapshot(t *testing.T) {
	good := `{"formato":"exame-so/maquina","versao":1,"hostname":"lab","contas":{"usuarios":[],"grupos":[]},"raiz":{"nome":"","tipo":"dir"}}`
	assert.NoError(t, ValidateSnapshot([]byte(good)))
	for _, bad := range []string{
		`not json`, `null`, `[]`, `{}`,
		`{"formato":"outro","versao":1,"raiz":{"tipo":"dir"}}`,
		`{"formato":"exame-so/maquina","versao":9,"raiz":{"tipo":"dir"}}`,
		`{"formato":"exame-so/maquina","versao":1}`,
	} {
		assert.ErrorIs(t, ValidateSnapshot([]byte(bad)), ErrInvalidSnapshot, bad)
	}
}
