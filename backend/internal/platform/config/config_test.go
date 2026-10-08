package config

import (
	"strings"
	"testing"
	"time"
)

func validEnv() map[string]string {
	return map[string]string{
		"DB_HOST":          "localhost",
		"DB_NAME":          "linux_lab",
		"DB_USER":          "user",
		"DB_PASSWORD":      "secret",
		"MINIO_ENDPOINT":   "localhost:9000",
		"MINIO_ACCESS_KEY": "key",
		"MINIO_SECRET_KEY": "secret",
		"MINIO_BUCKET":     "bucket",
		"SMTP_HOST":        "localhost",
		"SMTP_PORT":        "1025",
		"SMTP_FROM":        "no-reply@example.com",
	}
}

func lookupFrom(env map[string]string) LookupFunc {
	return func(key string) (string, bool) {
		v, ok := env[key]
		return v, ok
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	cfg, err := LoadFrom(lookupFrom(validEnv()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AppEnv != EnvDevelopment || cfg.HTTPAddr != ":8080" || cfg.LogLevel != "debug" {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
	if cfg.ShutdownTimeout != 15*time.Second {
		t.Errorf("shutdown timeout = %v", cfg.ShutdownTimeout)
	}
	if cfg.Database.Port != 5432 || cfg.Database.Schema != "linux_lab" || cfg.Database.MaxOpenConns != 25 {
		t.Errorf("unexpected database defaults: %+v", cfg.Database)
	}
	if cfg.Mail.Workers != 2 || cfg.Storage.UseSSL {
		t.Errorf("unexpected defaults: %+v %+v", cfg.Mail, cfg.Storage)
	}
}

func TestLoadProductionDefaultsToInfoLevel(t *testing.T) {
	env := validEnv()
	env["APP_ENV"] = EnvProduction
	cfg, err := LoadFrom(lookupFrom(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.IsProduction() || cfg.LogLevel != "info" {
		t.Errorf("got env=%s level=%s", cfg.AppEnv, cfg.LogLevel)
	}
}

// Covers SPEC-004 CA-02: every failure is reported at once.
func TestLoadReportsAllFailuresAtOnce(t *testing.T) {
	env := validEnv()
	delete(env, "DB_HOST")
	delete(env, "MINIO_BUCKET")
	env["SMTP_PORT"] = "99999"
	env["APP_ENV"] = "staging"
	env["DB_SCHEMA"] = "project-manager"
	env["SHUTDOWN_TIMEOUT"] = "soon"

	_, err := LoadFrom(lookupFrom(env))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, key := range []string{"DB_HOST", "MINIO_BUCKET", "SMTP_PORT", "APP_ENV", "DB_SCHEMA", "SHUTDOWN_TIMEOUT"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error does not mention %s: %v", key, err)
		}
	}
}

func TestLoadTreatsBlankAsMissing(t *testing.T) {
	env := validEnv()
	env["DB_PASSWORD"] = "   "
	if _, err := LoadFrom(lookupFrom(env)); err == nil || !strings.Contains(err.Error(), "DB_PASSWORD") {
		t.Fatalf("expected DB_PASSWORD error, got %v", err)
	}
}
