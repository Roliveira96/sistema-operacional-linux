// Package domain holds models and errors for Google OAuth2 / OIDC (SPEC-008).
package domain

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
)

// Domain errors for OAuth2 and social authentication.
var (
	ErrOAuthStateMismatch      = errors.New("oauth state mismatch")
	ErrOAuthCodeMissing         = errors.New("oauth code is missing")
	ErrOAuthExchangeFailed      = errors.New("failed to exchange oauth code")
	ErrGoogleEmailNotVerified   = errors.New("google email is not verified")
	ErrAccountInactive          = errors.New("account is inactive or suspended")
	ErrGoogleOAuthNotConfigured = errors.New("google oauth is not configured")
	ErrNameRequired             = errors.New("name is required")
)

// GoogleUserInfo contains the verified identity claims returned by Google OpenID Connect.
type GoogleUserInfo struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	EmailVerified bool   `json:"email_verified"`
}

// GenerateRandomState generates a cryptographically secure 32-byte hex string for CSRF mitigation.
func GenerateRandomState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
