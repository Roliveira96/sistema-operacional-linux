package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Covers SPEC-004 CA-06.
func TestProductionWritesOneJSONObjectPerLine(t *testing.T) {
	var buf bytes.Buffer
	log, flush, err := newWithSink(Options{Production: true, Level: "info"}, zapcore.AddSync(&buf))
	if err != nil {
		t.Fatal(err)
	}
	log.Info("first", zap.String("key", "value"))
	log.Debug("hidden")
	log.Warn("second")
	flush()

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d: %q", len(lines), buf.String())
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("line is not JSON: %v", err)
	}
	if entry["msg"] != "first" || entry["key"] != "value" || entry["level"] != "info" {
		t.Errorf("unexpected entry: %v", entry)
	}
}

func TestDevelopmentWritesConsoleFormat(t *testing.T) {
	var buf bytes.Buffer
	log, flush, err := newWithSink(Options{Production: false, Level: "debug"}, zapcore.AddSync(&buf))
	if err != nil {
		t.Fatal(err)
	}
	log.Debug("visible")
	flush()

	out := buf.String()
	if !strings.Contains(out, "visible") || strings.HasPrefix(strings.TrimSpace(out), "{") {
		t.Errorf("expected console output, got %q", out)
	}
}

func TestInvalidLevelFails(t *testing.T) {
	if _, _, err := New(Options{Level: "verbose"}); err == nil {
		t.Fatal("expected an error")
	}
}

func TestFromContextFallsBack(t *testing.T) {
	fallback := zap.NewNop()
	if FromContext(context.Background(), fallback) != fallback {
		t.Error("expected fallback logger")
	}
	scoped := zap.NewExample()
	if FromContext(WithContext(context.Background(), scoped), fallback) != scoped {
		t.Error("expected scoped logger")
	}
}
