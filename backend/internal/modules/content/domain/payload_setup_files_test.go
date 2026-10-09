package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-021 RN-12: a snapshot carries files as data, kept exactly as written.
func TestNormalizeSetup_Files(t *testing.T) {
	log := "2026-10-09 ERROR  falha\\n com barra e \"aspas\"\n\n  espaços no fim  \n"
	raw, err := json.Marshal(map[string]any{
		"steps": []any{},
		"files": []any{
			map[string]any{"path": " /var/log/app.log ", "content": log, "mode": "640", "owner": "ana", "group": "adm"},
			map[string]any{"path": "/srv/www/index.html", "content": "<h1>Oi</h1>"},
		},
	})
	require.NoError(t, err)
	got, err := NormalizeSetup(raw)
	require.NoError(t, err)
	var back struct {
		Files []struct{ Path, Content, Mode, Owner, Group string }
	}
	require.NoError(t, json.Unmarshal(got, &back))
	require.Len(t, back.Files, 2)
	assert.Equal(t, "/var/log/app.log", back.Files[0].Path, "the path is trimmed")
	assert.Equal(t, log, back.Files[0].Content, "the content is never trimmed or changed")
	assert.Equal(t, []string{"640", "ana", "adm"}, []string{back.Files[0].Mode, back.Files[0].Owner, back.Files[0].Group})
	assert.Contains(t, string(got), "<h1>Oi</h1>", "markup is not escaped")

	// A snapshot may have only files, and the header of a card takes them too.
	_, err = NormalizeSetup(json.RawMessage(`{"files":[{"path":"/a","content":""}]}`))
	require.NoError(t, err)
	_, pe := normalize(t, BlockText, `{"title":"Card","html":"","setup":{"files":[{"path":"/srv/a.txt","content":"x"}]}}`)
	require.Nil(t, pe)
}

func manyFiles(n int) string {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = `{"path":"/f` + strings.Repeat("x", i%7) + string(rune('a'+i%26)) + strings.Repeat("y", i/26) + `","content":""}`
	}
	return strings.Join(parts, ",")
}

func TestNormalizeSetup_FileErrors(t *testing.T) {
	big := strings.Repeat("a", MaxSetupFileBytes+1)
	cases := map[string]struct {
		in   string
		want []string
	}{
		"relative path":    {`{"files":[{"path":"srv/a","content":"x"}]}`, []string{"setup.files[0].path"}},
		"the root":         {`{"files":[{"path":"/","content":"x"}]}`, []string{"setup.files[0].path"}},
		"a folder":         {`{"files":[{"path":"/srv/","content":"x"}]}`, []string{"setup.files[0].path"}},
		"dot dot":          {`{"files":[{"path":"/srv/../etc/passwd","content":"x"}]}`, []string{"setup.files[0].path"}},
		"repeated":         {`{"files":[{"path":"/a","content":""},{"path":"/a","content":""}]}`, []string{"setup.files[1].path"}},
		"nul":              {`{"files":[{"path":"/a","content":"a\u0000b"}]}`, []string{"setup.files[0].content"}},
		"file too big":     {`{"files":[{"path":"/a","content":"` + big + `"}]}`, []string{"setup.files[0].content"}},
		"bad mode":         {`{"files":[{"path":"/a","content":"","mode":"rwx"}]}`, []string{"setup.files[0].mode"}},
		"bad owner":        {`{"files":[{"path":"/a","content":"","owner":"A b"}]}`, []string{"setup.files[0].owner"}},
		"bad group":        {`{"files":[{"path":"/a","content":"","group":"../x"}]}`, []string{"setup.files[0].group"}},
		"too many files":   {`{"files":[` + manyFiles(MaxSetupFiles+1) + `]}`, []string{"setup.files"}},
		"files not a list": {`{"files":"/a"}`, []string{"setup"}},
	}
	for name, tc := range cases {
		_, err := NormalizeSetup(json.RawMessage(tc.in))
		var pe *PayloadError
		require.ErrorAs(t, err, &pe, name)
		assert.ElementsMatch(t, tc.want, fieldNames(pe), name)
	}

	// Files that are each within their limit can still pass the total.
	chunk := strings.Repeat("b", MaxSetupFileBytes)
	var files []string
	for i := 0; i < 5; i++ {
		files = append(files, `{"path":"/big`+string(rune('a'+i))+`","content":"`+chunk+`"}`)
	}
	_, err := NormalizeSetup(json.RawMessage(`{"files":[` + strings.Join(files, ",") + `]}`))
	var pe *PayloadError
	require.ErrorAs(t, err, &pe)
	assert.Equal(t, []string{"setup.files"}, fieldNames(pe))
}
