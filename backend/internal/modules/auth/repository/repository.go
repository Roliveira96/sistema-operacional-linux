// Package repository persists sessions, reset tokens and audit logs.
package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ErrNotFound is returned when a session or token does not exist.
var ErrNotFound = errors.New("record not found")

// Repository implements the auth service persistence port.
type Repository struct {
	db *database.DB
}

// New creates the repository.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

// CreateSession inserts a session.
func (r *Repository) CreateSession(ctx context.Context, s *domain.Session) error {
	return r.db.Conn(ctx).Create(s).Error
}

// FindSessionByTokenHash returns the session with the given token hash.
func (r *Repository) FindSessionByTokenHash(ctx context.Context, hash string) (domain.Session, error) {
	var s domain.Session
	err := r.db.Conn(ctx).Where("token_hash = ?", hash).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Session{}, ErrNotFound
	}
	return s, err
}

// TouchSession updates the last activity of an active session.
func (r *Repository) TouchSession(ctx context.Context, id uuid.UUID, at time.Time) error {
	return r.db.Conn(ctx).Model(&domain.Session{}).
		Where("id = ? AND status = ?", id, domain.SessionActive).
		Update("last_activity_at", at).Error
}

// EndSession moves an active session to a final status.
func (r *Repository) EndSession(ctx context.Context, id uuid.UUID, status domain.SessionStatus, at time.Time) error {
	return r.db.Conn(ctx).Model(&domain.Session{}).
		Where("id = ? AND status = ?", id, domain.SessionActive).
		Updates(map[string]any{"status": status, "revoked_at": at}).Error
}

// EndUserSessions ends every active session of a user except the given one
// (uuid.Nil keeps none) and returns how many were ended.
func (r *Repository) EndUserSessions(ctx context.Context, userID, except uuid.UUID, status domain.SessionStatus, at time.Time) (int64, error) {
	q := r.db.Conn(ctx).Model(&domain.Session{}).Where("user_id = ? AND status = ?", userID, domain.SessionActive)
	if except != uuid.Nil {
		q = q.Where("id <> ?", except)
	}
	res := q.Updates(map[string]any{"status": status, "revoked_at": at})
	return res.RowsAffected, res.Error
}

// CreateResetToken inserts a password reset token.
func (r *Repository) CreateResetToken(ctx context.Context, t *domain.PasswordResetToken) error {
	return r.db.Conn(ctx).Create(t).Error
}

// FindResetTokenByHash returns the token with the given hash.
func (r *Repository) FindResetTokenByHash(ctx context.Context, hash string) (domain.PasswordResetToken, error) {
	var t domain.PasswordResetToken
	err := r.db.Conn(ctx).Where("token_hash = ?", hash).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.PasswordResetToken{}, ErrNotFound
	}
	return t, err
}

// MarkResetTokenUsed consumes the token; it fails with ErrNotFound when the
// token was already used, so concurrent resets cannot both succeed.
func (r *Repository) MarkResetTokenUsed(ctx context.Context, id uuid.UUID, at time.Time) error {
	res := r.db.Conn(ctx).Model(&domain.PasswordResetToken{}).
		Where("id = ? AND used_at IS NULL", id).
		Update("used_at", at)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// InsertAudit appends an audit entry.
func (r *Repository) InsertAudit(ctx context.Context, a *domain.AuditLog) error {
	return r.db.Conn(ctx).Create(a).Error
}
