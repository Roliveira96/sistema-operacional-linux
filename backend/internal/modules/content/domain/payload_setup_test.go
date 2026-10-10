package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-021 RN-01 and RN-02: a snapshot is a script of steps.
func TestNormalizeSetup(t *testing.T) {
	got, err := NormalizeSetup(json.RawMessage(`{"summary":" prepara ","steps":[{"command":" mkdir /x "},{"command":"su ana","terminal":2,"login":{"user":" ana ","password":"1"},"answers":[" sim "]}]}`))
	require.NoError(t, err)
	assert.JSONEq(t, `{"summary":"prepara","steps":[{"command":"mkdir /x"},{"command":"su ana","terminal":2,"login":{"user":"ana","password":"1"},"answers":["sim"]}]}`, string(got))

	// An empty script is allowed: it clears the snapshot.
	got, err = NormalizeSetup(json.RawMessage(`{}`))
	require.NoError(t, err)
	assert.JSONEq(t, `{"steps":[]}`, string(got))
}

func TestNormalizeSetup_Errors(t *testing.T) {
	steps := func(n int) string { return strings.TrimSuffix(strings.Repeat(`{"command":"ls"},`, n), ",") }
	cases := map[string]struct {
		in   string
		want []string
	}{
		"command required":    {`{"steps":[{"command":" "}]}`, []string{"setup.steps[0].command"}},
		"command too long":    {`{"steps":[{"command":"` + strings.Repeat("a", MaxCommandLength+1) + `"}]}`, []string{"setup.steps[0].command"}},
		"terminal range":      {`{"steps":[{"command":"ls","terminal":4}]}`, []string{"setup.steps[0].terminal"}},
		"login pair":          {`{"steps":[{"command":"ls","login":{"user":"a"}}]}`, []string{"setup.steps[0].login"}},
		"too many steps":      {`{"steps":[` + steps(MaxSetupSteps+1) + `]}`, []string{"setup.steps"}},
		"too many answers":    {`{"steps":[{"command":"ls","answers":[` + strings.TrimSuffix(strings.Repeat(`"a",`, MaxSetupAnswers+1), ",") + `]}]}`, []string{"setup.steps[0].answers"}},
		"answer too long":     {`{"steps":[{"command":"ls","answers":["` + strings.Repeat("a", MaxCommandLength+1) + `"]}]}`, []string{"setup.steps[0].answers[0]"}},
		"summary too long":    {`{"summary":"` + strings.Repeat("a", MaxSetupSummary+1) + `","steps":[]}`, []string{"setup.summary"}},
		"not an object":       {`[1]`, []string{"setup"}},
		"steps is not a list": {`{"steps":"ls"}`, []string{"setup"}},
	}
	for name, tc := range cases {
		_, err := NormalizeSetup(json.RawMessage(tc.in))
		var pe *PayloadError
		require.ErrorAs(t, err, &pe, name)
		assert.ElementsMatch(t, tc.want, fieldNames(pe), name)
	}
}

// Covers SPEC-021 RN-02: the header of a card carries its snapshot.
func TestNormalizePayload_CardSetup(t *testing.T) {
	got, pe := normalize(t, BlockText, `{"title":"Card","html":"","setup":{"summary":"ok","steps":[{"command":"mkdir /x"}]}}`)
	require.Nil(t, pe)
	assert.Contains(t, string(got), `"setup":{"summary":"ok","steps":[{"command":"mkdir /x"}]}`)

	got, pe = normalize(t, BlockText, `{"title":"Card","html":""}`)
	require.Nil(t, pe)
	assert.NotContains(t, string(got), "setup")

	_, pe = normalize(t, BlockText, `{"title":"Card","html":"","setup":{"steps":[{"command":""}]}}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"setup.steps[0].command"}, fieldNames(pe))

	// Only a card with a title can have one.
	_, pe = normalize(t, BlockText, `{"html":"<p>a</p>","setup":{"steps":[]}}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"setup"}, fieldNames(pe))

	// The old image environment is no longer kept.
	got, pe = normalize(t, BlockText, `{"title":"Card","html":"","environment":{"scenarioId":"x"}}`)
	require.Nil(t, pe)
	assert.NotContains(t, string(got), "environment")
}
