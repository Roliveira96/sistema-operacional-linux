package htmlsafe

import (
	"strings"
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

// Covers SPEC-025: an image the system stored keeps its address even over http (the bucket of a development machine), but only in the exact
// shape of its name; any other http address is still dropped.
func TestSanitizeKeepsTheImagesOfTheContent(t *testing.T) {
	s := New()
	hash := strings.Repeat("a1", 32)
	for _, src := range []string{
		"http://192.168.3.104:9100/linux-lab/conteudo/" + hash + ".avif",
		"https://cdn.exemplo.com/lab/conteudo/" + hash + ".gif",
	} {
		assert.Contains(t, s.Sanitize(`<img src="`+src+`" alt="a">`), src)
	}
	for _, src := range []string{
		"http://x.com/conteudo/" + hash + ".avif",         // no bucket in the path
		"http://x.com/lab/conteudo/" + hash + ".png",      // not the format the system stores
		"http://x.com/lab/conteudo/abc.avif",              // not the name of a content
		"http://x.com/lab/conteudo/" + hash + ".avif?x=1", // anything after the name
		"http://x.com/lab/other/" + hash + ".avif",        // another prefix
	} {
		assert.NotContains(t, s.Sanitize(`<img src="`+src+`">`), "src=", src)
	}
	// A quote in the name ends the attribute and what follows is only text: no tag comes out of it.
	assert.NotContains(t, s.Sanitize(`<img src="http://x.com/lab/conteudo/`+hash+`.avif"><script>a</script>">`), "<script")
}

// Covers SPEC-025 rev. 2 (CA-16): a gallery of pictures of the system comes out of the filter whole, in order, with the class of the grid.
func TestSanitizeKeepsTheGalleryOfImages(t *testing.T) {
	s := New()
	one := "http://192.168.3.104:9100/linux-lab/conteudo/" + strings.Repeat("a1", 32) + ".avif"
	two := "https://cdn.exemplo.com/lab/conteudo/" + strings.Repeat("b2", 32) + ".gif"
	in := `<div class="md-gallery"><figure class="md-image"><img src="` + one + `" alt="Um"><figcaption>Um</figcaption></figure>` +
		`<figure class="md-image"><img src="` + two + `" alt=""></figure></div>`
	out := s.Sanitize(in)
	assert.Equal(t, in, out)
	assert.Less(t, strings.Index(out, one), strings.Index(out, two))
	// A script smuggled between the pictures does not survive.
	assert.NotContains(t, s.Sanitize(`<div class="md-gallery"><script>x()</script>`+in+`</div>`), "<script")
}

func TestPlainText(t *testing.T) {
	assert.Equal(t, "ls · cd — Resumo da aula", PlainText("<p>ls · cd — Resumo</p><p>da   aula</p>"))
	assert.Equal(t, "A & B < C", PlainText("<p>A &amp; B &lt; C</p>"))
	assert.Equal(t, "texto simples", PlainText("  texto   simples "))
	assert.Equal(t, "", PlainText("<p> </p><br>"))
}

// Covers SPEC-041 RN-02 and D-05: the syllabus and the guidelines of a class keep formatted text and links, without images or videos.
func TestRichTextDropsMediaAndKeepsText(t *testing.T) {
	s := NewRichText()
	assert.Equal(t, `<p><strong>Unidade 1</strong></p><ul><li>Processos</li></ul>`,
		s.Sanitize(`<p><strong>Unidade 1</strong></p><ul><li>Processos</li></ul><script>alert(1)</script>`))
	assert.NotContains(t, s.Sanitize(`<img src="https://x.com/a.png" alt="a">`), "img")
	assert.NotContains(t, s.Sanitize(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`), "iframe")
	assert.NotContains(t, s.Sanitize(`<p onclick="x()">a</p>`), "onclick")
	assert.NotContains(t, s.Sanitize(`<a href="javascript:x()">a</a>`), "javascript")
	assert.Contains(t, s.Sanitize(`<a href="https://utfpr.edu.br">site</a>`), `href="https://utfpr.edu.br"`)
}
