package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

func ok(context.Context) error   { return nil }
func down(context.Context) error { return errors.New("connection refused") }

func checks(postgres, minio, smtp func(context.Context) error) []Check {
	return []Check{
		{Name: "postgres", Critical: true, Ping: postgres},
		{Name: "minio", Ping: minio},
		{Name: "smtp", Ping: smtp},
	}
}

func serve(t *testing.T, cs []Check) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := server.NewEngine(zap.NewNop(), NewHandler(NewChecker(time.Second, cs...), "test", zap.NewNop()))
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid body %q: %v", rec.Body.String(), err)
	}
	return rec, body
}

func componentStatus(body map[string]any, name string) string {
	list, _ := body["components"].([]any)
	for _, item := range list {
		c, _ := item.(map[string]any)
		if c["name"] == name {
			s, _ := c["status"].(string)
			return s
		}
	}
	return ""
}

// Covers SPEC-004 CA-11.
func TestAllHealthy(t *testing.T) {
	rec, body := serve(t, checks(ok, ok, ok))
	if rec.Code != http.StatusOK || body["status"] != StatusHealthy || body["version"] != "test" {
		t.Errorf("unexpected response %d %v", rec.Code, body)
	}
}

// Covers SPEC-004 CA-12.
func TestNonCriticalFailureDegrades(t *testing.T) {
	for _, tc := range []struct {
		name        string
		minio, smtp func(context.Context) error
	}{
		{"minio", down, ok},
		{"smtp", ok, down},
	} {
		rec, body := serve(t, checks(ok, tc.minio, tc.smtp))
		if rec.Code != http.StatusOK || body["status"] != StatusDegraded {
			t.Errorf("%s down: unexpected response %d %v", tc.name, rec.Code, body)
		}
		if componentStatus(body, tc.name) != StatusUnhealthy {
			t.Errorf("%s down: component not marked unhealthy: %v", tc.name, body)
		}
	}
}

// Covers SPEC-004 CA-13.
func TestCriticalFailureIs503Problem(t *testing.T) {
	rec, body := serve(t, checks(down, ok, ok))
	if rec.Code != http.StatusServiceUnavailable || body["type"] != "service-unavailable" {
		t.Errorf("unexpected response %d %v", rec.Code, body)
	}
	if rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Errorf("content type = %q", rec.Header().Get("Content-Type"))
	}
	if componentStatus(body, "postgres") != StatusUnhealthy {
		t.Errorf("components missing from 503 body: %v", body)
	}
}

func TestSlowCheckTimesOut(t *testing.T) {
	slow := func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}
	start := time.Now()
	report := NewChecker(50*time.Millisecond, checks(ok, slow, ok)...).Run(context.Background())
	if time.Since(start) > time.Second || report.Status != StatusDegraded {
		t.Errorf("timeout not applied: %+v", report)
	}
}
