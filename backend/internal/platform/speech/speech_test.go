package speech

import (
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// textFrame builds a text frame the way the service sends it.
func textFrame(path, body string) []byte {
	return []byte("X-RequestId:abc\r\nPath:" + path + "\r\n\r\n" + body)
}

// audioFrame builds a binary frame: 2-byte header length, header, audio.
func audioFrame(audio string) []byte {
	header := "X-RequestId:abc\r\nPath:audio\r\n"
	out := binary.BigEndian.AppendUint16(nil, uint16(len(header)))
	return append(append(out, header...), audio...)
}

const metadataBody = `{"Metadata":[` +
	`{"Type":"WordBoundary","Data":{"Offset":1000000,"Duration":3250000,"text":{"Text":"Olá","Length":3,"BoundaryType":"WordBoundary"}}},` +
	`{"Type":"WordBoundary","Data":{"Offset":4620000,"Duration":3630000,"text":{"Text":"&amp;","Length":1,"BoundaryType":"WordBoundary"}}},` +
	`{"Type":"SessionEnd","Data":{"Offset":9000000}}]}`

type frame struct {
	kind int
	data []byte
}

// serve starts a fake service that reads the two client messages, then plays
// the frames. It returns the client and the messages received.
func serve(t *testing.T, play func(c *websocket.Conn)) (*Client, chan string) {
	t.Helper()
	received := make(chan string, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for range 2 {
			_, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			received <- string(msg)
		}
		play(c)
	}))
	t.Cleanup(srv.Close)
	return NewClientForURL("ws" + strings.TrimPrefix(srv.URL, "http")), received
}

func send(c *websocket.Conn, frames ...frame) {
	for _, f := range frames {
		_ = c.WriteMessage(f.kind, f.data)
	}
}

func synth(c *Client) (Result, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return c.Synthesize(ctx, "<speak/>")
}

// Covers SPEC-017 CA-01 and CA-06: audio in parts, word timings converted from
// 100 ns ticks to milliseconds, escaped words unescaped.
func TestSynthesizeFullTurn(t *testing.T) {
	c, received := serve(t, func(c *websocket.Conn) {
		send(c,
			frame{websocket.TextMessage, textFrame("turn.start", `{}`)},
			frame{websocket.TextMessage, textFrame("response", `{}`)},
			frame{websocket.BinaryMessage, audioFrame("aaa")},
			frame{websocket.TextMessage, textFrame("audio.metadata", metadataBody)},
			frame{websocket.BinaryMessage, audioFrame("bbb")},
			frame{websocket.TextMessage, textFrame("turn.end", `{}`)},
		)
	})
	res, err := synth(c)
	require.NoError(t, err)
	assert.Equal(t, "aaabbb", string(res.Audio))
	assert.Equal(t, []Word{{Text: "Olá", StartMs: 100, EndMs: 425}, {Text: "&", StartMs: 462, EndMs: 825}}, res.Words)

	config, ssml := <-received, <-received
	assert.Contains(t, config, "Path:speech.config")
	assert.Contains(t, config, `"wordBoundaryEnabled":"true"`)
	assert.Contains(t, config, "audio-24khz-48kbitrate-mono-mp3")
	assert.Contains(t, ssml, "Path:ssml")
	assert.True(t, strings.HasSuffix(ssml, "<speak/>"))
}

// Covers SPEC-017 CA-07 (RN-06): a stream that breaks, ends without audio or
// misbehaves is an error, never partial audio.
func TestSynthesizeFailures(t *testing.T) {
	cases := map[string][]frame{
		"dropped before the end": {
			{websocket.TextMessage, textFrame("turn.start", `{}`)},
			{websocket.BinaryMessage, audioFrame("aaa")},
		},
		"turn ends without audio": {
			{websocket.TextMessage, textFrame("turn.start", `{}`)},
			{websocket.TextMessage, textFrame("turn.end", `{}`)},
		},
		"audio before the turn starts": {
			{websocket.BinaryMessage, audioFrame("aaa")},
		},
		"audio frame without header length": {
			{websocket.TextMessage, textFrame("turn.start", `{}`)},
			{websocket.BinaryMessage, []byte{1}},
		},
		"audio frame shorter than its header": {
			{websocket.TextMessage, textFrame("turn.start", `{}`)},
			{websocket.BinaryMessage, []byte{0, 50, 'x'}},
		},
		"invalid metadata": {
			{websocket.TextMessage, textFrame("turn.start", `{}`)},
			{websocket.TextMessage, textFrame("audio.metadata", `not json`)},
		},
	}
	for name, frames := range cases {
		c, _ := serve(t, func(c *websocket.Conn) { send(c, frames...) })
		res, err := synth(c)
		assert.ErrorIs(t, err, ErrFailed, name)
		assert.Empty(t, res.Audio, name)
	}
}

func TestSynthesizeRejectsOversizedAudio(t *testing.T) {
	chunk := strings.Repeat("a", 1<<20)
	c, _ := serve(t, func(c *websocket.Conn) {
		send(c, frame{websocket.TextMessage, textFrame("turn.start", `{}`)})
		for range 9 {
			send(c, frame{websocket.BinaryMessage, audioFrame(chunk)})
		}
	})
	_, err := synth(c)
	assert.ErrorIs(t, err, ErrFailed)
}

// Covers SPEC-017 CA-08 (RN-05): the deadline closes the connection and is
// reported as the context error, not as a provider failure.
func TestSynthesizeDeadline(t *testing.T) {
	c, _ := serve(t, func(c *websocket.Conn) {
		send(c, frame{websocket.TextMessage, textFrame("turn.start", `{}`)})
		time.Sleep(2 * time.Second)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := c.Synthesize(ctx, "<speak/>")
	assert.ErrorIs(t, err, context.DeadlineExceeded)
	assert.NotErrorIs(t, err, ErrFailed)
	assert.Less(t, time.Since(start), time.Second)
}

// Covers SPEC-017 CA-13.
func TestSynthesizeUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	srv.Close()
	_, err := synth(NewClientForURL(url))
	assert.ErrorIs(t, err, ErrUnavailable)

	// A server that refuses the upgrade is also unreachable for this purpose.
	srv = httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	_, err = synth(NewClientForURL("ws" + strings.TrimPrefix(srv.URL, "http")))
	assert.ErrorIs(t, err, ErrUnavailable)
}

func TestParseText(t *testing.T) {
	path, body := parseText(textFrame("audio.metadata", "{}"))
	assert.Equal(t, "audio.metadata", path)
	assert.Equal(t, "{}", string(body))

	path, _ = parseText([]byte("no headers at all"))
	assert.Empty(t, path)
}

// The validation token changes every 5 minutes and carries the client token.
func TestConnectURL(t *testing.T) {
	at := time.Date(2026, 10, 9, 12, 0, 1, 0, time.UTC)
	a := connectURL(at)
	assert.Contains(t, a, "TrustedClientToken="+trustedClientToken)
	assert.Contains(t, a, "Sec-MS-GEC-Version=1-"+chromiumVersion)
	token := func(u string) string {
		_, rest, _ := strings.Cut(u, "Sec-MS-GEC=")
		tok, _, _ := strings.Cut(rest, "&")
		return tok
	}
	assert.Len(t, token(a), 64)
	assert.Equal(t, token(a), token(connectURL(at.Add(4*time.Minute))), "same 5-minute window")
	assert.NotEqual(t, token(a), token(connectURL(at.Add(6*time.Minute))), "next window")
}

func TestTimestampAndMessages(t *testing.T) {
	stamp := timestamp(time.Date(2026, 10, 9, 12, 0, 1, 0, time.UTC))
	assert.Equal(t, "Fri Oct 09 2026 12:00:01 GMT+0000 (Coordinated Universal Time)", stamp)
	msg := ssmlMessage("1234-5678", stamp, "<speak/>")
	assert.Contains(t, msg, "X-RequestId:12345678\r\n")
	assert.Contains(t, msg, "Path:ssml\r\n\r\n<speak/>")
}
