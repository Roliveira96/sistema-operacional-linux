package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// Errors of the exercises of the module (SPEC-023).
var (
	ErrExerciseNotFound = errors.New("exercise not found")
	// ErrExerciseConflict means the exercise changed after the instant the editor knew.
	ErrExerciseConflict = errors.New("exercise was changed by someone else")
	// ErrInvalidExerciseOrder means the list is not exactly the available exercises of the module.
	ErrInvalidExerciseOrder = errors.New("the order must list every available exercise once")
	// ErrExerciseIncomplete means the exercise has no condition that says how it ends, so it cannot be published.
	ErrExerciseIncomplete = errors.New("an exercise without conditions of finalization cannot be published")
	// ErrInvalidAvailability means the usage or the status is not one the teacher can choose.
	ErrInvalidAvailability = errors.New("the usage must be EXERCISE or ASSESSMENT and the status DRAFT or PUBLISHED")
)

// ExerciseRecord is an exercise as the store reads it: the question, and its place in the trail when it is available.
type ExerciseRecord struct {
	domain.Question
	// Position is the place in the trail of the module, 0 for an exercise reserved for assessment.
	Position  int
	Mandatory bool
}

// ExerciseUpdate is what saving an exercise writes.
type ExerciseUpdate struct {
	Exercise domain.NormalizedExercise
	// Catalog is Exercise.Catalog as stored, the conditions that grade the student.
	Catalog json.RawMessage
	By      uuid.UUID
	Now     time.Time
}

// OrderItem is one place of the trail of the module.
type OrderItem struct {
	ExerciseID uuid.UUID
	Mandatory  bool
}

// ExerciseStore is the persistence of the exercises of the module.
type ExerciseStore interface {
	ModuleTeacher(ctx context.Context, moduleID uuid.UUID) (uuid.UUID, error)
	ListExercises(ctx context.Context, moduleID uuid.UUID) ([]ExerciseRecord, error)
	FindExercise(ctx context.Context, moduleID, id uuid.UUID) (ExerciseRecord, error)
	CreateExercise(ctx context.Context, q *domain.Question) error
	// UpdateExercise writes the exercise; when expected is not nil it only writes if the exercise still has that
	// updated_at, and returns ErrExerciseConflict otherwise.
	UpdateExercise(ctx context.Context, moduleID, id uuid.UUID, upd ExerciseUpdate, expected *time.Time) (ExerciseRecord, error)
	SetAvailability(ctx context.Context, moduleID, id uuid.UUID, usage, status string, now time.Time) (ExerciseRecord, error)
	DeleteExercise(ctx context.Context, moduleID, id uuid.UUID, now time.Time) error
	ReorderExercises(ctx context.Context, moduleID uuid.UUID, items []OrderItem, now time.Time) error
	ExerciseSetups(ctx context.Context, moduleID uuid.UUID) (exercises, assessment json.RawMessage, err error)
	SaveExerciseSetups(ctx context.Context, moduleID uuid.UUID, exercises, assessment json.RawMessage) error
}

// Exercises is the use case of the exercises of the module and its bank (SPEC-023).
type Exercises struct {
	store ExerciseStore
	san   *domain.HTMLSanitizer
	log   *zap.Logger
	now   func() time.Time
}

// NewExercises creates the service.
func NewExercises(store ExerciseStore, log *zap.Logger) *Exercises {
	return &Exercises{store: store, san: domain.NewHTMLSanitizer(), log: log.Named("exercises"), now: microNow}
}

// authorize lets ADMIN and the TEACHER who owns the module through (SPEC-023 RN-02).
func (s *Exercises) authorize(ctx context.Context, moduleID uuid.UUID, who Actor) error {
	owner, err := s.store.ModuleTeacher(ctx, moduleID)
	if errors.Is(err, ErrNotFound) {
		return ErrModuleNotFound
	}
	if err != nil {
		return err
	}
	if who.Role == "ADMIN" || (who.Role == "TEACHER" && owner == who.UserID) {
		return nil
	}
	return ErrForbidden
}

func (s *Exercises) audit(action string, who Actor, moduleID uuid.UUID, exerciseID *uuid.UUID) {
	fields := []zap.Field{zap.String("action", action), zap.String("userId", who.UserID.String()), zap.String("moduleId", moduleID.String())}
	if exerciseID != nil {
		fields = append(fields, zap.String("exerciseId", exerciseID.String()))
	}
	s.log.Info("module exercise change", fields...)
}

// ExerciseBank is the whole bank of a module: its exercises and the snapshots of the two sets.
type ExerciseBank struct {
	Items           []ExerciseRecord
	ExercisesSetup  json.RawMessage
	AssessmentSetup json.RawMessage
}

// List returns the bank of the module (RN-01).
func (s *Exercises) List(ctx context.Context, who Actor, moduleID uuid.UUID) (ExerciseBank, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return ExerciseBank{}, err
	}
	items, err := s.store.ListExercises(ctx, moduleID)
	if err != nil {
		return ExerciseBank{}, err
	}
	exercises, assessment, err := s.store.ExerciseSetups(ctx, moduleID)
	if err != nil {
		return ExerciseBank{}, err
	}
	return ExerciseBank{Items: items, ExercisesSetup: exercises, AssessmentSetup: assessment}, nil
}

// Get returns one exercise.
func (s *Exercises) Get(ctx context.Context, who Actor, moduleID, id uuid.UUID) (ExerciseRecord, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return ExerciseRecord{}, err
	}
	return s.store.FindExercise(ctx, moduleID, id)
}

func (s *Exercises) normalize(in domain.ExerciseInput) (domain.NormalizedExercise, json.RawMessage, error) {
	clean, err := domain.NormalizeExercise(in, s.san)
	if err != nil {
		return domain.NormalizedExercise{}, nil, err
	}
	catalog, err := json.Marshal(clean.Catalog)
	if err != nil {
		return domain.NormalizedExercise{}, nil, err
	}
	return clean, catalog, nil
}

// Create stores a new exercise: a draft, reserved for assessment until the teacher makes it available (RN-03).
func (s *Exercises) Create(ctx context.Context, who Actor, moduleID uuid.UUID, in domain.ExerciseInput) (ExerciseRecord, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return ExerciseRecord{}, err
	}
	clean, catalog, err := s.normalize(in)
	if err != nil {
		return ExerciseRecord{}, err
	}
	now := s.now()
	by := who.UserID
	q := domain.Question{
		ID: uuid.New(), ModuleID: moduleID, Kind: domain.KindPractical, Usage: domain.UsageAssessment, Difficulty: clean.Difficulty,
		Status: domain.StatusDraft, Title: clean.Title, Statement: clean.Statement, Hints: clean.Hints, ReferenceSolution: clean.Solution,
		EndConditions: clean.EndConditions, ValidationConditions: catalog, ContinuesPrevious: clean.ContinuesPrevious, CreatedBy: &by, UpdatedBy: &by, EditedByTeacherAt: &now,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateExercise(ctx, &q); err != nil {
		return ExerciseRecord{}, err
	}
	s.audit("create-exercise", who, moduleID, &q.ID)
	return s.store.FindExercise(ctx, moduleID, q.ID)
}

// Update saves an exercise; a change by someone else after expected is a conflict unless force is set (RN-05, CA-08).
func (s *Exercises) Update(ctx context.Context, who Actor, moduleID, id uuid.UUID, in domain.ExerciseInput, expected time.Time, force bool) (ExerciseRecord, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return ExerciseRecord{}, err
	}
	clean, catalog, err := s.normalize(in)
	if err != nil {
		return ExerciseRecord{}, err
	}
	var guard *time.Time
	if !force {
		guard = &expected
	}
	record, err := s.store.UpdateExercise(ctx, moduleID, id, ExerciseUpdate{Exercise: clean, Catalog: catalog, By: who.UserID, Now: s.now()}, guard)
	if err != nil {
		return ExerciseRecord{}, err
	}
	s.audit("update-exercise", who, moduleID, &id)
	return record, nil
}

// SetAvailability makes an exercise available in the module or reserves it for assessment, and publishes it or takes it back to
// draft (RN-03, RN-04). Publishing needs at least one condition of finalization, or nobody could finish it.
func (s *Exercises) SetAvailability(ctx context.Context, who Actor, moduleID, id uuid.UUID, usage, status string) (ExerciseRecord, error) {
	if (usage != domain.UsageExercise && usage != domain.UsageAssessment) || (status != domain.StatusDraft && status != domain.StatusPublished) {
		return ExerciseRecord{}, ErrInvalidAvailability
	}
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return ExerciseRecord{}, err
	}
	if status == domain.StatusPublished {
		current, err := s.store.FindExercise(ctx, moduleID, id)
		if err != nil {
			return ExerciseRecord{}, err
		}
		if len(current.ValidationConditions) == 0 || string(current.ValidationConditions) == "[]" || string(current.ValidationConditions) == "null" {
			return ExerciseRecord{}, ErrExerciseIncomplete
		}
	}
	record, err := s.store.SetAvailability(ctx, moduleID, id, usage, status, s.now())
	if err != nil {
		return ExerciseRecord{}, err
	}
	s.audit("exercise-availability", who, moduleID, &id)
	return record, nil
}

// Delete removes an exercise and the progress of the students in it (RN-09).
func (s *Exercises) Delete(ctx context.Context, who Actor, moduleID, id uuid.UUID) error {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return err
	}
	if err := s.store.DeleteExercise(ctx, moduleID, id, s.now()); err != nil {
		return err
	}
	s.audit("delete-exercise", who, moduleID, &id)
	return nil
}

// Reorder sets the order of the trail and which exercises are mandatory: the list must be exactly the available ones.
func (s *Exercises) Reorder(ctx context.Context, who Actor, moduleID uuid.UUID, items []OrderItem) error {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return err
	}
	if err := s.store.ReorderExercises(ctx, moduleID, items, s.now()); err != nil {
		return err
	}
	s.audit("reorder-exercises", who, moduleID, nil)
	return nil
}

// SetSetups validates and stores the snapshots of the two sets (RN-06). A nil snapshot removes it.
func (s *Exercises) SetSetups(ctx context.Context, who Actor, moduleID uuid.UUID, exercises, assessment json.RawMessage) (json.RawMessage, json.RawMessage, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return nil, nil, err
	}
	clean := func(raw json.RawMessage, field string) (json.RawMessage, error) {
		if len(raw) == 0 || string(raw) == "null" {
			return nil, nil
		}
		out, err := domain.NormalizeSetup(raw)
		var perr *domain.PayloadError
		if errors.As(err, &perr) {
			for i := range perr.Fields {
				perr.Fields[i].Field = field + perr.Fields[i].Field[len("setup"):]
			}
		}
		return out, err
	}
	cleanExercises, err := clean(exercises, "exercisesSetup")
	if err != nil {
		return nil, nil, err
	}
	cleanAssessment, err := clean(assessment, "assessmentSetup")
	if err != nil {
		return nil, nil, err
	}
	if err := s.store.SaveExerciseSetups(ctx, moduleID, cleanExercises, cleanAssessment); err != nil {
		return nil, nil, err
	}
	s.audit("exercise-setups", who, moduleID, nil)
	return cleanExercises, cleanAssessment, nil
}
