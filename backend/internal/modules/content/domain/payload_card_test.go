package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizePayload_CardHeadingMayHaveNoText(t *testing.T) {
	got, pe := normalize(t, BlockText, `{"title":"Atualizar a lista","command":"apt update","html":""}`)
	require.Nil(t, pe)
	assert.Contains(t, string(got), "Atualizar a lista")

	_, pe = normalize(t, BlockText, `{"html":""}`)
	require.NotNil(t, pe, "a text without a title still needs its text")
}

func TestSanitizer_ImagesOnlyOverHTTPS(t *testing.T) {
	s := NewHTMLSanitizer()
	assert.Contains(t, s.Sanitize(`<img src="https://x.com/a.png" alt="fluxo">`), `src="https://x.com/a.png"`)
	assert.NotContains(t, s.Sanitize(`<img src="http://x.com/a.png">`), "src")
	assert.NotContains(t, s.Sanitize(`<img src="javascript:alert(1)" onerror="x()">`), "javascript")
	assert.Contains(t, s.Sanitize(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`), "youtube.com/embed/abc")
	assert.NotContains(t, s.Sanitize(`<iframe src="https://evil.example/x"></iframe>`), "evil.example")
}
