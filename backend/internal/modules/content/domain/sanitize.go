package domain

import (
	"regexp"

	"github.com/microcosm-cc/bluemonday"
)

// HTMLSanitizer filters HTML with the same allowlist as the extractor
// (SPEC-005 RN-08, SPEC-011 RN-08). It is safe for concurrent use.
type HTMLSanitizer struct {
	policy *bluemonday.Policy
}

var (
	classTokens  = regexp.MustCompile(`^[A-Za-z0-9_\- ]+$`)
	youtubeEmbed = regexp.MustCompile(`^https://(www\.)?(youtube\.com|youtube-nocookie\.com)/embed/`)
)

// NewHTMLSanitizer builds the allowlist policy.
func NewHTMLSanitizer() *HTMLSanitizer {
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
	p.AllowAttrs("src").Matching(youtubeEmbed).OnElements("iframe")
	p.AllowAttrs("allowfullscreen").OnElements("iframe")
	return &HTMLSanitizer{policy: p}
}

// Sanitize returns the filtered HTML.
func (s *HTMLSanitizer) Sanitize(html string) string {
	return s.policy.Sanitize(html)
}
