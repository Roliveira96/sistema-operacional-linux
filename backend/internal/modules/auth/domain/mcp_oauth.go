package domain

import (
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// MCP OAuth login rules (SPEC-024 RN-14, D-12, D-13).
const (
	MaxOAuthClientNameLength = 80
	MaxOAuthRedirectURIs     = 5
	// OAuthCodeTTL is how long an authorization code can be exchanged.
	OAuthCodeTTL = 5 * time.Minute
	// OAuthTokenValidityDays is the validity of the token issued by the login; there is no refresh token.
	OAuthTokenValidityDays = 30
)

// OAuthClient is an MCP client that registered itself. It is a public client: it has no secret and proves
// the code exchange with PKCE.
type OAuthClient struct {
	database.Model
	ClientName   string
	RedirectURIs []string `gorm:"type:jsonb;serializer:json"`
}

// TableName pins the table name.
func (OAuthClient) TableName() string { return "oauth_clients" }

// AllowsRedirect reports whether uri is one of the registered redirect URIs (exact match).
func (c OAuthClient) AllowsRedirect(uri string) bool {
	for _, r := range c.RedirectURIs {
		if r == uri {
			return true
		}
	}
	return false
}

// OAuthCode is an authorization code. Only its SHA-256 is stored.
type OAuthCode struct {
	database.Model
	ClientID      uuid.UUID `gorm:"type:uuid"`
	UserID        uuid.UUID `gorm:"type:uuid"`
	CodeHash      string
	RedirectURI   string
	CodeChallenge string
	ExpiresAt     time.Time
	UsedAt        *time.Time
	// AccessTokenID is the token issued by the exchange, kept to revoke it if the code is replayed.
	AccessTokenID *uuid.UUID `gorm:"type:uuid"`
}

// TableName pins the table name.
func (OAuthCode) TableName() string { return "oauth_authorization_codes" }

// IsLoopbackRedirect reports whether uri is an http URL of the local machine, the only kind a client may
// register (D-13).
func IsLoopbackRedirect(uri string) bool {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "http" || u.Fragment != "" {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

// Errors of the MCP OAuth login. Their text is the OAuth error code.
var (
	ErrOAuthInvalidRedirect = errors.New("invalid_redirect_uri")
	ErrOAuthInvalidClient   = errors.New("invalid_client")
	ErrOAuthInvalidRequest  = errors.New("invalid_request")
	ErrOAuthInvalidGrant    = errors.New("invalid_grant")
)
