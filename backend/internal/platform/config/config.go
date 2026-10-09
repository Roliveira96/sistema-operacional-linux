// Package config loads and validates the application configuration from
// environment variables. Loading fails with every problem listed at once.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environment names accepted by APP_ENV.
const (
	EnvDevelopment = "development"
	EnvProduction  = "production"
)

// Config is the complete, validated application configuration.
type Config struct {
	AppEnv          string
	HTTPAddr        string
	LogLevel        string
	ShutdownTimeout time.Duration
	// TrustedProxies lists the proxy addresses (the Next.js server) whose
	// X-Forwarded-For header is trusted to resolve the client IP.
	TrustedProxies []string
	Database       DatabaseConfig
	Storage        StorageConfig
	Mail           MailConfig
	Auth           AuthConfig
	TTS            TTSConfig
}

// TTSConfig holds the guided voice reader limits (SPEC-017).
type TTSConfig struct {
	Timeout       time.Duration
	MaxConcurrent int
}

// AuthConfig holds authentication settings (SPEC-003, SPEC-008).
type AuthConfig struct {
	AdminEmail           string
	AdminInitialPassword string
	// PublicURL is the frontend address used in e-mail links.
	PublicURL string
	Google    GoogleOAuthConfig
}

// GoogleOAuthConfig holds Google OAuth2 credentials (SPEC-008).
type GoogleOAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

// DatabaseConfig holds PostgreSQL connection and pool settings.
type DatabaseConfig struct {
	Host            string
	Port            int
	Name            string
	User            string
	Password        string
	Schema          string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

// StorageConfig holds MinIO settings.
type StorageConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

// MailConfig holds SMTP and mail dispatcher settings.
type MailConfig struct {
	Host     string
	Port     int
	From     string
	Username string
	Password string
	Workers  int
}

// IsDevelopment reports whether the application runs in development mode.
func (c Config) IsDevelopment() bool {
	return c.AppEnv == EnvDevelopment
}

// IsProduction reports whether the application runs in production mode.
func (c Config) IsProduction() bool {
	return c.AppEnv == EnvProduction
}

// LookupFunc returns the value of an environment variable and whether it is set.
type LookupFunc func(key string) (string, bool)

// Load reads the configuration from the process environment.
func Load() (Config, error) {
	return LoadFrom(os.LookupEnv)
}

// LoadFrom reads the configuration using the given lookup function.
// Every missing or invalid variable is reported in a single joined error.
func LoadFrom(lookup LookupFunc) (Config, error) {
	r := reader{lookup: lookup}

	cfg := Config{
		AppEnv:          r.oneOf("APP_ENV", EnvDevelopment, EnvDevelopment, EnvProduction),
		HTTPAddr:        r.optional("HTTP_ADDR", ":8080"),
		ShutdownTimeout: r.duration("SHUTDOWN_TIMEOUT", 15*time.Second),
		TrustedProxies:  r.ipList("HTTP_TRUSTED_PROXIES"),
		Database: DatabaseConfig{
			Host:            r.required("DB_HOST"),
			Port:            r.port("DB_PORT", 5432),
			Name:            r.required("DB_NAME"),
			User:            r.required("DB_USER"),
			Password:        r.required("DB_PASSWORD"),
			Schema:          r.identifier("DB_SCHEMA", "linux_lab"),
			MaxOpenConns:    r.positiveInt("DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:    r.positiveInt("DB_MAX_IDLE_CONNS", 5),
			ConnMaxLifetime: r.duration("DB_CONN_MAX_LIFETIME", 30*time.Minute),
		},
		Storage: StorageConfig{
			Endpoint:  r.required("MINIO_ENDPOINT"),
			AccessKey: r.required("MINIO_ACCESS_KEY"),
			SecretKey: r.required("MINIO_SECRET_KEY"),
			Bucket:    r.required("MINIO_BUCKET"),
			UseSSL:    r.boolean("MINIO_USE_SSL", false),
		},
		Mail: MailConfig{
			Host:     r.required("SMTP_HOST"),
			Port:     r.requiredPort("SMTP_PORT"),
			From:     r.required("SMTP_FROM"),
			Username: r.optional("SMTP_USERNAME", ""),
			Password: r.optional("SMTP_PASSWORD", ""),
			Workers:  r.positiveInt("MAILER_WORKERS", 2),
		},
		Auth: AuthConfig{
			AdminEmail:           strings.ToLower(r.optional("ADMIN_EMAIL", "admin@rmo.dev.br")),
			AdminInitialPassword: r.required("ADMIN_INITIAL_PASSWORD"),
			PublicURL:            r.httpURL("APP_PUBLIC_URL"),
			Google: GoogleOAuthConfig{
				ClientID:     r.optional("GOOGLE_CLIENT_ID", ""),
				ClientSecret: r.optional("GOOGLE_CLIENT_SECRET", ""),
				RedirectURL:  r.optional("GOOGLE_REDIRECT_URL", ""),
			},
		},
		TTS: TTSConfig{
			Timeout:       r.duration("TTS_TIMEOUT", 15*time.Second),
			MaxConcurrent: r.positiveInt("TTS_MAX_CONCURRENT", 4),
		},
	}

	defaultLevel := "debug"
	if cfg.AppEnv == EnvProduction {
		defaultLevel = "info"
	}
	cfg.LogLevel = r.oneOf("LOG_LEVEL", defaultLevel, "debug", "info", "warn", "error")

	if len(r.errs) > 0 {
		return Config{}, errors.Join(r.errs...)
	}
	return cfg, nil
}

// reader accumulates validation errors while reading variables.
type reader struct {
	lookup LookupFunc
	errs   []error
}

func (r *reader) value(key string) (string, bool) {
	v, ok := r.lookup(key)
	v = strings.TrimSpace(v)
	return v, ok && v != ""
}

func (r *reader) fail(key, format string, args ...any) {
	r.errs = append(r.errs, fmt.Errorf("%s: "+format, append([]any{key}, args...)...))
}

func (r *reader) required(key string) string {
	v, ok := r.value(key)
	if !ok {
		r.fail(key, "is required")
	}
	return v
}

func (r *reader) optional(key, fallback string) string {
	if v, ok := r.value(key); ok {
		return v
	}
	return fallback
}

func (r *reader) oneOf(key, fallback string, allowed ...string) string {
	v := r.optional(key, fallback)
	for _, a := range allowed {
		if v == a {
			return v
		}
	}
	r.fail(key, "must be one of %s, got %q", strings.Join(allowed, ", "), v)
	return fallback
}

func (r *reader) positiveInt(key string, fallback int) int {
	v, ok := r.value(key)
	if !ok {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		r.fail(key, "must be a positive integer, got %q", v)
		return fallback
	}
	return n
}

func (r *reader) port(key string, fallback int) int {
	v, ok := r.value(key)
	if !ok {
		return fallback
	}
	return r.parsePort(key, v)
}

func (r *reader) requiredPort(key string) int {
	v, ok := r.value(key)
	if !ok {
		r.fail(key, "is required")
		return 0
	}
	return r.parsePort(key, v)
}

func (r *reader) parsePort(key, v string) int {
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > 65535 {
		r.fail(key, "must be a port between 1 and 65535, got %q", v)
		return 0
	}
	return n
}

func (r *reader) duration(key string, fallback time.Duration) time.Duration {
	v, ok := r.value(key)
	if !ok {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		r.fail(key, "must be a positive duration such as 15s, got %q", v)
		return fallback
	}
	return d
}

func (r *reader) boolean(key string, fallback bool) bool {
	v, ok := r.value(key)
	if !ok {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		r.fail(key, "must be true or false, got %q", v)
		return fallback
	}
	return b
}

// identifier reads a SQL identifier made only of lowercase letters, digits and
// underscores, so it can be used unquoted in statements.
func (r *reader) identifier(key, fallback string) string {
	v := r.optional(key, fallback)
	if v == "" || (v[0] >= '0' && v[0] <= '9') {
		r.fail(key, "must be a lowercase SQL identifier, got %q", v)
		return fallback
	}
	for _, c := range v {
		if !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '_' {
			r.fail(key, "must be a lowercase SQL identifier, got %q", v)
			return fallback
		}
	}
	return v
}

// ipList reads an optional comma-separated list of IP addresses or CIDRs.
func (r *reader) ipList(key string) []string {
	v, ok := r.value(key)
	if !ok {
		return nil
	}
	var out []string
	for _, item := range strings.Split(v, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if net.ParseIP(item) == nil {
			if _, _, err := net.ParseCIDR(item); err != nil {
				r.fail(key, "must contain IP addresses or CIDRs, got %q", item)
				continue
			}
		}
		out = append(out, item)
	}
	return out
}

// httpURL reads a required absolute http(s) URL without a trailing slash.
func (r *reader) httpURL(key string) string {
	v := r.required(key)
	if v == "" {
		return ""
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		r.fail(key, "must be an absolute http or https URL, got %q", v)
		return ""
	}
	return strings.TrimRight(v, "/")
}
