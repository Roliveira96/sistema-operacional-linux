package service

import (
	"context"
	"encoding/xml"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/tts/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/speech"
)

type fakeProvider struct {
	mu    sync.Mutex
	calls int
	ssml  string
	res   speech.Result
	err   error
	wait  chan struct{}
}

func (f *fakeProvider) Synthesize(ctx context.Context, ssml string) (speech.Result, error) {
	f.mu.Lock()
	f.calls++
	f.ssml = ssml
	f.mu.Unlock()
	if f.wait != nil {
		select {
		case <-f.wait:
		case <-ctx.Done():
			return speech.Result{}, ctx.Err()
		}
	}
	return f.res, f.err
}

func newService(p Provider) *Service {
	return New(p, Options{Timeout: time.Second, MaxConcurrent: 2})
}

// Covers CA-01, CA-06 and CA-09 (default voice) at the service level.
func TestSynthesizeSuccess(t *testing.T) {
	p := &fakeProvider{res: speech.Result{Audio: []byte("mp3"), Words: []speech.Word{{Text: "Olá", StartMs: 10, EndMs: 300}}}}
	out, err := newService(p).Synthesize(context.Background(), "  Olá mundo  ", "")
	require.NoError(t, err)
	assert.Equal(t, []byte("mp3"), out.Audio)
	assert.Equal(t, domain.MimeType, out.MimeType)
	assert.Equal(t, domain.DefaultVoice, out.Voice)
	assert.Equal(t, []domain.WordTiming{{Word: "Olá", StartMs: 10, EndMs: 300}}, out.Words)
	assert.Contains(t, p.ssml, "<voice name='pt-BR-FranciscaNeural'>Olá mundo</voice>")
}

// Covers CA-02, CA-03 and CA-09 (RN-01, RN-02, RN-03): the provider is never called.
func TestSynthesizeValidation(t *testing.T) {
	p := &fakeProvider{}
	s := newService(p)
	ctx := context.Background()

	for _, empty := range []string{"", "   \n\t "} {
		_, err := s.Synthesize(ctx, empty, "")
		assert.ErrorIs(t, err, domain.ErrEmptyText, "%q", empty)
	}
	_, err := s.Synthesize(ctx, strings.Repeat("a", 2001), "")
	assert.ErrorIs(t, err, domain.ErrTextTooLong)
	_, err = s.Synthesize(ctx, "x", "en-US-JennyNeural")
	assert.ErrorIs(t, err, domain.ErrInvalidVoice)
	assert.Zero(t, p.calls)
}

// Covers CA-03: the limit counts characters, not bytes.
func TestSynthesizeLimitCountsRunes(t *testing.T) {
	p := &fakeProvider{res: speech.Result{Audio: []byte("a")}}
	text := strings.Repeat("ã", domain.MaxTextRunes) // 4000 bytes
	_, err := newService(p).Synthesize(context.Background(), text, "pt-BR-AntonioNeural")
	require.NoError(t, err)
	assert.Equal(t, 1, p.calls)
}

// Covers CA-04 and CA-05 (RN-04).
func TestBuildSSMLEscapesAndSanitizes(t *testing.T) {
	hostile := `</voice><voice name="x">a < b & c 'q' "d"</voice>`
	doc := BuildSSML(domain.DefaultVoice, hostile)

	var parsed struct {
		Voices []struct {
			Name string `xml:"name,attr"`
			Text string `xml:",chardata"`
		} `xml:"voice"`
	}
	require.NoError(t, xml.Unmarshal([]byte(doc), &parsed), doc)
	require.Len(t, parsed.Voices, 1, "the text must not add elements")
	assert.Equal(t, domain.DefaultVoice, parsed.Voices[0].Name)
	assert.Equal(t, hostile, parsed.Voices[0].Text, "the text is spoken as typed")
	assert.NotContains(t, doc, "<voice name=\"x\">")

	clean := BuildSSML(domain.DefaultVoice, "a\x00b\x07c\x1fd￾e￿\tf\ng\rh áéí")
	require.NoError(t, xml.Unmarshal([]byte(clean), new(any)), clean)
	for _, bad := range []string{"\x00", "\x07", "\x1f", "￾", "￿"} {
		assert.NotContains(t, clean, bad)
	}
	assert.Contains(t, clean, "abcde")
	assert.Contains(t, clean, "áéí")
	assert.Contains(t, clean, "&#x9;f", "tab, newline and carriage return are kept")
}

// Covers CA-07, CA-08 and CA-13 (RN-05, RN-06) error mapping.
func TestSynthesizeProviderErrors(t *testing.T) {
	ctx := context.Background()

	_, err := newService(&fakeProvider{err: speech.ErrFailed}).Synthesize(ctx, "x", "")
	assert.ErrorIs(t, err, domain.ErrProviderFailed)

	_, err = newService(&fakeProvider{err: speech.ErrUnavailable}).Synthesize(ctx, "x", "")
	assert.ErrorIs(t, err, domain.ErrProviderUnavailable)

	slow := New(&fakeProvider{wait: make(chan struct{})}, Options{Timeout: 20 * time.Millisecond, MaxConcurrent: 1})
	_, err = slow.Synthesize(ctx, "x", "")
	assert.ErrorIs(t, err, domain.ErrTimeout)

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = newService(&fakeProvider{wait: make(chan struct{})}).Synthesize(cancelled, "x", "")
	assert.True(t, errors.Is(err, context.Canceled), "a client that gave up is not a provider failure")
}

// Covers CA-11 (RN-08): the third request is refused at once, and a finished
// synthesis frees its slot.
func TestSynthesizeConcurrencyLimit(t *testing.T) {
	release := make(chan struct{})
	p := &fakeProvider{wait: release, res: speech.Result{Audio: []byte("a")}}
	s := New(p, Options{Timeout: time.Second, MaxConcurrent: 2})

	done := make(chan error, 2)
	for range 2 {
		go func() { _, err := s.Synthesize(context.Background(), "x", ""); done <- err }()
	}
	require.Eventually(t, func() bool { return len(s.slots) == 2 }, time.Second, time.Millisecond)

	_, err := s.Synthesize(context.Background(), "x", "")
	assert.ErrorIs(t, err, domain.ErrBusy)

	close(release)
	for range 2 {
		require.NoError(t, <-done)
	}
	_, err = s.Synthesize(context.Background(), "x", "")
	assert.NoError(t, err, "the slots were released")
}
