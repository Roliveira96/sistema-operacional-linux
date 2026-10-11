package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
)

// CreateOAuthClient inserts a registered MCP client.
func (r *Repository) CreateOAuthClient(ctx context.Context, c *domain.OAuthClient) error {
	return r.db.Conn(ctx).Create(c).Error
}

// FindOAuthClient returns the client with the given id.
func (r *Repository) FindOAuthClient(ctx context.Context, id uuid.UUID) (domain.OAuthClient, error) {
	var c domain.OAuthClient
	err := r.db.Conn(ctx).Where("id = ?", id).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.OAuthClient{}, ErrNotFound
	}
	return c, err
}

// CreateOAuthCode inserts an authorization code.
func (r *Repository) CreateOAuthCode(ctx context.Context, c *domain.OAuthCode) error {
	return r.db.Conn(ctx).Create(c).Error
}

// FindOAuthCodeByHash returns the code with the given hash.
func (r *Repository) FindOAuthCodeByHash(ctx context.Context, hash string) (domain.OAuthCode, error) {
	var c domain.OAuthCode
	err := r.db.Conn(ctx).Where("code_hash = ?", hash).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.OAuthCode{}, ErrNotFound
	}
	return c, err
}

// MarkOAuthCodeUsed marks an unused code as used by the exchange that produced the token; false means it
// was already used.
func (r *Repository) MarkOAuthCodeUsed(ctx context.Context, id, accessTokenID uuid.UUID, at time.Time) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.OAuthCode{}).
		Where("id = ? AND used_at IS NULL", id).
		Updates(map[string]any{"used_at": at, "access_token_id": accessTokenID})
	return res.RowsAffected == 1, res.Error
}
