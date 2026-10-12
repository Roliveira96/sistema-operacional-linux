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

// SaveResponse stores the single answer of a question without a terminal (SPEC-035 RN-08). The row is written only while it
// has no answer, so two requests at the same time keep the first one and the other gets ErrAlreadyAnswered.
func (r *Repository) SaveResponse(ctx context.Context, p *domain.Progress) error {
	res := r.db.Conn(ctx).Exec(`INSERT INTO exercise_progress (id, user_id, question_id, attempts, last_passed, completed_at, response, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())
        ON CONFLICT (user_id, question_id) DO UPDATE SET attempts = EXCLUDED.attempts, last_passed = EXCLUDED.last_passed,
            completed_at = EXCLUDED.completed_at, response = EXCLUDED.response, updated_at = NOW()
        WHERE exercise_progress.response IS NULL`,
		p.ID, p.UserID, p.QuestionID, p.Attempts, p.LastPassed, p.CompletedAt, string(p.Response))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return service.ErrAlreadyAnswered
	}
	return nil
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
