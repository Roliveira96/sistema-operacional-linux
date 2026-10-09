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

		"ADMIN_INITIAL_PASSWORD": "a-long-initial-password",
		"APP_PUBLIC_URL":         "http://192.168.3.111:3010/",
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

func TestLoadAuthSettings(t *testing.T) {
	env := validEnv()
	env["HTTP_TRUSTED_PROXIES"] = "192.168.3.111, 10.0.0.0/8"
	cfg, err := LoadFrom(lookupFrom(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Auth.AdminEmail != "admin@rmo.dev.br" || cfg.Auth.PublicURL != "http://192.168.3.111:3010" {
		t.Errorf("unexpected auth config: %+v", cfg.Auth)
	}
	if len(cfg.TrustedProxies) != 2 || !cfg.IsDevelopment() {
		t.Errorf("unexpected proxies %v", cfg.TrustedProxies)
	}
}

func TestLoadRejectsInvalidAuthSettings(t *testing.T) {
	env := validEnv()
	delete(env, "ADMIN_INITIAL_PASSWORD")
	env["APP_PUBLIC_URL"] = "ftp://host"
	env["HTTP_TRUSTED_PROXIES"] = "not-an-ip"
	_, err := LoadFrom(lookupFrom(env))
	for _, key := range []string{"ADMIN_INITIAL_PASSWORD", "APP_PUBLIC_URL", "HTTP_TRUSTED_PROXIES"} {
		if err == nil || !strings.Contains(err.Error(), key) {
			t.Errorf("error does not mention %s: %v", key, err)
		}
	}
}

// Covers SPEC-017 RN-05 and RN-08 defaults and validation.
func TestLoadTTS(t *testing.T) {
	cfg, err := LoadFrom(lookupFrom(validEnv()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.TTS.Timeout != 15*time.Second || cfg.TTS.MaxConcurrent != 4 || cfg.TTS.RatePerMinute != 60 {
		t.Errorf("unexpected TTS defaults: %+v", cfg.TTS)
	}

	env := validEnv()
	env["TTS_TIMEOUT"] = "30s"
	env["TTS_MAX_CONCURRENT"] = "2"
	env["TTS_RATE_PER_MINUTE"] = "120"
	cfg, err = LoadFrom(lookupFrom(env))
	if err != nil || cfg.TTS.Timeout != 30*time.Second || cfg.TTS.MaxConcurrent != 2 || cfg.TTS.RatePerMinute != 120 {
		t.Errorf("unexpected TTS config: %+v (%v)", cfg.TTS, err)
	}

	env["TTS_TIMEOUT"] = "soon"
	env["TTS_MAX_CONCURRENT"] = "0"
	env["TTS_RATE_PER_MINUTE"] = "-1"
	_, err = LoadFrom(lookupFrom(env))
	if err == nil || !strings.Contains(err.Error(), "TTS_TIMEOUT") || !strings.Contains(err.Error(), "TTS_MAX_CONCURRENT") || !strings.Contains(err.Error(), "TTS_RATE_PER_MINUTE") {
		t.Errorf("expected both TTS variables reported, got %v", err)
	}
}
