// Package middleware holds the global Gin middlewares: correlation ID,
// request logging, panic recovery and RFC 7807 error rendering.
package middleware

import (
	"errors"
	"net/http"
	"runtime/debug"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// RequestIDHeader carries the correlation ID in requests and responses.
const RequestIDHeader = "X-Request-ID"

// CorrelationID reuses a valid UUID received in X-Request-ID or generates a
// UUIDv7, echoes it in the response and stores a request-scoped logger
// carrying it in the request context.
func CorrelationID(base *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader(RequestIDHeader)
		if _, err := uuid.Parse(requestID); err != nil || len(requestID) != 36 {
			requestID = newRequestID()
		}
		c.Header(RequestIDHeader, requestID)

		reqLog := base.With(zap.String("request_id", requestID))
		c.Request = c.Request.WithContext(logger.WithContext(c.Request.Context(), reqLog))
		c.Next()
	}
}

func newRequestID() string {
	if id, err := uuid.NewV7(); err == nil {
		return id.String()
	}
	return uuid.NewString()
}

// AccessLog writes one entry per request after it has been handled.
func AccessLog(base *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		status := c.Writer.Status()
		fields := []zap.Field{
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", status),
			zap.Duration("latency", time.Since(start)),
			zap.String("client_ip", c.ClientIP()),
		}
		log := logger.FromContext(c.Request.Context(), base)
		if status >= http.StatusInternalServerError {
			log.Warn("request completed", fields...)
			return
		}
		log.Info("request completed", fields...)
	}
}

// Recovery turns a panic into a generic 500 problem and logs the stack once.
func Recovery(base *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.FromContext(c.Request.Context(), base).Error("panic recovered",
					zap.Any("panic", rec), zap.ByteString("stack", debug.Stack()))
				writeProblem(c, problem.Internal())
				c.Abort()
			}
		}()
		c.Next()
	}
}

// Errors renders the last error registered with c.Error as RFC 7807. A
// *problem.Problem is written as is; any other error becomes a generic 500
// and its detail is logged once, here.
func Errors(base *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if len(c.Errors) == 0 || c.Writer.Written() {
			return
		}

		err := c.Errors.Last().Err
		var p *problem.Problem
		if !errors.As(err, &p) {
			logger.FromContext(c.Request.Context(), base).Error("unhandled request error", zap.Error(err))
			p = problem.Internal()
		}
		writeProblem(c, p)
	}
}

// NoRoute answers unknown routes with a 404 problem.
func NoRoute(c *gin.Context) {
	writeProblem(c, problem.NotFound("route-not-found", "No route matches "+c.Request.URL.Path+"."))
}

func writeProblem(c *gin.Context, p *problem.Problem) {
	if p.Instance == "" {
		p.Instance = c.Request.URL.Path
	}
	if p.RetryAfterSeconds > 0 {
		c.Header("Retry-After", strconv.Itoa(p.RetryAfterSeconds))
	}
	body, err := p.MarshalJSON()
	if err != nil {
		body = []byte(`{"type":"internal-error","title":"Internal Server Error","status":500}`)
		p.Status = http.StatusInternalServerError
	}
	c.Data(p.Status, problem.ContentType, body)
}
