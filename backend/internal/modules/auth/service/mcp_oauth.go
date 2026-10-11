package service

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
)

// OAuthStore persists the MCP OAuth login (SPEC-024 RN-14). The service's NotFound error must be returned for
// missing records.
type OAuthStore interface {
	CreateOAuthClient(ctx context.Context, c *domain.OAuthClient) error
	FindOAuthClient(ctx context.Context, id uuid.UUID) (domain.OAuthClient, error)
	CreateOAuthCode(ctx context.Context, c *domain.OAuthCode) error
	FindOAuthCodeByHash(ctx context.Context, hash string) (domain.OAuthCode, error)
	// MarkOAuthCodeUsed marks the code used and reports false when it was already used.
	MarkOAuthCodeUsed(ctx context.Context, id, accessTokenID uuid.UUID, at time.Time) (bool, error)
}

// RegisterOAuthClient registers an MCP client (RFC 7591). Only loopback redirect URIs are accepted (D-13).
func (s *Service) RegisterOAuthClient(ctx context.Context, name string, redirectURIs []string) (domain.OAuthClient, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "MCP client"
	}
	if utf8.RuneCountInString(name) > domain.MaxOAuthClientNameLength {
		name = string([]rune(name)[:domain.MaxOAuthClientNameLength])
	}
	if len(redirectURIs) == 0 || len(redirectURIs) > domain.MaxOAuthRedirectURIs {
		return domain.OAuthClient{}, domain.ErrOAuthInvalidRedirect
	}
	for _, uri := range redirectURIs {
		if !domain.IsLoopbackRedirect(uri) {
			return domain.OAuthClient{}, domain.ErrOAuthInvalidRedirect
		}
	}
	c := domain.OAuthClient{ClientName: name, RedirectURIs: redirectURIs}
	if err := s.OAuth.CreateOAuthClient(ctx, &c); err != nil {
		return domain.OAuthClient{}, fmt.Errorf("create oauth client: %w", err)
	}
	return c, nil
}

// GetOAuthClient returns a registered client, for the consent screen.
func (s *Service) GetOAuthClient(ctx context.Context, id uuid.UUID) (domain.OAuthClient, error) {
	c, err := s.OAuth.FindOAuthClient(ctx, id)
	if errors.Is(err, s.NotFound) {
		return domain.OAuthClient{}, domain.ErrOAuthInvalidClient
	}
	return c, err
}

// OAuthAuthorizeInput is the decision of the user on the consent screen.
type OAuthAuthorizeInput struct {
	ClientID      uuid.UUID
	RedirectURI   string
	CodeChallenge string
	State         string
	Allow         bool
}

// OAuthAuthorize turns the decision of the signed-in user into the URL the browser is sent back to: with a
// single-use code when allowed, with access_denied otherwise (RN-14). Only ADMIN and TEACHER may authorize.
func (s *Service) OAuthAuthorize(ctx context.Context, p authn.Principal, in OAuthAuthorizeInput) (string, error) {
	if !mayUseAccessTokens(p.Role) {
		return "", domain.ErrAccessTokenForbidden
	}
	client, err := s.GetOAuthClient(ctx, in.ClientID)
	if err != nil {
		return "", err
	}
	if !client.AllowsRedirect(in.RedirectURI) {
		return "", domain.ErrOAuthInvalidRedirect
	}
	target, err := url.Parse(in.RedirectURI)
	if err != nil {
		return "", domain.ErrOAuthInvalidRedirect
	}
	q := target.Query()
	if in.State != "" {
		q.Set("state", in.State)
	}
	if !in.Allow {
		q.Set("error", "access_denied")
		target.RawQuery = q.Encode()
		return target.String(), nil
	}
	// PKCE S256 challenge: base64url of a SHA-256, 43 characters.
	if len(in.CodeChallenge) != 43 {
		return "", domain.ErrOAuthInvalidRequest
	}
	raw, hash, err := newToken()
	if err != nil {
		return "", err
	}
	code := domain.OAuthCode{
		ClientID: client.ID, UserID: p.UserID, CodeHash: hash, RedirectURI: in.RedirectURI,
		CodeChallenge: in.CodeChallenge, ExpiresAt: s.Now().UTC().Add(domain.OAuthCodeTTL),
	}
	if err := s.OAuth.CreateOAuthCode(ctx, &code); err != nil {
		return "", fmt.Errorf("create oauth code: %w", err)
	}
	logger.FromContext(ctx, s.Log).Info("mcp oauth code issued",
		zap.String("user_id", p.UserID.String()), zap.String("client_id", client.ID.String()))
	q.Set("code", raw)
	target.RawQuery = q.Encode()
	return target.String(), nil
}

// OAuthExchangeInput is the token request of the client.
type OAuthExchangeInput struct {
	ClientID     uuid.UUID
	Code         string
	CodeVerifier string
	RedirectURI  string
}

// OAuthExchange trades a code and its PKCE verifier for a personal access token. A replayed code is refused
// and revokes the token it already produced (RN-14).
func (s *Service) OAuthExchange(ctx context.Context, in OAuthExchangeInput) (raw string, validity time.Duration, err error) {
	code, err := s.OAuth.FindOAuthCodeByHash(ctx, hashToken(in.Code))
	if errors.Is(err, s.NotFound) {
		return "", 0, domain.ErrOAuthInvalidGrant
	}
	if err != nil {
		return "", 0, err
	}
	now := s.Now().UTC()
	if code.UsedAt != nil {
		if code.AccessTokenID != nil {
			_ = s.AccessTokens.RevokeAccessToken(ctx, *code.AccessTokenID, now)
		}
		return "", 0, domain.ErrOAuthInvalidGrant
	}
	sum := sha256.Sum256([]byte(in.CodeVerifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	if !now.Before(code.ExpiresAt) || code.ClientID != in.ClientID || code.RedirectURI != in.RedirectURI ||
		subtle.ConstantTimeCompare([]byte(challenge), []byte(code.CodeChallenge)) != 1 {
		return "", 0, domain.ErrOAuthInvalidGrant
	}

	u, err := s.Users.FindByID(ctx, code.UserID)
	if errors.Is(err, userdomain.ErrNotFound) || (err == nil && (u.Status != userdomain.StatusActive || !mayUseAccessTokens(string(u.Role)))) {
		return "", 0, domain.ErrOAuthInvalidGrant
	}
	if err != nil {
		return "", 0, err
	}
	client, err := s.GetOAuthClient(ctx, code.ClientID)
	if err != nil {
		return "", 0, domain.ErrOAuthInvalidGrant
	}

	err = s.Tx.WithinTransaction(ctx, func(ctx context.Context) error {
		t, tokenRaw, err := s.insertAccessToken(ctx, u.ID, client.ClientName+" (OAuth)", domain.OAuthTokenValidityDays)
		if err != nil {
			return err
		}
		ok, err := s.OAuth.MarkOAuthCodeUsed(ctx, code.ID, t.ID, now)
		if err != nil {
			return err
		}
		if !ok {
			return domain.ErrOAuthInvalidGrant
		}
		raw = tokenRaw
		return nil
	})
	if err != nil {
		return "", 0, err
	}
	return raw, domain.OAuthTokenValidityDays * 24 * time.Hour, nil
}

// DevPrincipal resolves the local development user of the MCP endpoint (RN-15). It is read on every call, so
// deactivating the user or changing the role takes effect at once.
func (s *Service) DevPrincipal(ctx context.Context, email string) (authn.Principal, error) {
	u, err := s.Users.FindByEmail(ctx, email)
	if errors.Is(err, userdomain.ErrNotFound) || (err == nil && u.Status != userdomain.StatusActive) {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	if err != nil {
		return authn.Principal{}, err
	}
	if !mayUseAccessTokens(string(u.Role)) {
		return authn.Principal{}, authn.ErrForbidden
	}
	return authn.Principal{UserID: u.ID, Role: string(u.Role), MustChangePassword: u.MustChangePassword}, nil
}
