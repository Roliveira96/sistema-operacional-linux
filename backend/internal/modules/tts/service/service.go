// Package service implements the guided voice reader rules (SPEC-017).
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/tts/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/speech"
)

// Provider turns an SSML document into audio and word timings.
type Provider interface {
	Synthesize(ctx context.Context, ssml string) (speech.Result, error)
}

// Options configures the service.
type Options struct {
	// Timeout bounds one synthesis (RN-05).
	Timeout time.Duration
	// MaxConcurrent bounds the syntheses in progress at once (RN-08).
	MaxConcurrent int
}

// Service validates requests and runs the syntheses.
type Service struct {
	provider Provider
	timeout  time.Duration
	slots    chan struct{}
}

// New creates the service.
func New(provider Provider, opts Options) *Service {
	return &Service{provider: provider, timeout: opts.Timeout, slots: make(chan struct{}, opts.MaxConcurrent)}
}

// Synthesize speaks text with voice (empty selects the default voice).
func (s *Service) Synthesize(ctx context.Context, text, voice string) (domain.SpeechSynthesis, error) {
	text = strings.TrimSpace(text)
	switch {
	case text == "":
		return domain.SpeechSynthesis{}, domain.ErrEmptyText
	case utf8.RuneCountInString(text) > domain.MaxTextRunes:
		return domain.SpeechSynthesis{}, domain.ErrTextTooLong
	}
	if voice == "" {
		voice = domain.DefaultVoice
	}
	if !domain.IsAllowedVoice(voice) {
		return domain.SpeechSynthesis{}, domain.ErrInvalidVoice
	}

	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return domain.SpeechSynthesis{}, domain.ErrBusy
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	res, err := s.provider.Synthesize(ctx, BuildSSML(voice, text))
	if err != nil {
		return domain.SpeechSynthesis{}, mapProviderError(ctx, err)
	}

	words := make([]domain.WordTiming, len(res.Words))
	for i, w := range res.Words {
		words[i] = domain.WordTiming{Word: w.Text, StartMs: w.StartMs, EndMs: w.EndMs}
	}
	return domain.SpeechSynthesis{Audio: res.Audio, MimeType: domain.MimeType, Voice: voice, Words: words}, nil
}

func mapProviderError(ctx context.Context, err error) error {
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return fmt.Errorf("%w: %w", domain.ErrTimeout, err)
	case errors.Is(ctx.Err(), context.Canceled):
		return ctx.Err()
	case errors.Is(err, speech.ErrUnavailable):
		return fmt.Errorf("%w: %w", domain.ErrProviderUnavailable, err)
	default:
		return fmt.Errorf("%w: %w", domain.ErrProviderFailed, err)
	}
}
