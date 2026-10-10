// Package domain holds the guided voice reader rules and types (SPEC-017).
package domain

import "errors"

const (
	// MaxTextRunes is the longest text accepted for one synthesis (RN-02).
	MaxTextRunes = 2000
	// DefaultVoice is used when the request names no voice (RN-03).
	DefaultVoice = "pt-BR-FranciscaNeural"
	// MimeType is the format of the synthesized audio.
	MimeType = "audio/mpeg"
)

// voices is the closed list of allowed voices (RN-03).
var voices = map[string]struct{}{
	DefaultVoice:          {},
	"pt-BR-AntonioNeural": {},
}

// IsAllowedVoice reports whether name is in the allowed voice list.
func IsAllowedVoice(name string) bool {
	_, ok := voices[name]
	return ok
}

// WordTiming is the start and end of one spoken word, in milliseconds from
// the beginning of the audio (RN-07).
type WordTiming struct {
	Word    string `json:"word"`
	StartMs int64  `json:"startMs"`
	EndMs   int64  `json:"endMs"`
}

// SpeechSynthesis is the result of turning a text into spoken audio.
type SpeechSynthesis struct {
	Audio    []byte
	MimeType string
	Voice    string
	Words    []WordTiming
}

// Domain errors returned by the service.
var (
	ErrEmptyText           = errors.New("tts: text is empty")
	ErrTextTooLong         = errors.New("tts: text is too long")
	ErrInvalidVoice        = errors.New("tts: voice is not allowed")
	ErrBusy                = errors.New("tts: too many syntheses in progress")
	ErrTimeout             = errors.New("tts: synthesis timed out")
	ErrProviderFailed      = errors.New("tts: speech provider failed")
	ErrProviderUnavailable = errors.New("tts: speech provider is unreachable")
)
