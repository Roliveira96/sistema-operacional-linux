package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

type commandRow struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	AttemptID  uuid.UUID
	Position   int
	Command    string
	Output     string
	ExecutedAt time.Time
}

func (commandRow) TableName() string { return "assessment_attempt_commands" }

type helpRow struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	AttemptID uuid.UUID
	Position  *int
	Question  string
	Status    domain.HelpStatus
	CreatedAt time.Time
	ClosedAt  *time.Time
	ClosedBy  *uuid.UUID
	Answer    string
}

func (helpRow) TableName() string { return "assessment_help_requests" }

// helpWithAttempt is a request read with the assessment and the student of its attempt.
type helpWithAttempt struct {
	ID           uuid.UUID
	AttemptID    uuid.UUID
	Position     *int
	Question     string
	Status       domain.HelpStatus
	CreatedAt    time.Time
	ClosedAt     *time.Time
	ClosedBy     *uuid.UUID
	Answer       string
	AssessmentID uuid.UUID
	StudentID    uuid.UUID
}

func (h helpWithAttempt) domain() domain.HelpRequest {
	return domain.HelpRequest{ID: h.ID, AttemptID: h.AttemptID, AssessmentID: h.AssessmentID, StudentID: h.StudentID, Position: h.Position, Question: h.Question,
		Status: h.Status, CreatedAt: h.CreatedAt, ClosedAt: h.ClosedAt, ClosedBy: h.ClosedBy, Answer: h.Answer}
}

// FindAttemptByID gives an attempt by its id (SPEC-091 RN-08).
func (r *Repository) FindAttemptByID(ctx context.Context, id uuid.UUID) (domain.Attempt, error) {
	var row attemptRow
	err := r.db.Conn(ctx).Where("id = ?", id).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Attempt{}, domain.ErrAttemptNotFound
	}
	return row.domain(), err
}

// SaveCommand stores a command of an attempt (RN-06).
func (r *Repository) SaveCommand(ctx context.Context, c *domain.AttemptCommand) error {
	id, err := newID()
	if err != nil {
		return err
	}
	row := commandRow{ID: id, AttemptID: c.AttemptID, Position: c.Position, Command: c.Command, Output: c.Output, ExecutedAt: c.ExecutedAt}
	if err := r.db.Conn(ctx).Create(&row).Error; err != nil {
		return err
	}
	c.ID = id
	return nil
}

// Commands gives the commands of an attempt in the order they ran (RN-06).
func (r *Repository) Commands(ctx context.Context, attemptID uuid.UUID) ([]domain.AttemptCommand, error) {
	var rows []commandRow
	if err := r.db.Conn(ctx).Where("attempt_id = ?", attemptID).Order("executed_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.AttemptCommand, len(rows))
	for i, c := range rows {
		out[i] = domain.AttemptCommand{ID: c.ID, AttemptID: c.AttemptID, Position: c.Position, Command: c.Command, Output: c.Output, ExecutedAt: c.ExecutedAt}
	}
	return out, nil
}

// CreateHelp opens a request; the database keeps one open for each attempt (RN-07).
func (r *Repository) CreateHelp(ctx context.Context, h *domain.HelpRequest) error {
	id, err := newID()
	if err != nil {
		return err
	}
	row := helpRow{ID: id, AttemptID: h.AttemptID, Position: h.Position, Question: h.Question, Status: h.Status, CreatedAt: h.CreatedAt}
	if err := r.db.Conn(ctx).Create(&row).Error; err != nil {
		return err
	}
	h.ID = id
	return nil
}

func (r *Repository) helps(q *gorm.DB) ([]domain.HelpRequest, error) {
	var rows []helpWithAttempt
	err := q.Table("assessment_help_requests AS h").
		Select("h.*, a.assessment_id, a.student_id").
		Joins("JOIN assessment_attempts a ON a.id = h.attempt_id").
		Order("h.created_at, h.id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.HelpRequest, len(rows))
	for i, h := range rows {
		out[i] = h.domain()
	}
	return out, nil
}

// LatestHelp gives the last request of an attempt, or nil (RN-07).
func (r *Repository) LatestHelp(ctx context.Context, attemptID uuid.UUID) (*domain.HelpRequest, error) {
	list, err := r.helps(r.db.Conn(ctx).Where("h.attempt_id = ?", attemptID))
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[len(list)-1], nil
}

// FindHelp gives a request by its id.
func (r *Repository) FindHelp(ctx context.Context, id uuid.UUID) (domain.HelpRequest, error) {
	list, err := r.helps(r.db.Conn(ctx).Where("h.id = ?", id))
	if err != nil {
		return domain.HelpRequest{}, err
	}
	if len(list) == 0 {
		return domain.HelpRequest{}, domain.ErrHelpNotFound
	}
	return list[0], nil
}

// CloseHelp closes an open request, with who closed it and the answer (RN-07, D-03).
func (r *Repository) CloseHelp(ctx context.Context, id uuid.UUID, status domain.HelpStatus, at time.Time, by *uuid.UUID, answer string) error {
	res := r.db.Conn(ctx).Model(&helpRow{}).Where("id = ? AND status = ?", id, domain.HelpOpen).
		Updates(map[string]any{"status": status, "closed_at": at, "closed_by": by, "answer": answer})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return domain.ErrHelpNotFound
	}
	return nil
}

// OpenHelps gives the open requests of an assessment, the oldest first (RN-07).
func (r *Repository) OpenHelps(ctx context.Context, assessmentID uuid.UUID) ([]domain.HelpRequest, error) {
	return r.helps(r.db.Conn(ctx).Where("a.assessment_id = ? AND h.status = ?", assessmentID, domain.HelpOpen))
}
