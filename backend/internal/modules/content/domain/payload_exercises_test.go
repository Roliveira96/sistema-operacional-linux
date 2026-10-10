package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-022 RN-01 to RN-05, RN-10 to RN-12: the group of exercises of a card.
func TestNormalizePayload_Exercises(t *testing.T) {
	raw := `{
	  "items": [{
	    "title": " Criar a pasta financeiro ",
	    "difficulty": "EASY",
	    "description": "<p>Crie a pasta <b>financeiro</b></p><script>x()</script>",
	    "hints": [{"text": " Use o mkdir ", "command": " mkdir /home/ricardo/financeiro "}, {"text": "Sem comando"}],
	    "solution": {"steps": [{"command": "mkdir /home/ricardo/financeiro"}], "files": [{"path": "/home/ricardo/financeiro/a.txt", "content": "oi\\n"}]},
	    "conditions": [
	      {"kind": "DIR_EXISTS", "path": " /home/ricardo/financeiro "},
	      {"kind": "FILE_CONTENT", "path": "/home/ricardo/financeiro/a.txt", "content": "oi\\n", "match": "equals"},
	      {"kind": "MODE", "path": "/home/ricardo/financeiro", "mode": "755"},
	      {"kind": "OWNER", "path": "/home/ricardo/financeiro", "owner": "ricardo", "group": "ricardo"},
	      {"kind": "LINK", "path": "/srv/atalho", "target": "/srv/destino"},
	      {"kind": "PATH_ABSENT", "path": "/tmp/lixo"},
	      {"kind": "USER_EXISTS", "name": "ana"},
	      {"kind": "GROUP_EXISTS", "name": "contabil"},
	      {"kind": "USER_IN_GROUP", "user": "ana", "name": "contabil"},
	      {"kind": "FILE_EXISTS", "path": "/etc/hosts"}
	    ]
	  }],
	  "setup": {"steps": [{"command": "mkdir /srv"}]}
	}`
	got, pe := normalize(t, BlockExercises, raw)
	require.Nil(t, pe)
	var back struct {
		Items []struct {
			Title, Difficulty, Description string
			Hints                          []struct{ Text, Command string }
			Conditions                     []struct{ Kind, Path string }
		}
		Setup map[string]any
	}
	require.NoError(t, json.Unmarshal(got, &back))
	require.Len(t, back.Items, 1)
	ex := back.Items[0]
	assert.Equal(t, "Criar a pasta financeiro", ex.Title)
	assert.NotContains(t, ex.Description, "script", "the description is filtered like the text of a card")
	assert.Contains(t, ex.Description, "<b>financeiro</b>")
	assert.Equal(t, "mkdir /home/ricardo/financeiro", ex.Hints[0].Command)
	assert.Equal(t, "/home/ricardo/financeiro", ex.Conditions[0].Path, "the path is trimmed")
	assert.Len(t, ex.Conditions, 10)
	assert.NotNil(t, back.Setup)
	assert.Contains(t, string(got), `"solution"`)
}

func TestNormalizePayload_ExercisesAreOptionalInPart(t *testing.T) {
	// A group may have only a snapshot, or only exercises; with neither it is refused (RN-04).
	_, pe := normalize(t, BlockExercises, `{"items":[],"setup":{"steps":[{"command":"ls"}]}}`)
	require.Nil(t, pe)
	_, pe = normalize(t, BlockExercises, `{"items":[{"title":"A","difficulty":"HARD"}]}`)
	require.Nil(t, pe, "no snapshot, no description, no hints, no solution and no conditions is allowed")
	_, pe = normalize(t, BlockExercises, `{"items":[]}`)
	require.NotNil(t, pe)
	assert.Equal(t, []string{"items"}, fieldNames(pe))
}

func TestNormalizePayload_ExerciseErrors(t *testing.T) {
	many := func(n int, item string) string { return strings.TrimSuffix(strings.Repeat(item+",", n), ",") }
	cases := map[string]struct {
		in   string
		want []string
	}{
		"title required":     {`{"items":[{"title":" ","difficulty":"EASY"}]}`, []string{"items[0].title"}},
		"title too long":     {`{"items":[{"title":"` + strings.Repeat("a", MaxTitleLength+1) + `","difficulty":"EASY"}]}`, []string{"items[0].title"}},
		"bad difficulty":     {`{"items":[{"title":"A","difficulty":"IMPOSSIBLE"}]}`, []string{"items[0].difficulty"}},
		"no difficulty":      {`{"items":[{"title":"A"}]}`, []string{"items[0].difficulty"}},
		"too many exercises": {`{"items":[` + many(MaxExercises+1, `{"title":"A","difficulty":"EASY"}`) + `]}`, []string{"items"}},
		"too many hints":     {`{"items":[{"title":"A","difficulty":"EASY","hints":[` + many(MaxExerciseHint+1, `{"text":"x"}`) + `]}]}`, []string{"items[0].hints"}},
		"hint text":          {`{"items":[{"title":"A","difficulty":"EASY","hints":[{"text":" "}]}]}`, []string{"items[0].hints[0].text"}},
		"hint command":       {`{"items":[{"title":"A","difficulty":"EASY","hints":[{"text":"x","command":"` + strings.Repeat("a", MaxCommandLength+1) + `"}]}]}`, []string{"items[0].hints[0].command"}},
		"solution step":      {`{"items":[{"title":"A","difficulty":"EASY","solution":{"steps":[{"command":""}]}}]}`, []string{"items[0].solution.steps[0].command"}},
		"solution file":      {`{"items":[{"title":"A","difficulty":"EASY","solution":{"steps":[],"files":[{"path":"rel","content":""}]}}]}`, []string{"items[0].solution.files[0].path"}},
		"group snapshot":     {`{"items":[{"title":"A","difficulty":"EASY"}],"setup":{"steps":[{"command":""}]}}`, []string{"setup.steps[0].command"}},
		"not an object":      {`[1]`, []string{"payload"}},
	}
	for name, tc := range cases {
		_, pe := normalize(t, BlockExercises, tc.in)
		require.NotNil(t, pe, name)
		assert.ElementsMatch(t, tc.want, fieldNames(pe), name)
	}
}

func TestNormalizePayload_ConditionErrors(t *testing.T) {
	in := func(cond string) string {
		return `{"items":[{"title":"A","difficulty":"EASY","conditions":[` + cond + `]}]}`
	}
	cases := map[string]struct {
		cond string
		want []string
	}{
		"unknown kind":        {`{"kind":"SOMETHING"}`, []string{"items[0].conditions[0].kind"}},
		"no kind":             {`{"path":"/a"}`, []string{"items[0].conditions[0].kind"}},
		"relative path":       {`{"kind":"DIR_EXISTS","path":"a/b"}`, []string{"items[0].conditions[0].path"}},
		"the root":            {`{"kind":"FILE_EXISTS","path":"/"}`, []string{"items[0].conditions[0].path"}},
		"dot dot":             {`{"kind":"PATH_ABSENT","path":"/a/../b"}`, []string{"items[0].conditions[0].path"}},
		"content match":       {`{"kind":"FILE_CONTENT","path":"/a","content":"x","match":"regex"}`, []string{"items[0].conditions[0].match"}},
		"content with NUL":    {`{"kind":"FILE_CONTENT","path":"/a","content":"a\u0000b","match":"equals"}`, []string{"items[0].conditions[0].content"}},
		"content too big":     {`{"kind":"FILE_CONTENT","path":"/a","content":"` + strings.Repeat("a", MaxSetupFileBytes+1) + `","match":"contains"}`, []string{"items[0].conditions[0].content"}},
		"bad mode":            {`{"kind":"MODE","path":"/a","mode":"rwx"}`, []string{"items[0].conditions[0].mode"}},
		"owner needs a name":  {`{"kind":"OWNER","path":"/a","owner":"A b"}`, []string{"items[0].conditions[0].owner"}},
		"owner group":         {`{"kind":"OWNER","path":"/a","owner":"ana","group":"../x"}`, []string{"items[0].conditions[0].group"}},
		"link target":         {`{"kind":"LINK","path":"/a","target":" "}`, []string{"items[0].conditions[0].target"}},
		"user name":           {`{"kind":"USER_EXISTS","name":"Ana Maria"}`, []string{"items[0].conditions[0].name"}},
		"user in group parts": {`{"kind":"USER_IN_GROUP","user":"","name":""}`, []string{"items[0].conditions[0].user", "items[0].conditions[0].name"}},
	}
	for name, tc := range cases {
		_, pe := normalize(t, BlockExercises, in(tc.cond))
		require.NotNil(t, pe, name)
		assert.ElementsMatch(t, tc.want, fieldNames(pe), name)
	}

	parts := make([]string, MaxConditions+1)
	for i := range parts {
		parts[i] = `{"kind":"USER_EXISTS","name":"ana"}`
	}
	_, pe := normalize(t, BlockExercises, in(strings.Join(parts, ",")))
	require.NotNil(t, pe)
	assert.Equal(t, []string{"items[0].conditions"}, fieldNames(pe))
}
