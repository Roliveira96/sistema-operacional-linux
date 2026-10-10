// Package speech is the client of the Edge read-aloud speech service, an
// unofficial endpoint of the browser (SPEC-017, risks). It speaks the
// WebSocket protocol directly and returns the audio and the word timings.
package speech

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	trustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
	chromiumVersion    = "143.0.3650.75"
	endpoint           = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"
	// maxAudioBytes bounds the memory of one synthesis.
	maxAudioBytes = 8 << 20
	// ticksPerMs converts the 100 ns units of the service to milliseconds (RN-07).
	ticksPerMs = 10_000
)

// Errors returned by the client.
var (
	// ErrUnavailable means the service could not be reached.
	ErrUnavailable = errors.New("speech: service unreachable")
	// ErrFailed means the service answered badly or the stream broke.
	ErrFailed = errors.New("speech: synthesis failed")
)

// Word is one spoken word with its timing in milliseconds.
type Word struct {
	Text    string
	StartMs int64
	EndMs   int64
}

// Result is the complete audio of one synthesis and its word timings.
type Result struct {
	Audio []byte
	Words []Word
}

// Client talks to the speech service.
type Client struct {
	url    func() string
	dialer *websocket.Dialer
	now    func() time.Time
}

// NewClient creates a client for the real service.
func NewClient() *Client {
	c := &Client{dialer: websocket.DefaultDialer, now: time.Now}
	c.url = func() string { return connectURL(c.now()) }
	return c
}

// NewClientForURL creates a client for another WebSocket address, for tests.
func NewClientForURL(url string) *Client {
	return &Client{url: func() string { return url }, dialer: websocket.DefaultDialer, now: time.Now}
}

// Synthesize sends ssml and collects the whole turn. It succeeds only when the
// service ends the turn normally with some audio (RN-06); ctx cancels it (RN-05).
func (c *Client) Synthesize(ctx context.Context, ssml string) (Result, error) {
	conn, _, err := c.dialer.DialContext(ctx, c.url(), requestHeader())
	if err != nil {
		return Result{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	defer conn.Close()
	// ReadMessage does not take a context: closing the connection unblocks it.
	defer context.AfterFunc(ctx, func() { _ = conn.Close() })()

	stamp := timestamp(c.now())
	if err := conn.WriteMessage(websocket.TextMessage, []byte(configMessage(stamp))); err != nil {
		return Result{}, failure(ctx, err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, []byte(ssmlMessage(uuid.NewString(), stamp, ssml))); err != nil {
		return Result{}, failure(ctx, err)
	}

	var res Result
	receiving := false
	for {
		kind, data, err := conn.ReadMessage()
		if err != nil {
			return Result{}, failure(ctx, err)
		}
		switch kind {
		case websocket.TextMessage:
			path, body := parseText(data)
			switch path {
			case "turn.start":
				receiving = true
			case "audio.metadata":
				words, err := parseWords(body)
				if err != nil {
					return Result{}, fmt.Errorf("%w: %w", ErrFailed, err)
				}
				res.Words = append(res.Words, words...)
			case "turn.end":
				if len(res.Audio) == 0 {
					return Result{}, fmt.Errorf("%w: no audio received", ErrFailed)
				}
				return res, nil
			}
		case websocket.BinaryMessage:
			if !receiving {
				return Result{}, fmt.Errorf("%w: unexpected audio frame", ErrFailed)
			}
			audio, err := parseAudio(data)
			if err != nil {
				return Result{}, fmt.Errorf("%w: %w", ErrFailed, err)
			}
			if len(res.Audio)+len(audio) > maxAudioBytes {
				return Result{}, fmt.Errorf("%w: audio too large", ErrFailed)
			}
			res.Audio = append(res.Audio, audio...)
		}
	}
}

// failure prefers the context error, since closing the connection on timeout
// or cancellation is what surfaces as a read error.
func failure(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return fmt.Errorf("%w: %w", ErrFailed, err)
}

// parseText splits a text frame into its Path header and body.
func parseText(data []byte) (path string, body []byte) {
	head, body, _ := bytes.Cut(data, []byte("\r\n\r\n"))
	for _, line := range strings.Split(string(head), "\r\n") {
		if k, v, ok := strings.Cut(line, ":"); ok && strings.TrimSpace(k) == "Path" {
			return strings.TrimSpace(v), body
		}
	}
	return "", body
}

// parseAudio drops the header of a binary frame: a 2-byte big-endian length
// followed by that many header bytes, then the audio.
func parseAudio(data []byte) ([]byte, error) {
	if len(data) < 2 {
		return nil, errors.New("audio frame without header length")
	}
	end := 2 + int(binary.BigEndian.Uint16(data))
	if len(data) < end {
		return nil, errors.New("audio frame shorter than its header")
	}
	return data[end:], nil
}

type metadata struct {
	Metadata []struct {
		Type string `json:"Type"`
		Data struct {
			Offset   int64 `json:"Offset"`
			Duration int64 `json:"Duration"`
			Text     struct {
				Text string `json:"Text"`
			} `json:"text"`
		} `json:"Data"`
	} `json:"Metadata"`
}

// parseWords reads the WordBoundary entries of an audio.metadata body,
// unescapes the words and converts the 100 ns ticks to milliseconds (RN-07).
func parseWords(body []byte) ([]Word, error) {
	var m metadata
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("invalid metadata: %w", err)
	}
	var words []Word
	for _, e := range m.Metadata {
		if e.Type != "WordBoundary" {
			continue
		}
		words = append(words, Word{
			// The service echoes the word as it appears in the SSML, escaped.
			Text:    html.UnescapeString(e.Data.Text.Text),
			StartMs: e.Data.Offset / ticksPerMs,
			EndMs:   (e.Data.Offset + e.Data.Duration) / ticksPerMs,
		})
	}
	return words, nil
}

func requestHeader() http.Header {
	major, _, _ := strings.Cut(chromiumVersion, ".")
	h := http.Header{}
	h.Set("Pragma", "no-cache")
	h.Set("Cache-Control", "no-cache")
	h.Set("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
	h.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"+
		major+".0.0.0 Safari/537.36 Edg/"+major+".0.0.0")
	return h
}

// connectURL builds the service address with the time-based validation token
// the service requires (Sec-MS-GEC): the clock rounded down to 5 minutes, in
// Windows file-time ticks, hashed with the client token.
func connectURL(now time.Time) string {
	ticks := (now.UTC().Unix() + 11644473600) * 10_000_000
	ticks -= ticks % 3_000_000_000
	sum := sha256.Sum256(fmt.Appendf(nil, "%d%s", ticks, trustedClientToken))
	return fmt.Sprintf("%s?TrustedClientToken=%s&Sec-MS-GEC=%X&Sec-MS-GEC-Version=1-%s&ConnectionId=%s",
		endpoint, trustedClientToken, sum, chromiumVersion, strings.ReplaceAll(uuid.NewString(), "-", ""))
}

func timestamp(now time.Time) string {
	return now.UTC().Format("Mon Jan 02 2006 15:04:05") + " GMT+0000 (Coordinated Universal Time)"
}

// configMessage asks for word boundaries and MP3 audio.
func configMessage(stamp string) string {
	return "X-Timestamp:" + stamp + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
		`{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},` +
		`"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}` + "\r\n"
}

func ssmlMessage(requestID, stamp, ssml string) string {
	return "X-RequestId:" + strings.ReplaceAll(requestID, "-", "") +
		"\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + stamp + "Z\r\nPath:ssml\r\n\r\n" + ssml
}
