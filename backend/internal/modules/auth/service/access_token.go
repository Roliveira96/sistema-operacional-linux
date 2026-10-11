package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
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

// AccessTokenStore persists personal access tokens. ErrNotFound (the
// service's NotFound error) must be returned for missing records.
type AccessTokenStore interface {
	CreateAccessToken(ctx context.Context, t *domain.AccessToken) error
	ListAccessTokensByUser(ctx context.Context, userID uuid.UUID) ([]domain.AccessToken, error)
	FindAccessTokenByID(ctx context.Context, id uuid.UUID) (domain.AccessToken, error)
	FindAccessTokenByHash(ctx context.Context, hash string) (domain.AccessToken, error)
	RevokeAccessToken(ctx context.Context, id uuid.UUID, at time.Time) error
	TouchAccessToken(ctx context.Context, id uuid.UUID, at time.Time) error
}

// mayUseAccessTokens reports whether a role can own and use access tokens
// (SPEC-024 RN-03).
func mayUseAccessTokens(role string) bool {
	return role == authn.RoleAdmin || role == authn.RoleTeacher
}

// CreateAccessToken creates a personal access token for the principal and
// returns it with the raw value, which is never available again.
func (s *Service) CreateAccessToken(ctx context.Context, p authn.Principal, name string, validityDays int) (domain.AccessToken, string, error) {
	if !mayUseAccessTokens(p.Role) {
		return domain.AccessToken{}, "", domain.ErrAccessTokenForbidden
	}
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > domain.MaxAccessTokenNameLength {
		return domain.AccessToken{}, "", domain.ErrAccessTokenName
	}
	if !slices.Contains(domain.AccessTokenValidityDays, validityDays) {
		return domain.AccessToken{}, "", domain.ErrAccessTokenValidity
	}

	t, raw, err := s.insertAccessToken(ctx, p.UserID, name, validityDays)
	if err != nil {
		return domain.AccessToken{}, "", err
	}
	return t, raw, nil
}

// insertAccessToken stores a new token of the user and returns it with the raw value.
func (s *Service) insertAccessToken(ctx context.Context, userID uuid.UUID, name string, validityDays int) (domain.AccessToken, string, error) {
	raw, hash, err := newToken()
	if err != nil {
		return domain.AccessToken{}, "", err
	}
	now := s.Now().UTC()
	t := domain.AccessToken{
		UserID:    userID,
		Name:      name,
		TokenHash: hash,
		ExpiresAt: now.AddDate(0, 0, validityDays),
	}
	t.CreatedAt, t.UpdatedAt = now, now
	if err := s.AccessTokens.CreateAccessToken(ctx, &t); err != nil {
		return domain.AccessToken{}, "", fmt.Errorf("create access token: %w", err)
	}
	logger.FromContext(ctx, s.Log).Info("access token created",
		zap.String("user_id", userID.String()), zap.String("access_token_id", t.ID.String()))
	return t, raw, nil
}

// ListAccessTokens returns the tokens of the principal. The token value is
// never stored, so it cannot be listed.
func (s *Service) ListAccessTokens(ctx context.Context, p authn.Principal) ([]domain.AccessToken, error) {
	return s.AccessTokens.ListAccessTokensByUser(ctx, p.UserID)
}

// RevokeAccessToken revokes a token. Only its owner or an ADMIN may revoke
// it; for anyone else it does not exist. Revoking twice is a no-op.
func (s *Service) RevokeAccessToken(ctx context.Context, p authn.Principal, id uuid.UUID) error {
	t, err := s.AccessTokens.FindAccessTokenByID(ctx, id)
	if errors.Is(err, s.NotFound) {
		return domain.ErrAccessTokenNotFound
	}
	if err != nil {
		return err
	}
	if t.UserID != p.UserID && p.Role != authn.RoleAdmin {
		return domain.ErrAccessTokenNotFound
	}
	if t.RevokedAt != nil {
		return nil
	}
	if err := s.AccessTokens.RevokeAccessToken(ctx, id, s.Now().UTC()); err != nil {
		return fmt.Errorf("revoke access token: %w", err)
	}
	logger.FromContext(ctx, s.Log).Info("access token revoked",
		zap.String("user_id", p.UserID.String()), zap.String("access_token_id", id.String()))
	return nil
}

// AuthenticateAccessToken resolves a raw personal access token into a
// principal (SPEC-024 RN-02, RN-03). The role is read from the user on every
// call, so a role change or a deactivation cuts access at once. It returns
// authn.ErrNotAuthenticated for unknown, expired or revoked tokens and for
// users that are inactive, and authn.ErrForbidden for roles other than
// ADMIN/TEACHER.
func (s *Service) AuthenticateAccessToken(ctx context.Context, raw string) (authn.Principal, error) {
	t, err := s.AccessTokens.FindAccessTokenByHash(ctx, hashToken(raw))
	if errors.Is(err, s.NotFound) {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	if err != nil {
		return authn.Principal{}, err
	}
	now := s.Now().UTC()
	if !t.Usable(now) {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}

	u, err := s.Users.FindByID(ctx, t.UserID)
	if errors.Is(err, userdomain.ErrNotFound) {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	if err != nil {
		return authn.Principal{}, err
	}
	if u.Status != userdomain.StatusActive {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	if !mayUseAccessTokens(string(u.Role)) {
		return authn.Principal{}, authn.ErrForbidden
	}

	if t.LastUsedAt == nil || now.Sub(*t.LastUsedAt) >= domain.AccessTokenTouchInterval {
		// Usage bookkeeping must not fail an otherwise valid request.
		if err := s.AccessTokens.TouchAccessToken(ctx, t.ID, now); err != nil {
			logger.FromContext(ctx, s.Log).Warn("could not update access token last use", zap.Error(err))
		}
	}
	return authn.Principal{UserID: u.ID, Role: string(u.Role), MustChangePassword: u.MustChangePassword}, nil
}
