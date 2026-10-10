package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
)

// SeedOutcome tells what a seed operation did with an item (SPEC-011 RN-04).
type SeedOutcome string

// Seed outcomes.
const (
	SeedInserted  SeedOutcome = "INSERTED"
	SeedUpdated   SeedOutcome = "UPDATED"
	SeedPreserved SeedOutcome = "PRESERVED"
)

// SeedRepository is the persistence port used by the content seed.
type SeedRepository interface {
	FindModuleBySourceKey(ctx context.Context, sourceKey string) (domain.CourseModule, error)
	SaveSeededModule(ctx context.Context, module *domain.CourseModule) error
	ExerciseItemExists(ctx context.Context, moduleID, exerciseID uuid.UUID) (bool, error)
	NextExerciseOrder(ctx context.Context, moduleID uuid.UUID) (int, error)
	AddExerciseItem(ctx context.Context, item *domain.ModuleExerciseItem) error
}

// Seeder is the public interface of this module for the content seed
// (SPEC-011): the content module never touches course_modules directly.
type Seeder struct {
	repo SeedRepository
	now  func() time.Time
}

// NewSeeder creates the seeder.
func NewSeeder(repo SeedRepository) *Seeder {
	return &Seeder{repo: repo, now: time.Now}
}

// SeedModuleInput describes a module coming from the content manifest.
type SeedModuleInput struct {
	SourceKey    string
	Slug         string
	OwnerID      uuid.UUID
	Title        string
	Description  string
	Icon         string
	Color        string
	DisplayOrder int
	Visibility   domain.Visibility
}

// UpsertModule inserts a new seeded module, updates one the teacher has not
// edited, and leaves edited modules untouched. It returns the module ID.
func (s *Seeder) UpsertModule(ctx context.Context, in SeedModuleInput) (uuid.UUID, SeedOutcome, error) {
	if !domain.ValidateVisibility(in.Visibility) {
		return uuid.Nil, "", domain.ErrInvalidVisibility
	}
	existing, err := s.repo.FindModuleBySourceKey(ctx, in.SourceKey)
	var slugPtr *string
	if in.Slug != "" {
		slugPtr = &in.Slug
	}
	switch {
	case errors.Is(err, domain.ErrModuleNotFound):
		key, icon, color, order := in.SourceKey, in.Icon, in.Color, in.DisplayOrder
		m := domain.CourseModule{
			TeacherID:    in.OwnerID,
			Title:        in.Title,
			Description:  in.Description,
			Visibility:   in.Visibility,
			Status:       domain.ModuleStatusActive,
			SourceKey:    &key,
			Slug:         slugPtr,
			Icon:         &icon,
			Color:        &color,
			DisplayOrder: &order,
		}
		if err := s.repo.SaveSeededModule(ctx, &m); err != nil {
			return uuid.Nil, "", fmt.Errorf("insert seeded module %s: %w", in.SourceKey, err)
		}
		return m.ID, SeedInserted, nil
	case err != nil:
		return uuid.Nil, "", err
	case existing.EditedByTeacherAt != nil:
		return existing.ID, SeedPreserved, nil
	}
	icon, color, order := in.Icon, in.Color, in.DisplayOrder
	existing.Title = in.Title
	existing.Description = in.Description
	existing.Visibility = in.Visibility
	existing.Slug = slugPtr
	existing.Icon = &icon
	existing.Color = &color
	existing.DisplayOrder = &order
	if err := s.repo.SaveSeededModule(ctx, &existing); err != nil {
		return uuid.Nil, "", fmt.Errorf("update seeded module %s: %w", in.SourceKey, err)
	}
	return existing.ID, SeedUpdated, nil
}

// EnsureExercise links a question to the module's learning path when it is
// not linked yet, appending it after the last item (SPEC-011 RN-07). It
// reports whether a link was created.
func (s *Seeder) EnsureExercise(ctx context.Context, moduleID, questionID uuid.UUID) (bool, error) {
	exists, err := s.repo.ExerciseItemExists(ctx, moduleID, questionID)
	if err != nil || exists {
		return false, err
	}
	order, err := s.repo.NextExerciseOrder(ctx, moduleID)
	if err != nil {
		return false, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return false, err
	}
	now := s.now()
	item := domain.ModuleExerciseItem{
		ID: id, ModuleID: moduleID, ExerciseID: questionID, SequenceOrder: order,
		IsMandatory: true, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.AddExerciseItem(ctx, &item); err != nil {
		return false, fmt.Errorf("link exercise: %w", err)
	}
	return true, nil
}
