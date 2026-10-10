package htmlsafe

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitize(t *testing.T) {
	s := New()
	assert.Equal(t, `<p>ok <code>ls</code></p>`, s.Sanitize(`<p>ok <code>ls</code></p><script>alert(1)</script>`))
	assert.NotContains(t, s.Sanitize(`<b onclick="x()">a</b>`), "onclick")
	assert.NotContains(t, s.Sanitize(`<a href="javascript:x()">a</a>`), "javascript")
	assert.Contains(t, s.Sanitize(`<img src="https://x.com/a.png" alt="a">`), "https://x.com/a.png")
	assert.NotContains(t, s.Sanitize(`<img src="http://x.com/a.png">`), "src")
	assert.Contains(t, s.Sanitize(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`), "youtube.com/embed/abc")
	assert.Equal(t, "A &amp; B", s.Sanitize("A & B"), "plain text stays text")
}

func TestPlainText(t *testing.T) {
	assert.Equal(t, "ls · cd — Resumo da aula", PlainText("<p>ls · cd — Resumo</p><p>da   aula</p>"))
	assert.Equal(t, "A & B < C", PlainText("<p>A &amp; B &lt; C</p>"))
	assert.Equal(t, "texto simples", PlainText("  texto   simples "))
	assert.Equal(t, "", PlainText("<p> </p><br>"))
}
