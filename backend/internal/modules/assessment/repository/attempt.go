package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

type attemptRow struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey"`
	AssessmentID     uuid.UUID
	StudentID        uuid.UUID
	Status           domain.AttemptStatus
	StartedAt        time.Time
	DeadlineAt       time.Time
	SubmittedAt      *time.Time
	PreliminaryScore *domain.Score
	PendingItems     *int
	EndedBy          *uuid.UUID
	EndReason        *string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (attemptRow) TableName() string { return "assessment_attempts" }

type attemptItemRow struct {
	AttemptID     uuid.UUID `gorm:"type:uuid;primaryKey"`
	Position      int       `gorm:"primaryKey"`
	QuestionID    uuid.UUID
	Kind          string
	Weight        domain.Score
	StudentView   json.RawMessage `gorm:"type:jsonb"`
	AnswerKey     json.RawMessage `gorm:"type:jsonb"`
	Answer        json.RawMessage `gorm:"type:jsonb"`
	AnsweredAt    *time.Time
	CheckedSolved *bool
	Points        *domain.Score
}

func (attemptItemRow) TableName() string { return "assessment_attempt_items" }

func (r attemptRow) domain() domain.Attempt {
	return domain.Attempt{ID: r.ID, AssessmentID: r.AssessmentID, StudentID: r.StudentID, Status: r.Status, StartedAt: r.StartedAt, DeadlineAt: r.DeadlineAt,
		SubmittedAt: r.SubmittedAt, PreliminaryScore: r.PreliminaryScore, PendingItems: r.PendingItems, EndedBy: r.EndedBy, EndReason: r.EndReason,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

// CreateAttempt stores the attempt and its questions in one transaction (SPEC-090 RN-01, RN-02).
func (r *Repository) CreateAttempt(ctx context.Context, a *domain.Attempt, items []domain.AttemptItem) error {
	id, err := newID()
	if err != nil {
		return err
	}
	row := attemptRow{ID: id, AssessmentID: a.AssessmentID, StudentID: a.StudentID, Status: a.Status, StartedAt: a.StartedAt, DeadlineAt: a.DeadlineAt,
		CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt}
	if row.CreatedAt.IsZero() {
		row.CreatedAt, row.UpdatedAt = a.StartedAt, a.StartedAt
	}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		tx := r.db.Conn(ctx)
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		rows := make([]attemptItemRow, len(items))
		for i, it := range items {
			rows[i] = attemptItemRow{AttemptID: id, Position: it.Position, QuestionID: it.QuestionID, Kind: it.Kind, Weight: it.Weight,
				StudentView: it.StudentView, AnswerKey: it.AnswerKey}
		}
		return tx.Create(&rows).Error
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return domain.ErrAttemptExists
	}
	if err != nil {
		return err
	}
	a.ID, a.CreatedAt, a.UpdatedAt = id, row.CreatedAt, row.UpdatedAt
	return nil
}

// FindAttempt gives the attempt of the student at the assessment.
func (r *Repository) FindAttempt(ctx context.Context, assessmentID, studentID uuid.UUID) (domain.Attempt, error) {
	var row attemptRow
	err := r.db.Conn(ctx).Where("assessment_id = ? AND student_id = ?", assessmentID, studentID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Attempt{}, domain.ErrAttemptNotFound
	}
	return row.domain(), err
}

// AttemptItems gives the questions of the attempt in their order.
func (r *Repository) AttemptItems(ctx context.Context, attemptID uuid.UUID) ([]domain.AttemptItem, error) {
	var rows []attemptItemRow
	if err := r.db.Conn(ctx).Where("attempt_id = ?", attemptID).Order("position").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.AttemptItem, len(rows))
	for i, it := range rows {
		out[i] = domain.AttemptItem{AttemptID: it.AttemptID, Position: it.Position, QuestionID: it.QuestionID, Kind: it.Kind, Weight: it.Weight,
			StudentView: it.StudentView, AnswerKey: it.AnswerKey, Answer: it.Answer, AnsweredAt: it.AnsweredAt, CheckedSolved: it.CheckedSolved, Points: it.Points}
	}
	return out, nil
}

// SaveAttemptAnswer replaces the answer of a question and, when solved is given, the result of its check (RN-04, RN-05).
func (r *Repository) SaveAttemptAnswer(ctx context.Context, attemptID uuid.UUID, position int, answer json.RawMessage, at time.Time, solved *bool) error {
	values := map[string]any{"answer": answer, "answered_at": at}
	if solved != nil {
		values["checked_solved"] = *solved
	}
	res := r.db.Conn(ctx).Model(&attemptItemRow{}).Where("attempt_id = ? AND position = ?", attemptID, position).Updates(values)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return domain.ErrAttemptNotFound
	}
	return nil
}

// CloseAttempt writes the delivery and the points of each question in one transaction, only while the attempt is still in progress (RN-06 to RN-08).
func (r *Repository) CloseAttempt(ctx context.Context, a *domain.Attempt, points map[int]*domain.Score) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		tx := r.db.Conn(ctx)
		res := tx.Model(&attemptRow{}).Where("id = ? AND status = ?", a.ID, domain.AttemptInProgress).Updates(map[string]any{
			"status": a.Status, "submitted_at": a.SubmittedAt, "preliminary_score": a.PreliminaryScore, "pending_items": a.PendingItems, "updated_at": a.UpdatedAt,
			"ended_by": a.EndedBy, "end_reason": a.EndReason,
		})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return domain.ErrAttemptAlreadySubmitted
		}
		for position, p := range points {
			if err := tx.Model(&attemptItemRow{}).Where("attempt_id = ? AND position = ?", a.ID, position).Update("points", p).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ListAttempts gives the attempts of the assessment, the first to start first (RN-09).
func (r *Repository) ListAttempts(ctx context.Context, assessmentID uuid.UUID) ([]domain.Attempt, error) {
	return r.attempts(r.db.Conn(ctx).Where("assessment_id = ?", assessmentID))
}

// DueAttempts gives the attempts in progress whose deadline is before the instant (RN-07).
func (r *Repository) DueAttempts(ctx context.Context, before time.Time) ([]domain.Attempt, error) {
	return r.attempts(r.db.Conn(ctx).Where("status = ? AND deadline_at < ?", domain.AttemptInProgress, before))
}

// HasStarted tells whether the student already has an attempt at the assessment: the check of the clearance (SPEC-076 RN-07, SPEC-090 RN-11).
func (r *Repository) HasStarted(ctx context.Context, assessmentID, studentID uuid.UUID) (bool, error) {
	var n int64
	err := r.db.Conn(ctx).Model(&attemptRow{}).Where("assessment_id = ? AND student_id = ?", assessmentID, studentID).Count(&n).Error
	return n > 0, err
}

func (r *Repository) attempts(q *gorm.DB) ([]domain.Attempt, error) {
	var rows []attemptRow
	if err := q.Order("started_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Attempt, len(rows))
	for i, row := range rows {
		out[i] = row.domain()
	}
	return out, nil
}
