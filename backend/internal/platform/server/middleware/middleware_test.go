package middleware

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

func newTestEngine(log *zap.Logger) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(CorrelationID(log), AccessLog(log), Recovery(log), Errors(log))
	e.NoRoute(NoRoute)
	return e
}

func do(e *gin.Engine, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != problem.ContentType {
		t.Fatalf("content type = %q", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid body %q: %v", rec.Body.String(), err)
	}
	return body
}

// Covers SPEC-004 CA-05.
func TestCorrelationIDPropagatesToResponseAndLogs(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	e := newTestEngine(zap.New(core))
	e.GET("/x", func(c *gin.Context) {
		logger.FromContext(c.Request.Context(), zap.NewNop()).Info("inside handler")
		c.Status(http.StatusNoContent)
	})

	t.Run("generates a UUIDv7 when absent", func(t *testing.T) {
		logs.TakeAll()
		rec := do(e, httptest.NewRequest(http.MethodGet, "/x", nil))
		id, err := uuid.Parse(rec.Header().Get(RequestIDHeader))
		if err != nil || id.Version() != 7 {
			t.Fatalf("expected UUIDv7, got %q", rec.Header().Get(RequestIDHeader))
		}
		entries := logs.TakeAll()
		if len(entries) != 2 {
			t.Fatalf("expected handler and access log entries, got %d", len(entries))
		}
		for _, entry := range entries {
			if entry.ContextMap()["request_id"] != id.String() {
				t.Errorf("entry %q without request_id", entry.Message)
			}
		}
	})

	t.Run("reuses a valid incoming ID", func(t *testing.T) {
		const incoming = "0192d8a4-1111-7000-8000-000000000001"
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.Header.Set(RequestIDHeader, incoming)
		if got := do(e, req).Header().Get(RequestIDHeader); got != incoming {
			t.Errorf("got %q", got)
		}
	})

	t.Run("replaces an invalid incoming ID", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.Header.Set(RequestIDHeader, "<script>")
		if got := do(e, req).Header().Get(RequestIDHeader); got == "<script>" {
			t.Error("invalid ID was echoed")
		}
	})
}

// Covers SPEC-004 CA-07.
func TestMappedProblemIsRendered(t *testing.T) {
	e := newTestEngine(zap.NewNop())
	e.GET("/conflict", func(c *gin.Context) {
		_ = c.Error(problem.Conflict("email-already-registered", "E-mail already registered."))
	})
	e.GET("/limited", func(c *gin.Context) {
		_ = c.Error(problem.TooManyRequests("Slow down.", 42))
	})

	rec := do(e, httptest.NewRequest(http.MethodGet, "/conflict", nil))
	body := decode(t, rec)
	if rec.Code != http.StatusConflict || body["type"] != "email-already-registered" || body["instance"] != "/conflict" {
		t.Errorf("unexpected response %d %v", rec.Code, body)
	}

	rec = do(e, httptest.NewRequest(http.MethodGet, "/limited", nil))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "42" {
		t.Errorf("unexpected response %d retry-after=%q", rec.Code, rec.Header().Get("Retry-After"))
	}
}

// Covers SPEC-004 CA-08.
func TestUnmappedErrorAndPanicBecomeGeneric500LoggedOnce(t *testing.T) {
	core, logs := observer.New(zapcore.ErrorLevel)
	e := newTestEngine(zap.New(core))
	e.GET("/err", func(c *gin.Context) {
		_ = c.Error(errors.New("pq: password authentication failed for user secret"))
	})
	e.GET("/panic", func(c *gin.Context) { panic("boom") })

	for _, path := range []string{"/err", "/panic"} {
		logs.TakeAll()
		rec := do(e, httptest.NewRequest(http.MethodGet, path, nil))
		body := decode(t, rec)
		if rec.Code != http.StatusInternalServerError || body["type"] != "internal-error" {
			t.Errorf("%s: unexpected response %d %v", path, rec.Code, body)
		}
		if detail, _ := body["detail"].(string); detail != problem.Internal().Detail {
			t.Errorf("%s: internal detail leaked: %q", path, detail)
		}
		if n := logs.Len(); n != 1 {
			t.Errorf("%s: expected exactly one error log, got %d", path, n)
		}
	}
}

func TestNoRouteReturnsProblem(t *testing.T) {
	rec := do(newTestEngine(zap.NewNop()), httptest.NewRequest(http.MethodGet, "/missing", nil))
	if body := decode(t, rec); rec.Code != http.StatusNotFound || body["type"] != "route-not-found" {
		t.Errorf("unexpected response %d %v", rec.Code, body)
	}
}
