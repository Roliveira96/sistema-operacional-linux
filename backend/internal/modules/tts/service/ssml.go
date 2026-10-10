package service

import (
	"bytes"
	"encoding/xml"
	"strings"
	"unicode/utf8"
)

// BuildSSML wraps text in an SSML document for voice (RN-04). Invalid XML 1.0
// characters are removed first and the reserved characters are escaped by the
// standard XML encoder, so no text can change the structure of the document.
// The voice must already be validated against the allowed list.
func BuildSSML(voice, text string) string {
	var escaped bytes.Buffer
	// EscapeText only fails when the writer fails, and bytes.Buffer never does.
	_ = xml.EscapeText(&escaped, []byte(stripInvalidXML(text)))
	return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'>" +
		"<voice name='" + voice + "'>" + escaped.String() + "</voice></speak>"
}

// stripInvalidXML drops the characters XML 1.0 cannot carry.
func stripInvalidXML(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t', r == '\n', r == '\r':
			return r
		case r < 0x20, r == utf8.RuneError, r == 0xFFFE, r == 0xFFFF:
			return -1
		case r >= 0xD800 && r <= 0xDFFF:
			return -1
		}
		return r
	}, s)
}
