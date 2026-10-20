// Package repository persists the assessments of a class (SPEC-075 section 4) with GORM.
package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Repository stores the assessments, their composition, their students and their history.
type Repository struct{ db *database.DB }

// New creates the repository.
func New(db *database.DB) *Repository { return &Repository{db: db} }

var _ service.Repository = (*Repository)(nil)

// The parts of an assessment have rows of their own, so the domain keeps them as plain values.

type itemRow struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	AssessmentID uuid.UUID
	QuestionID   uuid.UUID
	Position     int
	Weight       domain.Score
}

func (itemRow) TableName() string { return "assessment_items" }

type ruleRow struct {
	ID                uuid.UUID `gorm:"type:uuid;primaryKey"`
	AssessmentID      uuid.UUID
	Difficulty        domain.Difficulty
	Quantity          int
	PointsPerQuestion domain.Score
}

func (ruleRow) TableName() string { return "assessment_draw_rules" }

type studentRow struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	AssessmentID uuid.UUID
	StudentID    uuid.UUID
	CreatedAt    time.Time
}

func (studentRow) TableName() string { return "assessment_students" }

func newID() (uuid.UUID, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, fmt.Errorf("generate uuidv7: %w", err)
	}
	return id, nil
}

// replaceItems, replaceRules and replaceStudents drop the rows of the assessment and write the new ones, inside the transaction of the caller.
func replaceItems(tx *gorm.DB, assessmentID uuid.UUID, items []domain.Item) error {
	if err := tx.Where("assessment_id = ?", assessmentID).Delete(&itemRow{}).Error; err != nil {
		return err
	}
	rows := make([]itemRow, len(items))
	for i, it := range items {
		id, err := newID()
		if err != nil {
			return err
		}
		rows[i] = itemRow{ID: id, AssessmentID: assessmentID, QuestionID: it.QuestionID, Position: it.Position, Weight: it.Weight}
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Create(&rows).Error
}

func replaceRules(tx *gorm.DB, assessmentID uuid.UUID, rules []domain.DrawRule) error {
	if err := tx.Where("assessment_id = ?", assessmentID).Delete(&ruleRow{}).Error; err != nil {
		return err
	}
	rows := make([]ruleRow, len(rules))
	for i, r := range rules {
		id, err := newID()
		if err != nil {
			return err
		}
		rows[i] = ruleRow{ID: id, AssessmentID: assessmentID, Difficulty: r.Difficulty, Quantity: r.Quantity, PointsPerQuestion: r.Points}
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Create(&rows).Error
}

func replaceStudents(tx *gorm.DB, assessmentID uuid.UUID, students []uuid.UUID) error {
	if err := tx.Where("assessment_id = ?", assessmentID).Delete(&studentRow{}).Error; err != nil {
		return err
	}
	rows := make([]studentRow, len(students))
	for i, student := range students {
		id, err := newID()
		if err != nil {
			return err
		}
		rows[i] = studentRow{ID: id, AssessmentID: assessmentID, StudentID: student}
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Create(&rows).Error
}

func appendEvent(tx *gorm.DB, assessmentID uuid.UUID, e *domain.Event) error {
	id, err := newID()
	if err != nil {
		return err
	}
	e.ID, e.AssessmentID = id, assessmentID
	return tx.Create(e).Error
}

// Create stores the assessment, its composition, its students and the event of its creation in one transaction (RN-19).
func (r *Repository) Create(ctx context.Context, a *domain.Assessment, items []domain.Item, rules []domain.DrawRule, students []uuid.UUID, e domain.Event) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		tx := r.db.Conn(ctx)
		if err := tx.Create(a).Error; err != nil {
			return fmt.Errorf("create assessment: %w", err)
		}
		if err := replaceItems(tx, a.ID, items); err != nil {
			return fmt.Errorf("create the items: %w", err)
		}
		if err := replaceRules(tx, a.ID, rules); err != nil {
			return fmt.Errorf("create the draw rules: %w", err)
		}
		if err := replaceStudents(tx, a.ID, students); err != nil {
			return fmt.Errorf("create the students: %w", err)
		}
		return appendEvent(tx, a.ID, &e)
	})
}

// Find reads an assessment that was not deleted.
func (r *Repository) Find(ctx context.Context, id uuid.UUID) (domain.Assessment, error) {
	var a domain.Assessment
	err := r.db.Conn(ctx).First(&a, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Assessment{}, domain.ErrAssessmentNotFound
	}
	return a, err
}

// Items gives the questions of the manual composition, in the order of the exam.
func (r *Repository) Items(ctx context.Context, id uuid.UUID) ([]domain.Item, error) {
	var rows []itemRow
	if err := r.db.Conn(ctx).Where("assessment_id = ?", id).Order("position").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Item, len(rows))
	for i, row := range rows {
		out[i] = domain.Item{QuestionID: row.QuestionID, Position: row.Position, Weight: row.Weight}
	}
	return out, nil
}

// Rules gives the rules of the draw, easy first.
func (r *Repository) Rules(ctx context.Context, id uuid.UUID) ([]domain.DrawRule, error) {
	var rows []ruleRow
	err := r.db.Conn(ctx).Where("assessment_id = ?", id).
		Order("CASE difficulty WHEN 'EASY' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.DrawRule, len(rows))
	for i, row := range rows {
		out[i] = domain.DrawRule{Difficulty: row.Difficulty, Quantity: row.Quantity, Points: row.PointsPerQuestion}
	}
	return out, nil
}

// StudentIDs gives the chosen students of a SELECTED audience.
func (r *Repository) StudentIDs(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	var rows []studentRow
	if err := r.db.Conn(ctx).Where("assessment_id = ?", id).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]uuid.UUID, len(rows))
	for i, row := range rows {
		out[i] = row.StudentID
	}
	return out, nil
}

// Events gives the history of the assessment in the order it happened.
func (r *Repository) Events(ctx context.Context, id uuid.UUID) ([]domain.Event, error) {
	var events []domain.Event
	err := r.db.Conn(ctx).Where("assessment_id = ?", id).Order("created_at, id").Find(&events).Error
	return events, err
}

// Save writes the assessment, replaces the parts that came in rep and appends the event, in one transaction (RN-19). When one step fails nothing
// of the others stays.
func (r *Repository) Save(ctx context.Context, a *domain.Assessment, rep service.Replacements, e *domain.Event) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		tx := r.db.Conn(ctx)
		if err := tx.Save(a).Error; err != nil {
			return fmt.Errorf("save assessment: %w", err)
		}
		if rep.Items != nil {
			if err := replaceItems(tx, a.ID, *rep.Items); err != nil {
				return fmt.Errorf("replace the items: %w", err)
			}
		}
		if rep.Rules != nil {
			if err := replaceRules(tx, a.ID, *rep.Rules); err != nil {
				return fmt.Errorf("replace the draw rules: %w", err)
			}
		}
		if rep.Students != nil {
			if err := replaceStudents(tx, a.ID, *rep.Students); err != nil {
				return fmt.Errorf("replace the students: %w", err)
			}
		}
		if e != nil {
			return appendEvent(tx, a.ID, e)
		}
		return nil
	})
}

// SaveNotes writes only the private notes; UpdateColumns skips the automatic updated_at, as the notes are not a change of the assessment (RN-13).
func (r *Repository) SaveNotes(ctx context.Context, id uuid.UUID, notes *string) error {
	return r.db.Conn(ctx).Model(&domain.Assessment{}).Where("id = ?", id).
		UpdateColumns(map[string]any{"teacher_private_notes": notes}).Error
}

// ListByClass gives the assessments of a class, newest start first.
func (r *Repository) ListByClass(ctx context.Context, classID uuid.UUID) ([]domain.Assessment, error) {
	var list []domain.Assessment
	err := r.db.Conn(ctx).Where("class_id = ?", classID).Order("starts_at DESC, id").Find(&list).Error
	return list, err
}

// ListInRange gives the assessments of the classes whose period crosses [from, to): one that ends exactly at from, or starts exactly at to, is
// out.
func (r *Repository) ListInRange(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.Assessment, error) {
	if len(classIDs) == 0 {
		return nil, nil
	}
	var list []domain.Assessment
	err := r.db.Conn(ctx).Where("class_id IN ? AND starts_at < ? AND ends_at > ?", classIDs, to, from).Order("starts_at, id").Find(&list).Error
	return list, err
}

// HasActiveForLesson tells whether the lesson has a SCHEDULED assessment (RN-04).
func (r *Repository) HasActiveForLesson(ctx context.Context, lessonID uuid.UUID) (bool, error) {
	var n int64
	err := r.db.Conn(ctx).Model(&domain.Assessment{}).Where("class_session_id = ? AND status = ?", lessonID, domain.StatusScheduled).Count(&n).Error
	return n > 0, err
}

// InScheduledManual tells whether a SCHEDULED manual assessment lists the question (RN-18).
func (r *Repository) InScheduledManual(ctx context.Context, questionID uuid.UUID) (bool, error) {
	var found bool
	err := r.db.Conn(ctx).Raw(`SELECT EXISTS (SELECT 1 FROM assessment_items i JOIN assessments a ON a.id = i.assessment_id
		WHERE i.question_id = ? AND a.status = 'SCHEDULED' AND a.deleted_at IS NULL)`, questionID).Scan(&found).Error
	return found, err
}

// DrawDemand gives, by level, the biggest quantity a SCHEDULED draw of the module asks for (RN-18).
func (r *Repository) DrawDemand(ctx context.Context, moduleID uuid.UUID) (map[domain.Difficulty]int, error) {
	var rows []struct {
		Difficulty domain.Difficulty
		Demand     int
	}
	err := r.db.Conn(ctx).Raw(`SELECT r.difficulty AS difficulty, MAX(r.quantity) AS demand FROM assessment_draw_rules r
		JOIN assessments a ON a.id = r.assessment_id
		WHERE a.module_id = ? AND a.status = 'SCHEDULED' AND a.deleted_at IS NULL GROUP BY r.difficulty`, moduleID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[domain.Difficulty]int, len(rows))
	for _, row := range rows {
		out[row.Difficulty] = row.Demand
	}
	return out, nil
}
