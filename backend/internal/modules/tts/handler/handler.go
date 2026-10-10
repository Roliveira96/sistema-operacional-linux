// Package handler serves the guided voice reader route (SPEC-017).
package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/tts/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// maxBodyBytes bounds the request body: 2000 characters of up to 4 bytes each
// plus the JSON envelope.
const maxBodyBytes = 16 << 10

// Service is what the handler needs from the service layer.
type Service interface {
	Synthesize(ctx context.Context, text, voice string) (domain.SpeechSynthesis, error)
}

// Limiter is the per-user rate limiter (RN-08).
type Limiter interface {
	Allow(key string) (bool, time.Duration)
}

// Handler serves the route.
type Handler struct {
	svc     Service
	auth    authn.Validator
	limiter Limiter
	log     *zap.Logger
}

// New creates the handler.
func New(svc Service, auth authn.Validator, limiter Limiter, log *zap.Logger) *Handler {
	return &Handler{svc: svc, auth: auth, limiter: limiter, log: log}
}

// Register mounts the route under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	authed := r.Group("", authn.Required(h.auth), authn.PasswordChanged())
	authed.POST("/speech-syntheses", h.synthesize)
}

type synthesizeRequest struct {
	Text  string `json:"text"`
	Voice string `json:"voice"`
}

type synthesizeResponse struct {
	AudioBase64 string              `json:"audioBase64"`
	MimeType    string              `json:"mimeType"`
	Voice       string              `json:"voice"`
	Words       []domain.WordTiming `json:"words"`
}

func (h *Handler) synthesize(c *gin.Context) {
	principal, _ := authn.FromContext(c.Request.Context())
	if allowed, retry := h.limiter.Allow(principal.UserID.String()); !allowed {
		fail(c, problem.TooManyRequests("Too many speech requests. Try again later.", int(math.Ceil(retry.Seconds()))))
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	var req synthesizeRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, problem.Validation("The text is too long.", problem.InvalidParam{Name: "text", Reason: "too long"}))
			return
		}
		fail(c, problem.Validation("The request body must be a JSON object with a text."))
		return
	}

	start := time.Now()
	out, err := h.svc.Synthesize(c.Request.Context(), req.Text, req.Voice)
	if err != nil {
		h.fail(c, err, len([]rune(req.Text)), req.Voice, time.Since(start))
		return
	}
	// The text itself is never logged, only its size (CA-14).
	logger.FromContext(c.Request.Context(), h.log).Debug("speech synthesized",
		zap.Int("chars", len([]rune(req.Text))), zap.String("voice", out.Voice), zap.Duration("took", time.Since(start)))
	c.JSON(http.StatusOK, synthesizeResponse{
		AudioBase64: base64.StdEncoding.EncodeToString(out.Audio),
		MimeType:    out.MimeType,
		Voice:       out.Voice,
		Words:       out.Words,
	})
}

// fail maps a service error to a problem and logs the unexpected ones once.
func (h *Handler) fail(c *gin.Context, err error, chars int, voice string, took time.Duration) {
	log := logger.FromContext(c.Request.Context(), h.log).With(
		zap.Int("chars", chars), zap.String("voice", voice), zap.Duration("took", took))
	switch {
	case errors.Is(err, domain.ErrEmptyText):
		err = problem.Validation("The text is required.", problem.InvalidParam{Name: "text", Reason: "required"})
	case errors.Is(err, domain.ErrTextTooLong):
		err = problem.Validation("The text exceeds 2000 characters.", problem.InvalidParam{Name: "text", Reason: "too long"})
	case errors.Is(err, domain.ErrInvalidVoice):
		err = problem.Validation("The voice is not allowed.", problem.InvalidParam{Name: "voice", Reason: "invalid value"})
	case errors.Is(err, domain.ErrBusy):
		err = problem.New(http.StatusServiceUnavailable, "speech-busy", "Too many speech syntheses are running. Try again shortly.")
	case errors.Is(err, domain.ErrTimeout):
		log.Warn("speech synthesis timed out", zap.Error(err))
		err = problem.New(http.StatusGatewayTimeout, "speech-timeout", "The speech synthesis took too long.")
	case errors.Is(err, domain.ErrProviderUnavailable):
		log.Error("speech provider unreachable", zap.Error(err))
		err = problem.New(http.StatusServiceUnavailable, "speech-unavailable", "The speech service is unavailable.")
	case errors.Is(err, domain.ErrProviderFailed):
		log.Error("speech provider failed", zap.Error(err))
		err = problem.New(http.StatusBadGateway, "speech-provider-failed", "The speech service failed to synthesize the text.")
	case errors.Is(err, context.Canceled):
		// The client gave up; there is nobody to answer.
		c.Abort()
		return
	}
	fail(c, err)
}

func fail(c *gin.Context, err error) {
	_ = c.Error(err)
	c.Abort()
}
