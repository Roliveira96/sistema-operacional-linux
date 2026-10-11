package config

import (
	"strings"
	"testing"
)

// Covers SPEC-024 CA-28: the local MCP user can never be set in production.
func TestLoadMCPDevUser(t *testing.T) {
	env := validEnv()
	cfg, err := LoadFrom(lookupFrom(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Auth.MCPDevUserEmail != "" || cfg.Auth.MCPPublicURL != "http://localhost:8080" {
		t.Errorf("unexpected defaults: %+v", cfg.Auth)
	}

	env["MCP_DEV_USER_EMAIL"] = " Dev@Example.com "
	env["MCP_PUBLIC_URL"] = "https://api.example.com/"
	cfg, err = LoadFrom(lookupFrom(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Auth.MCPDevUserEmail != "dev@example.com" || cfg.Auth.MCPPublicURL != "https://api.example.com" {
		t.Errorf("unexpected MCP config: %+v", cfg.Auth)
	}

	env["APP_ENV"] = EnvProduction
	_, err = LoadFrom(lookupFrom(env))
	if err == nil || !strings.Contains(err.Error(), "MCP_DEV_USER_EMAIL") {
		t.Fatalf("production with a dev user must fail, got %v", err)
	}

	delete(env, "MCP_DEV_USER_EMAIL")
	if _, err = LoadFrom(lookupFrom(env)); err != nil {
		t.Fatalf("production without a dev user must load: %v", err)
	}
}
