// Package repository persists exercise progress (SPEC-014).
package repository

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
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

// answerRow is a descriptive answer as the query reads it.
type answerRow struct {
	domain.Progress
	ModuleID      uuid.UUID
	QID           uuid.UUID
	QuestionTitle string
	Statement     string
	AnswerKey     []byte
	StudentName   string
	GradeJSON     []byte
}

// answersQuery reads the descriptive answers with their question, the name of the student and the grade, if any (SPEC-039).
const answersQuery = `SELECT p.*, q.module_id, q.id AS q_id, q.title AS question_title, q.statement, q.answer_key,
        COALESCE(NULLIF(u.name, ''), u.email, '') AS student_name, to_jsonb(g) AS grade_json
    FROM exercise_progress p
    JOIN questions q ON q.id = p.question_id AND q.kind = 'DISCURSIVE' AND q.deleted_at IS NULL
    JOIN users u ON u.id = p.user_id
    LEFT JOIN answer_grades g ON g.progress_id = p.id
    WHERE p.response IS NOT NULL`

func (r answerRow) toService() (service.AnswerRow, error) {
	row := service.AnswerRow{Progress: r.Progress, ModuleID: r.ModuleID, QuestionID: r.QID, QuestionTitle: r.QuestionTitle, Statement: r.Statement, StudentName: r.StudentName}
	row.ExpectedAnswer, _ = contentdomain.ReadDiscursiveKey(r.AnswerKey)
	if len(r.GradeJSON) > 0 && string(r.GradeJSON) != "null" {
		if err := json.Unmarshal(r.GradeJSON, &row.Grade); err != nil {
			return service.AnswerRow{}, err
		}
	}
	return row, nil
}

// ListAnswers returns the descriptive answers of a module, of one situation or all ("").
func (r *Repository) ListAnswers(ctx context.Context, moduleID uuid.UUID, status string) ([]service.AnswerRow, error) {
	query := answersQuery + " AND q.module_id = ?"
	switch status {
	case domain.StatusPending:
		query += " AND (g.id IS NULL OR (g.score IS NULL AND g.suggested_score IS NULL))"
	case domain.StatusSuggested:
		query += " AND g.score IS NULL AND g.suggested_score IS NOT NULL"
	case domain.StatusGraded:
		query += " AND g.score IS NOT NULL"
	}
	var rows []answerRow
	if err := r.db.Conn(ctx).Raw(query+" ORDER BY p.completed_at, p.id", moduleID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]service.AnswerRow, len(rows))
	for i, row := range rows {
		var err error
		if out[i], err = row.toService(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// FindAnswer returns one descriptive answer; ErrAnswerNotFound when the progress is not one.
func (r *Repository) FindAnswer(ctx context.Context, progressID uuid.UUID) (service.AnswerRow, error) {
	var rows []answerRow
	if err := r.db.Conn(ctx).Raw(answersQuery+" AND p.id = ?", progressID).Scan(&rows).Error; err != nil {
		return service.AnswerRow{}, err
	}
	if len(rows) == 0 {
		return service.AnswerRow{}, service.ErrAnswerNotFound
	}
	return rows[0].toService()
}

// SaveGrade writes the grade and its event in one transaction (SPEC-039 RN-06).
func (r *Repository) SaveGrade(ctx context.Context, g *domain.AnswerGrade, ev domain.GradeEvent) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		if err := conn.Save(g).Error; err != nil {
			return err
		}
		return conn.Create(&ev).Error
	})
}

// GradesOf returns the corrections among the given progress, by progress.
func (r *Repository) GradesOf(ctx context.Context, progressIDs []uuid.UUID) (map[uuid.UUID]domain.AnswerGrade, error) {
	var grades []domain.AnswerGrade
	if err := r.db.Conn(ctx).Where("progress_id IN ?", progressIDs).Find(&grades).Error; err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]domain.AnswerGrade, len(grades))
	for _, g := range grades {
		out[g.ProgressID] = g
	}
	return out, nil
}
