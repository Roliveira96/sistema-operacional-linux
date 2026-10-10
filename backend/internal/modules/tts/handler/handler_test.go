package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/tts/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeService struct {
	err    error
	text   string
	voice  string
	called bool
}

func (f *fakeService) Synthesize(_ context.Context, text, voice string) (domain.SpeechSynthesis, error) {
	f.called, f.text, f.voice = true, text, voice
	if f.err != nil {
		return domain.SpeechSynthesis{}, f.err
	}
	return domain.SpeechSynthesis{
		Audio: []byte("mp3"), MimeType: domain.MimeType, Voice: domain.DefaultVoice,
		Words: []domain.WordTiming{{Word: "Olá", StartMs: 100, EndMs: 425}},
	}, nil
}

type validator struct{ ok bool }

func (v validator) Authenticate(context.Context, string) (authn.Principal, error) {
	if !v.ok {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	return authn.Principal{UserID: uuid.MustParse("00000000-0000-0000-0000-000000000001"), Role: "STUDENT"}, nil
}

type result struct {
	code   int
	body   map[string]any
	header http.Header
	logs   *observer.ObservedLogs
}

func call(t *testing.T, svc *fakeService, auth bool, limit int, body string) result {
	t.Helper()
	gin.SetMode(gin.TestMode)
	core, logs := observer.New(zap.DebugLevel)
	log := zap.New(core)
	e := server.NewEngine(log, nil, New(svc, validator{ok: auth}, ratelimit.New(limit, time.Minute), log))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/speech-syntheses", strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	if rec.Body.Len() > 0 {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	}
	return result{code: rec.Code, body: out, header: rec.Header(), logs: logs}
}

// Covers CA-01 at the HTTP level.
func TestSynthesizeSuccess(t *testing.T) {
	svc := &fakeService{}
	r := call(t, svc, true, 20, `{"text":"Olá","voice":"pt-BR-AntonioNeural"}`)
	require.Equal(t, http.StatusOK, r.code)
	assert.Equal(t, "Olá", svc.text)
	assert.Equal(t, "pt-BR-AntonioNeural", svc.voice)
	audio, err := base64.StdEncoding.DecodeString(r.body["audioBase64"].(string))
	require.NoError(t, err)
	assert.Equal(t, "mp3", string(audio), "plain Base64, no data: prefix")
	assert.Equal(t, "audio/mpeg", r.body["mimeType"])
	assert.Equal(t, domain.DefaultVoice, r.body["voice"])
	words := r.body["words"].([]any)
	assert.Equal(t, map[string]any{"word": "Olá", "startMs": float64(100), "endMs": float64(425)}, words[0])
}

// Covers CA-10: visitors never reach the provider.
func TestSynthesizeRequiresSession(t *testing.T) {
	svc := &fakeService{}
	r := call(t, svc, false, 20, `{"text":"Olá"}`)
	assert.Equal(t, http.StatusUnauthorized, r.code)
	assert.Equal(t, "not-authenticated", r.body["type"])
	assert.False(t, svc.called)
}

// Covers CA-02, CA-03 and CA-09 plus the malformed bodies.
func TestSynthesizeValidation(t *testing.T) {
	cases := map[string]struct {
		err   error
		param string
	}{
		"empty": {domain.ErrEmptyText, "text"},
		"long":  {domain.ErrTextTooLong, "text"},
		"voice": {domain.ErrInvalidVoice, "voice"},
	}
	for name, c := range cases {
		r := call(t, &fakeService{err: c.err}, true, 20, `{"text":"x"}`)
		assert.Equal(t, http.StatusBadRequest, r.code, name)
		assert.Equal(t, "validation-error", r.body["type"], name)
		params := r.body["invalidParams"].([]any)
		assert.Equal(t, c.param, params[0].(map[string]any)["name"], name)
	}

	for _, bad := range []string{``, `not json`, `[]`} {
		svc := &fakeService{}
		r := call(t, svc, true, 20, bad)
		assert.Equal(t, http.StatusBadRequest, r.code, bad)
		assert.Equal(t, "validation-error", r.body["type"], bad)
		assert.False(t, svc.called)
	}

	huge := fmt.Sprintf(`{"text":%q}`, strings.Repeat("a", maxBodyBytes))
	svc := &fakeService{}
	r := call(t, svc, true, 20, huge)
	assert.Equal(t, http.StatusBadRequest, r.code)
	assert.False(t, svc.called, "an oversized body never reaches the service")
}

// Covers CA-07, CA-08, CA-11 and CA-13: error mapping.
func TestSynthesizeErrorMapping(t *testing.T) {
	cases := []struct {
		err  error
		code int
		typ  string
	}{
		{domain.ErrBusy, http.StatusServiceUnavailable, "speech-busy"},
		{domain.ErrTimeout, http.StatusGatewayTimeout, "speech-timeout"},
		{domain.ErrProviderUnavailable, http.StatusServiceUnavailable, "speech-unavailable"},
		{domain.ErrProviderFailed, http.StatusBadGateway, "speech-provider-failed"},
		{errors.New("boom"), http.StatusInternalServerError, "internal-error"},
	}
	for _, c := range cases {
		r := call(t, &fakeService{err: fmt.Errorf("wrapped: %w", c.err)}, true, 20, `{"text":"x"}`)
		assert.Equal(t, c.code, r.code, c.typ)
		assert.Equal(t, c.typ, r.body["type"])
	}
}

// Covers CA-12: the 21st request in a minute is refused with Retry-After.
func TestSynthesizeRateLimit(t *testing.T) {
	svc := &fakeService{}
	gin.SetMode(gin.TestMode)
	log := zap.NewNop()
	e := server.NewEngine(log, nil, New(svc, validator{ok: true}, ratelimit.New(2, time.Minute), log))
	send := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/speech-syntheses", bytes.NewReader([]byte(`{"text":"x"}`)))
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}
	assert.Equal(t, http.StatusOK, send().Code)
	assert.Equal(t, http.StatusOK, send().Code)
	rec := send()
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("Retry-After"))
}

// Covers CA-14: the text never appears in a log, success or failure.
func TestSynthesizeDoesNotLogText(t *testing.T) {
	secret := "segredo-do-texto"
	for _, err := range []error{nil, domain.ErrProviderFailed, domain.ErrTimeout, domain.ErrProviderUnavailable} {
		r := call(t, &fakeService{err: err}, true, 20, fmt.Sprintf(`{"text":%q}`, secret))
		require.NotZero(t, r.logs.Len(), "something is logged for %v", err)
		for _, entry := range r.logs.All() {
			assert.NotContains(t, fmt.Sprint(entry.Message, entry.ContextMap()), secret)
		}
	}
}

// A client that gave up gets no response and no error log.
func TestSynthesizeClientCancelled(t *testing.T) {
	r := call(t, &fakeService{err: context.Canceled}, true, 20, `{"text":"x"}`)
	assert.Empty(t, r.body)
	for _, entry := range r.logs.All() {
		assert.Less(t, entry.Level, zap.ErrorLevel)
	}
}
