package domain

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func normalize(t *testing.T, bt BlockType, payload string) (json.RawMessage, *PayloadError) {
	t.Helper()
	got, err := NormalizePayload(bt, json.RawMessage(payload), NewHTMLSanitizer())
	var pe *PayloadError
	if err != nil {
		require.True(t, errors.As(err, &pe), "unexpected error type: %v", err)
	}
	return got, pe
}

func fieldNames(pe *PayloadError) []string {
	out := []string{}
	for _, f := range pe.Fields {
		out = append(out, f.Field)
	}
	return out
}

func TestNormalizePayload_Valid(t *testing.T) {
	cases := map[BlockType]string{
		BlockText:       `{"title":"Título","html":"<p>Use <code>ls</code></p>"}`,
		BlockTip:        `{"variant":"WARNING","html":"<p>Cuidado</p>"}`,
		BlockCuriosity:  `{"title":"Na vida real","html":"<p>x</p>"}`,
		BlockLegacyHTML: `{"html":"<h3>x</h3>"}`,
		BlockCommand:    `{"steps":[{"command":"ls -la","terminal":2,"login":{"user":"ana","password":"1"},"answers":["s"]}]}`,
		BlockStepByStep: `{"steps":["um","dois"]}`,
		BlockCards:      `{"cards":[{"title":"a","text":"b"}]}`,
		BlockWidget:     `{"component":"LS_ANATOMY"}`,
	}
	for bt, payload := range cases {
		t.Run(string(bt), func(t *testing.T) {
			got, pe := normalize(t, bt, payload)
			require.Nil(t, pe)
			assert.True(t, json.Valid(got))
		})
	}
}

func TestNormalizePayload_KeepsCommandMarkAndDropsScript(t *testing.T) {
	got, pe := normalize(t, BlockText, `{"html":"<p>Rode <code>pwd</code><script>alert(1)</script><b onclick=\"x()\">ok</b></p>"}`)
	require.Nil(t, pe)
	s := string(got)
	assert.Contains(t, s, "<code>pwd</code>")
	assert.NotContains(t, s, "script")
	assert.NotContains(t, s, "onclick")
	assert.Contains(t, s, "ok")
}

func TestNormalizePayload_Invalid(t *testing.T) {
	long := strings.Repeat("a", MaxCommandLength+1)
	cases := []struct {
		name    string
		bt      BlockType
		payload string
		want    []string
	}{
		{"text without content", BlockText, `{"html":"<p> </p>"}`, []string{"html"}},
		{"tip variant", BlockTip, `{"variant":"X","html":"<p>a</p>"}`, []string{"variant"}},
		{"no steps", BlockCommand, `{"steps":[]}`, []string{"steps"}},
		{"command required and terminal range", BlockCommand, `{"steps":[{"command":"","terminal":4}]}`, []string{"steps[0].command", "steps[0].terminal"}},
		{"login pair", BlockCommand, `{"steps":[{"command":"su","login":{"user":"a"}}]}`, []string{"steps[0].login"}},
		{"command too long", BlockCommand, `{"steps":[{"command":"` + long + `"}]}`, []string{"steps[0].command"}},
		{"card fields", BlockCards, `{"cards":[{"title":"","text":"x"}]}`, []string{"cards[0].title"}},
		{"step text", BlockStepByStep, `{"steps":["ok"," "]}`, []string{"steps[1]"}},
		{"widget", BlockWidget, `{"component":"OTHER"}`, []string{"component"}},
		{"html too long", BlockLegacyHTML, `{"html":"` + strings.Repeat("a", MaxHTMLLength+1) + `"}`, []string{"html"}},
		{"not an object", BlockText, `[1]`, []string{"payload"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, pe := normalize(t, tc.bt, tc.payload)
			require.NotNil(t, pe)
			assert.ElementsMatch(t, tc.want, fieldNames(pe))
			assert.Contains(t, pe.Error(), tc.want[0])
		})
	}
}

func TestNormalizePayload_UnknownType(t *testing.T) {
	_, pe := normalize(t, BlockType("NOPE"), `{}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"type"}, fieldNames(pe))
}
