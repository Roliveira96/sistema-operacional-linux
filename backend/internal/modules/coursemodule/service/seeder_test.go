package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
)

type fakeSeedRepo struct {
	modules map[string]domain.CourseModule
	items   []domain.ModuleExerciseItem
	err     error
}

func (f *fakeSeedRepo) FindModuleBySourceKey(_ context.Context, key string) (domain.CourseModule, error) {
	if f.err != nil {
		return domain.CourseModule{}, f.err
	}
	m, ok := f.modules[key]
	if !ok {
		return domain.CourseModule{}, domain.ErrModuleNotFound
	}
	return m, nil
}

func (f *fakeSeedRepo) SaveSeededModule(_ context.Context, m *domain.CourseModule) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	f.modules[*m.SourceKey] = *m
	return nil
}

func (f *fakeSeedRepo) ExerciseItemExists(_ context.Context, moduleID, exerciseID uuid.UUID) (bool, error) {
	for _, it := range f.items {
		if it.ModuleID == moduleID && it.ExerciseID == exerciseID {
			return true, nil
		}
	}
	return false, f.err
}

func (f *fakeSeedRepo) NextExerciseOrder(_ context.Context, moduleID uuid.UUID) (int, error) {
	n := 0
	for _, it := range f.items {
		if it.ModuleID == moduleID && it.SequenceOrder > n {
			n = it.SequenceOrder
		}
	}
	return n + 1, nil
}

func (f *fakeSeedRepo) AddExerciseItem(_ context.Context, it *domain.ModuleExerciseItem) error {
	f.items = append(f.items, *it)
	return nil
}

func seedInput() SeedModuleInput {
	return SeedModuleInput{SourceKey: "diretorios", OwnerID: uuid.New(), Title: "Diretórios", Description: "d",
		Icon: "📁", Color: "--cor-dir", DisplayOrder: 3, Visibility: domain.VisibilityPublic}
}

// Covers SPEC-011 RN-04 for modules.
func TestSeederUpsertModule(t *testing.T) {
	repo := &fakeSeedRepo{modules: map[string]domain.CourseModule{}}
	s := NewSeeder(repo)

	id, outcome, err := s.UpsertModule(context.Background(), seedInput())
	require.NoError(t, err)
	assert.Equal(t, SeedInserted, outcome)
	saved := repo.modules["diretorios"]
	assert.Equal(t, domain.ModuleStatusActive, saved.Status)
	assert.Equal(t, 3, *saved.DisplayOrder)

	in := seedInput()
	in.Title = "Diretórios e caminhos"
	again, outcome, err := s.UpsertModule(context.Background(), in)
	require.NoError(t, err)
	assert.Equal(t, SeedUpdated, outcome)
	assert.Equal(t, id, again)
	assert.Equal(t, "Diretórios e caminhos", repo.modules["diretorios"].Title)

	edited := time.Now()
	m := repo.modules["diretorios"]
	m.EditedByTeacherAt = &edited
	repo.modules["diretorios"] = m
	in.Title = "Overwritten?"
	_, outcome, err = s.UpsertModule(context.Background(), in)
	require.NoError(t, err)
	assert.Equal(t, SeedPreserved, outcome)
	assert.Equal(t, "Diretórios e caminhos", repo.modules["diretorios"].Title)
}

func TestSeederUpsertModuleErrors(t *testing.T) {
	s := NewSeeder(&fakeSeedRepo{modules: map[string]domain.CourseModule{}, err: errors.New("db down")})
	in := seedInput()
	_, _, err := s.UpsertModule(context.Background(), in)
	assert.EqualError(t, err, "db down")
	in.Visibility = "SECRET"
	_, _, err = s.UpsertModule(context.Background(), in)
	assert.ErrorIs(t, err, domain.ErrInvalidVisibility)
}

// Covers SPEC-011 RN-07.
func TestSeederEnsureExercise(t *testing.T) {
	repo := &fakeSeedRepo{modules: map[string]domain.CourseModule{}}
	s := NewSeeder(repo)
	moduleID := uuid.New()
	q1, q2 := uuid.New(), uuid.New()

	created, err := s.EnsureExercise(context.Background(), moduleID, q1)
	require.NoError(t, err)
	assert.True(t, created)
	created, err = s.EnsureExercise(context.Background(), moduleID, q2)
	require.NoError(t, err)
	assert.True(t, created)
	created, err = s.EnsureExercise(context.Background(), moduleID, q1)
	require.NoError(t, err)
	assert.False(t, created, "existing links are kept")

	require.Len(t, repo.items, 2)
	assert.Equal(t, 1, repo.items[0].SequenceOrder)
	assert.Equal(t, 2, repo.items[1].SequenceOrder)
	assert.True(t, repo.items[1].IsMandatory)
}
