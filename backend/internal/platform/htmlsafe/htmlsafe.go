// Package htmlsafe filters the HTML that authors write (content blocks, SPEC-011 RN-08, and the
// module description, SPEC-010 RN-12) with one allowlist, and reads its visible text.
package htmlsafe

import (
	"html"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

// Sanitizer filters HTML with the same allowlist as the extractor (SPEC-005 RN-08).
// It is safe for concurrent use.
type Sanitizer struct {
	policy *bluemonday.Policy
}

var (
	classTokens  = regexp.MustCompile(`^[A-Za-z0-9_\- ]+$`)
	// An image is https, or one the system itself stored (SPEC-025): <bucket>/conteudo/<sha-256>.avif|gif. The second form is what the
	// bucket of a development machine serves over http; it is only that exact shape, never any http address.
	httpsImage   = regexp.MustCompile(`^(https://|https?://[^/\s]+/[A-Za-z0-9._-]+/conteudo/[0-9a-f]{64}\.(avif|gif)$)`)
	youtubeEmbed = regexp.MustCompile(`^https://(www\.)?(youtube\.com|youtube-nocookie\.com)/embed/`)
	tags         = regexp.MustCompile(`<[^>]*>`)
	spaces       = regexp.MustCompile(`\s+`)
)

// New builds the allowlist policy.
func New() *Sanitizer {
	p := bluemonday.NewPolicy()
	p.AllowElements("p", "br", "b", "strong", "i", "em", "u", "small", "code", "pre", "kbd", "samp", "span", "div",
		"ul", "ol", "li", "dl", "dt", "dd", "h3", "h4", "h5", "blockquote", "hr",
		"table", "thead", "tbody", "tr", "th", "td", "details", "summary", "figure", "figcaption")
	p.AllowAttrs("class").Matching(classTokens).Globally()
	p.AllowAttrs("title").Globally()
	p.AllowAttrs("href").OnElements("a")
	p.AllowURLSchemes("http", "https")
	p.AllowRelativeURLs(true)
	p.AllowAttrs("colspan", "rowspan").Matching(bluemonday.Integer).OnElements("td", "th")
	p.AllowAttrs("src").Matching(httpsImage).OnElements("img")
	p.AllowAttrs("alt").OnElements("img")
	p.AllowAttrs("src").Matching(youtubeEmbed).OnElements("iframe")
	p.AllowAttrs("allowfullscreen").OnElements("iframe")
	return &Sanitizer{policy: p}
}

// NewRichText builds the policy of the syllabus and the guidelines of a class (SPEC-041 RN-02, D-05): the same formatted text
// and links as New, without images or videos.
func NewRichText() *Sanitizer {
	p := bluemonday.NewPolicy()
	p.AllowElements("p", "br", "b", "strong", "i", "em", "u", "small", "code", "pre", "kbd", "samp", "span", "div",
		"ul", "ol", "li", "dl", "dt", "dd", "h3", "h4", "h5", "blockquote", "hr",
		"table", "thead", "tbody", "tr", "th", "td", "details", "summary", "figure", "figcaption")
	p.AllowAttrs("class").Matching(classTokens).Globally()
	p.AllowAttrs("title").Globally()
	p.AllowAttrs("href").OnElements("a")
	p.AllowURLSchemes("http", "https")
	p.AllowRelativeURLs(true)
	p.AllowAttrs("colspan", "rowspan").Matching(bluemonday.Integer).OnElements("td", "th")
	return &Sanitizer{policy: p}
}

// NewAnswer builds the policy of the answer of a student to a descriptive question (SPEC-039 D-01): only text and commands, that
// is paragraphs, line breaks, inline code and code blocks. Everything else is dropped, keeping its text.
func NewAnswer() *Sanitizer {
	p := bluemonday.NewPolicy()
	p.AllowElements("p", "br", "code", "pre")
	return &Sanitizer{policy: p}
}

// Sanitize returns the filtered HTML.
func (s *Sanitizer) Sanitize(markup string) string {
	return s.policy.Sanitize(markup)
}

// PlainText returns the visible text of markup, with the entities decoded and the spaces collapsed.
// Text that is not markup comes back as it is.
func PlainText(markup string) string {
	text := tags.ReplaceAllString(markup, " ")
	return strings.TrimSpace(spaces.ReplaceAllString(html.UnescapeString(text), " "))
}
