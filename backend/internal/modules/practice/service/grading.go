package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
)

// Errors of the correction of descriptive answers (SPEC-039).
var (
	ErrAnswerNotFound      = errors.New("descriptive answer not found")
	ErrInvalidAnswerStatus = errors.New("the status must be PENDING, SUGGESTED or GRADED")
)

// AnswerRow is a descriptive answer as the correction reads it: the progress with the answer, the question, the student and the grade.
// The grade has a nil id while nothing was suggested nor confirmed.
type AnswerRow struct {
	Progress       domain.Progress
	ModuleID       uuid.UUID
	QuestionID     uuid.UUID
	QuestionTitle  string
	Statement      string
	ExpectedAnswer string
	// StudentName is shown to the teacher only; the tools of the MCP never send it (SPEC-039 D-08).
	StudentName string
	Grade       domain.AnswerGrade
}

// GradingStore is the persistence of the correction.
type GradingStore interface {
	ListAnswers(ctx context.Context, moduleID uuid.UUID, status string) ([]AnswerRow, error)
	// FindAnswer returns ErrAnswerNotFound when the progress is not a descriptive answer.
	FindAnswer(ctx context.Context, progressID uuid.UUID) (AnswerRow, error)
	// SaveGrade writes the grade and its event in one transaction.
	SaveGrade(ctx context.Context, g *domain.AnswerGrade, ev domain.GradeEvent) error
}

// ModuleOwners tells who owns a module, from the public service of the content module.
type ModuleOwners interface {
	ModuleOwner(ctx context.Context, moduleID uuid.UUID) (uuid.UUID, error)
}

// Grading is the correction of the descriptive answers (SPEC-039): the AI suggests through the MCP, the teacher confirms.
type Grading struct {
	store  GradingStore
	owners ModuleOwners
	now    func() time.Time
}

// NewGrading creates the service.
func NewGrading(store GradingStore, owners ModuleOwners) *Grading {
	return &Grading{store: store, owners: owners, now: time.Now}
}

// authorize lets ADMIN and the TEACHER who owns the module through (SPEC-039 RN-04, RN-05).
func (g *Grading) authorize(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID) error {
	owner, err := g.owners.ModuleOwner(ctx, moduleID)
	if err != nil {
		return err
	}
	if who.Role == "ADMIN" || (who.Role == "TEACHER" && owner == who.UserID) {
		return nil
	}
	return contentservice.ErrForbidden
}

// List returns the descriptive answers of a module, of one situation or all of them ("").
func (g *Grading) List(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID, status string) ([]AnswerRow, error) {
	if status != "" && status != domain.StatusPending && status != domain.StatusSuggested && status != domain.StatusGraded {
		return nil, ErrInvalidAnswerStatus
	}
	if err := g.authorize(ctx, who, moduleID); err != nil {
		return nil, err
	}
	return g.store.ListAnswers(ctx, moduleID, status)
}

// Get returns one answer, authorized against its module.
func (g *Grading) Get(ctx context.Context, who contentservice.Actor, progressID uuid.UUID) (AnswerRow, error) {
	row, err := g.store.FindAnswer(ctx, progressID)
	if err != nil {
		return AnswerRow{}, err
	}
	if err := g.authorize(ctx, who, row.ModuleID); err != nil {
		return AnswerRow{}, err
	}
	return row, nil
}

func (g *Grading) gradeOf(row AnswerRow) domain.AnswerGrade {
	grade := row.Grade
	if grade.ID == uuid.Nil {
		id, err := uuid.NewV7()
		if err != nil {
			id = uuid.New()
		}
		grade = domain.AnswerGrade{ID: id, ProgressID: row.Progress.ID, CreatedAt: g.now()}
	}
	grade.UpdatedAt = g.now()
	return grade
}

// Suggest keeps the suggestion of the AI for an answer (SPEC-039 RN-04, D-06).
func (g *Grading) Suggest(ctx context.Context, who contentservice.Actor, progressID uuid.UUID, score int, reason, studentNote string) error {
	row, err := g.Get(ctx, who, progressID)
	if err != nil {
		return err
	}
	grade := g.gradeOf(row)
	ev, err := grade.Suggest(score, reason, studentNote, who.UserID, g.now())
	if err != nil {
		return err
	}
	return g.store.SaveGrade(ctx, &grade, ev)
}

// Confirm sets the grade the teacher decides, or revises it (SPEC-039 RN-05, RN-06, D-07).
func (g *Grading) Confirm(ctx context.Context, who contentservice.Actor, progressID uuid.UUID, in domain.GradeInput) (AnswerRow, error) {
	row, err := g.Get(ctx, who, progressID)
	if err != nil {
		return AnswerRow{}, err
	}
	grade := g.gradeOf(row)
	ev, err := grade.Confirm(in, who.UserID, g.now())
	if err != nil {
		return AnswerRow{}, err
	}
	if err := g.store.SaveGrade(ctx, &grade, ev); err != nil {
		return AnswerRow{}, err
	}
	row.Grade = grade
	return row, nil
}
