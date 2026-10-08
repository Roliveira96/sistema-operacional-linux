// Package repository persists users with GORM.
package repository

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// uniqueViolation is the PostgreSQL error code for unique constraint errors.
const uniqueViolation = "23505"

// Repository implements the user service persistence port.
type Repository struct {
	db *database.DB
}

// New creates the repository.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

// FindByID returns the user or domain.ErrNotFound.
func (r *Repository) FindByID(ctx context.Context, id uuid.UUID) (domain.User, error) {
	return r.first(ctx, "id = ?", id)
}

// FindByEmail returns the user or domain.ErrNotFound.
func (r *Repository) FindByEmail(ctx context.Context, email string) (domain.User, error) {
	return r.first(ctx, "email = ?", email)
}

// FindByAcademicID returns the user or domain.ErrNotFound.
func (r *Repository) FindByAcademicID(ctx context.Context, academicID string) (domain.User, error) {
	return r.first(ctx, "academic_id = ?", academicID)
}

func (r *Repository) first(ctx context.Context, query string, arg any) (domain.User, error) {
	var u domain.User
	err := r.db.Conn(ctx).Where(query, arg).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.User{}, domain.ErrNotFound
	}
	return u, err
}

// Create inserts the user, translating unique violations to domain errors.
func (r *Repository) Create(ctx context.Context, u *domain.User) error {
	err := r.db.Conn(ctx).Create(u).Error
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		if strings.Contains(pgErr.ConstraintName, "academic_id") {
			return domain.ErrAcademicIDTaken
		}
		return domain.ErrEmailTaken
	}
	return err
}

// UpdatePassword sets the password hash and the must-change flag.
func (r *Repository) UpdatePassword(ctx context.Context, id uuid.UUID, hash string, mustChange bool) error {
	res := r.db.Conn(ctx).Model(&domain.User{}).Where("id = ?", id).Updates(map[string]any{
		"password_hash":        hash,
		"must_change_password": mustChange,
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return domain.ErrNotFound
	}
	return nil
}
