// Package repository persists exercise progress (SPEC-014).
package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Repository implements service.Store.
type Repository struct {
	db *database.DB
}

// New creates the repository.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

// FindProgress returns the progress of a user on a question.
func (r *Repository) FindProgress(ctx context.Context, userID, questionID uuid.UUID) (domain.Progress, error) {
	var p domain.Progress
	err := r.db.Conn(ctx).Where("user_id = ? AND question_id = ?", userID, questionID).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Progress{}, service.ErrNotFound
	}
	return p, err
}

// SaveProgress inserts or updates a progress row.
func (r *Repository) SaveProgress(ctx context.Context, p *domain.Progress) error {
	return r.db.Conn(ctx).Save(p).Error
}

// ListModuleProgress returns the user's progress on the questions of a module.
func (r *Repository) ListModuleProgress(ctx context.Context, userID, moduleID uuid.UUID) ([]domain.Progress, error) {
	var out []domain.Progress
	err := r.db.Conn(ctx).
		Joins("JOIN questions ON questions.id = exercise_progress.question_id").
		Where("exercise_progress.user_id = ? AND questions.module_id = ?", userID, moduleID).
		Order("exercise_progress.created_at").
		Find(&out).Error
	return out, err
}
