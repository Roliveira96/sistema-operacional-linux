package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
)

// CreateAccessToken inserts a personal access token.
func (r *Repository) CreateAccessToken(ctx context.Context, t *domain.AccessToken) error {
	return r.db.Conn(ctx).Create(t).Error
}

// ListAccessTokensByUser returns the tokens of a user, newest first,
// including revoked and expired ones.
func (r *Repository) ListAccessTokensByUser(ctx context.Context, userID uuid.UUID) ([]domain.AccessToken, error) {
	var out []domain.AccessToken
	err := r.db.Conn(ctx).Where("user_id = ?", userID).Order("created_at DESC, id DESC").Find(&out).Error
	return out, err
}

// FindAccessTokenByID returns the token with the given id.
func (r *Repository) FindAccessTokenByID(ctx context.Context, id uuid.UUID) (domain.AccessToken, error) {
	var t domain.AccessToken
	err := r.db.Conn(ctx).Where("id = ?", id).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.AccessToken{}, ErrNotFound
	}
	return t, err
}

// FindAccessTokenByHash returns the token with the given hash.
func (r *Repository) FindAccessTokenByHash(ctx context.Context, hash string) (domain.AccessToken, error) {
	var t domain.AccessToken
	err := r.db.Conn(ctx).Where("token_hash = ?", hash).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.AccessToken{}, ErrNotFound
	}
	return t, err
}

// RevokeAccessToken sets revoked_at; an already revoked token keeps its
// original revocation time.
func (r *Repository) RevokeAccessToken(ctx context.Context, id uuid.UUID, at time.Time) error {
	return r.db.Conn(ctx).Model(&domain.AccessToken{}).
		Where("id = ? AND revoked_at IS NULL", id).
		Update("revoked_at", at).Error
}

// TouchAccessToken records the last use of a token.
func (r *Repository) TouchAccessToken(ctx context.Context, id uuid.UUID, at time.Time) error {
	return r.db.Conn(ctx).Model(&domain.AccessToken{}).
		Where("id = ?", id).
		Update("last_used_at", at).Error
}
