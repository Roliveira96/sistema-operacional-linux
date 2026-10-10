package domain

import "github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/htmlsafe"

// HTMLSanitizer filters HTML with the same allowlist as the extractor (SPEC-005 RN-08,
// SPEC-011 RN-08). The policy lives in platform/htmlsafe, shared with the module description.
type HTMLSanitizer = htmlsafe.Sanitizer

// NewHTMLSanitizer builds the allowlist policy.
func NewHTMLSanitizer() *HTMLSanitizer { return htmlsafe.New() }
