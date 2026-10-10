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
	// ErrInvalidExerciseOrder means the list is not exactly the exercises of the practice.
	ErrInvalidExerciseOrder = errors.New("the order must list every exercise of the practice once")
	// ErrExerciseIncomplete means the exercise has no condition that says how it ends, so it cannot be published.
	ErrExerciseIncomplete = errors.New("an exercise without conditions of finalization cannot be published")
	// ErrInvalidLinks means the links are not a combination the bank accepts (an exclusive exercise is in the assessment only).
	ErrInvalidLinks = errors.New("an exclusive exercise must be linked to the assessment and not to the practice")
	// ErrInvalidStatus means the status is not DRAFT or PUBLISHED.
	ErrInvalidStatus = errors.New("the status must be DRAFT or PUBLISHED")
	// ErrInvalidDependency means the exercise it depends on does not exist in the module, is itself, or would close a cycle.
	ErrInvalidDependency = errors.New("an exercise can only depend on another exercise of the module, without cycles")
)

// ExerciseLinks are the places of the module an exercise of the bank is linked to (SPEC-023 11.1): the practice (with a place
// in the trail), the assessment, and whether it is exclusive to the assessment, which keeps it out of the practice.
type ExerciseLinks struct {
	Practice   bool
	Assessment bool
	Exclusive  bool
}

// Valid reports whether the links are a combination the bank accepts.
func (l ExerciseLinks) Valid() bool { return !l.Exclusive || (l.Assessment && !l.Practice) }

// Usage is the usage column that says whether the exercise is in the practice.
func (l ExerciseLinks) Usage() string {
	if l.Practice {
		return domain.UsageExercise
	}
	return domain.UsageAssessment
}

// ExerciseRecord is an exercise as the store reads it: the question, and its place in the trail when it is in the practice.
type ExerciseRecord struct {
	domain.Question
	// Position is the place in the trail of the module, 0 for an exercise that is not in the practice.
	Position  int
	Mandatory bool
}

// Links are the links of the exercise as the store holds them.
func (r ExerciseRecord) Links() ExerciseLinks {
	return ExerciseLinks{Practice: r.Usage == domain.UsageExercise, Assessment: r.InAssessment, Exclusive: r.ExclusiveAssessment}
}

// ExerciseUpdate is what saving an exercise writes.
type ExerciseUpdate struct {
	Exercise domain.NormalizedExercise
	// Catalog is Exercise.Catalog as stored, the conditions that grade the student.
	Catalog json.RawMessage
	// DependsOn is the exercise whose recipe is built before this one (SPEC-023 D-16), nil for none.
	DependsOn *uuid.UUID
	By        uuid.UUID
	Now       time.Time
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
	// CreateExercise inserts the question and, when it is linked to the practice, gives it the last place of the trail.
	CreateExercise(ctx context.Context, q *domain.Question) error
	// UpdateExercise writes the exercise; when expected is not nil it only writes if the exercise still has that
	// updated_at, and returns ErrExerciseConflict otherwise.
	UpdateExercise(ctx context.Context, moduleID, id uuid.UUID, upd ExerciseUpdate, expected *time.Time) (ExerciseRecord, error)
	SetLinks(ctx context.Context, moduleID, id uuid.UUID, links ExerciseLinks, status string, now time.Time) (ExerciseRecord, error)
	DeleteExercise(ctx context.Context, moduleID, id uuid.UUID, now time.Time) error
	ReorderExercises(ctx context.Context, moduleID uuid.UUID, items []OrderItem, now time.Time) error
	// ValidDependency tells whether the exercise `id` (nil for one that does not exist yet) can depend on `dependsOn`.
	ValidDependency(ctx context.Context, moduleID uuid.UUID, id *uuid.UUID, dependsOn uuid.UUID) (bool, error)
	BankSetup(ctx context.Context, moduleID uuid.UUID) (json.RawMessage, error)
	SaveBankSetup(ctx context.Context, moduleID uuid.UUID, setup json.RawMessage) error
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

// ExerciseBank is the whole bank of a module: its exercises and the snapshot that prepares the machine of all of them.
type ExerciseBank struct {
	Items     []ExerciseRecord
	BankSetup json.RawMessage
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
	setup, err := s.store.BankSetup(ctx, moduleID)
	if err != nil {
		return ExerciseBank{}, err
	}
	return ExerciseBank{Items: items, BankSetup: setup}, nil
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

// checkDependency makes sure the exercise it depends on is one of the module and closes no cycle (SPEC-023 D-16).
func (s *Exercises) checkDependency(ctx context.Context, moduleID uuid.UUID, id *uuid.UUID, dependsOn *uuid.UUID) error {
	if dependsOn == nil {
		return nil
	}
	ok, err := s.store.ValidDependency(ctx, moduleID, id, *dependsOn)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidDependency
	}
	return nil
}

// Create stores a new exercise in the bank: a draft, linked where the teacher said (RN-03). An exercise created from a block
// of the screen comes already linked to it.
func (s *Exercises) Create(ctx context.Context, who Actor, moduleID uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, links ExerciseLinks) (ExerciseRecord, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return ExerciseRecord{}, err
	}
	if !links.Valid() {
		return ExerciseRecord{}, ErrInvalidLinks
	}
	clean, catalog, err := s.normalize(in)
	if err != nil {
		return ExerciseRecord{}, err
	}
	if err := s.checkDependency(ctx, moduleID, nil, dependsOn); err != nil {
		return ExerciseRecord{}, err
	}
	now := s.now()
	by := who.UserID
	q := domain.Question{
		ID: uuid.New(), ModuleID: moduleID, Kind: domain.KindPractical, Usage: links.Usage(), InAssessment: links.Assessment, ExclusiveAssessment: links.Exclusive,
		Difficulty: clean.Difficulty, Status: domain.StatusDraft, Title: clean.Title, Statement: clean.Statement, Hints: clean.Hints,
		ReferenceSolution: clean.Solution, EndConditions: clean.EndConditions, ValidationConditions: catalog, DependsOn: dependsOn,
		CreatedBy: &by, UpdatedBy: &by, EditedByTeacherAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateExercise(ctx, &q); err != nil {
		return ExerciseRecord{}, err
	}
	s.audit("create-exercise", who, moduleID, &q.ID)
	return s.store.FindExercise(ctx, moduleID, q.ID)
}

// Update saves an exercise; a change by someone else after expected is a conflict unless force is set (RN-05, CA-08).
func (s *Exercises) Update(ctx context.Context, who Actor, moduleID, id uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, expected time.Time, force bool) (ExerciseRecord, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return ExerciseRecord{}, err
	}
	clean, catalog, err := s.normalize(in)
	if err != nil {
		return ExerciseRecord{}, err
	}
	if err := s.checkDependency(ctx, moduleID, &id, dependsOn); err != nil {
		return ExerciseRecord{}, err
	}
	var guard *time.Time
	if !force {
		guard = &expected
	}
	record, err := s.store.UpdateExercise(ctx, moduleID, id, ExerciseUpdate{Exercise: clean, Catalog: catalog, DependsOn: dependsOn, By: who.UserID, Now: s.now()}, guard)
	if err != nil {
		return ExerciseRecord{}, err
	}
	s.audit("update-exercise", who, moduleID, &id)
	return record, nil
}

// SetLinks links an exercise to the practice and to the assessment, or unlinks it, and publishes it or takes it back to draft
// (RN-03, RN-04). It never removes the exercise from the bank. Publishing needs at least one condition of finalization, or nobody
// could finish it.
func (s *Exercises) SetLinks(ctx context.Context, who Actor, moduleID, id uuid.UUID, links ExerciseLinks, status string) (ExerciseRecord, error) {
	if status != domain.StatusDraft && status != domain.StatusPublished {
		return ExerciseRecord{}, ErrInvalidStatus
	}
	if !links.Valid() {
		return ExerciseRecord{}, ErrInvalidLinks
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
	record, err := s.store.SetLinks(ctx, moduleID, id, links, status, s.now())
	if err != nil {
		return ExerciseRecord{}, err
	}
	s.audit("exercise-links", who, moduleID, &id)
	return record, nil
}

// Delete removes an exercise from the bank, with the progress of the students in it (RN-09).
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

// Reorder sets the order of the trail and which exercises are mandatory: the list must be exactly the ones in the practice.
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

// SetBankSetup validates and stores the snapshot of the bank, the same for the practice and the assessment (SPEC-023 11.2).
// A nil snapshot removes it.
func (s *Exercises) SetBankSetup(ctx context.Context, who Actor, moduleID uuid.UUID, raw json.RawMessage) (json.RawMessage, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return nil, err
	}
	var clean json.RawMessage
	if len(raw) > 0 && string(raw) != "null" {
		var err error
		clean, err = domain.NormalizeSetup(raw)
		var perr *domain.PayloadError
		if errors.As(err, &perr) {
			for i := range perr.Fields {
				perr.Fields[i].Field = "bankSetup" + perr.Fields[i].Field[len("setup"):]
			}
		}
		if err != nil {
			return nil, err
		}
	}
	if err := s.store.SaveBankSetup(ctx, moduleID, clean); err != nil {
		return nil, err
	}
	s.audit("bank-setup", who, moduleID, nil)
	return clean, nil
}
