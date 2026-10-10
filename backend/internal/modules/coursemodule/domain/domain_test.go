package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
)

func TestCourseModule_IsActiveNow(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	past := now.Add(-2 * time.Hour)
	future := now.Add(2 * time.Hour)

	tests := []struct {
		name     string
		module   domain.CourseModule
		expected bool
	}{
		{
			name: "active with no date limits",
			module: domain.CourseModule{
				Status: domain.ModuleStatusActive,
			},
			expected: true,
		},
		{
			name: "inactive with no date limits",
			module: domain.CourseModule{
				Status: domain.ModuleStatusInactive,
			},
			expected: false,
		},
		{
			name: "archived with valid window",
			module: domain.CourseModule{
				Status:          domain.ModuleStatusArchived,
				ActivationStart: &past,
				ActivationEnd:   &future,
			},
			expected: false,
		},
		{
			name: "active within window",
			module: domain.CourseModule{
				Status:          domain.ModuleStatusActive,
				ActivationStart: &past,
				ActivationEnd:   &future,
			},
			expected: true,
		},
		{
			name: "active but starts in future",
			module: domain.CourseModule{
				Status:          domain.ModuleStatusActive,
				ActivationStart: &future,
			},
			expected: false,
		},
		{
			name: "active but ended in past",
			module: domain.CourseModule{
				Status:        domain.ModuleStatusActive,
				ActivationEnd: &past,
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.module.IsActiveNow(now))
		})
	}
}

func TestCourseModule_IsPubliclyAvailable(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

	t.Run("public and active returns true", func(t *testing.T) {
		m := domain.CourseModule{
			Visibility: domain.VisibilityPublic,
			Status:     domain.ModuleStatusActive,
		}
		assert.True(t, m.IsPubliclyAvailable(now))
	})

	t.Run("authenticated and active returns false", func(t *testing.T) {
		m := domain.CourseModule{
			Visibility: domain.VisibilityAuthenticated,
			Status:     domain.ModuleStatusActive,
		}
		assert.False(t, m.IsPubliclyAvailable(now))
	})

	t.Run("private and active returns false", func(t *testing.T) {
		m := domain.CourseModule{
			Visibility: domain.VisibilityPrivate,
			Status:     domain.ModuleStatusActive,
		}
		assert.False(t, m.IsPubliclyAvailable(now))
	})
}

func TestValidateDates(t *testing.T) {
	now := time.Now()
	past := now.Add(-1 * time.Hour)
	future := now.Add(1 * time.Hour)

	assert.NoError(t, domain.ValidateDates(nil, nil))
	assert.NoError(t, domain.ValidateDates(&past, &future))
	assert.NoError(t, domain.ValidateDates(&now, &now))
	assert.Equal(t, domain.ErrInvalidDateRange, domain.ValidateDates(&future, &past))
}

func TestValidateVisibility(t *testing.T) {
	assert.True(t, domain.ValidateVisibility(domain.VisibilityPublic))
	assert.True(t, domain.ValidateVisibility(domain.VisibilityAuthenticated))
	assert.True(t, domain.ValidateVisibility(domain.VisibilityPrivate))
	assert.False(t, domain.ValidateVisibility("UNKNOWN"))
}

func TestTableNames(t *testing.T) {
	assert.Equal(t, "course_modules", domain.CourseModule{}.TableName())
	assert.Equal(t, "module_class_assignments", domain.ModuleClassAssignment{}.TableName())
	assert.Equal(t, "module_exercise_items", domain.ModuleExerciseItem{}.TableName())
	assert.Equal(t, "module_materials", domain.ModuleMaterial{}.TableName())
}

func TestEntitiesFields(t *testing.T) {
	id := uuid.New()
	assignment := domain.ModuleClassAssignment{
		ID:         id,
		ModuleID:   id,
		ClassID:    id,
		AssignedBy: id,
		CreatedAt:  time.Now(),
	}
	assert.Equal(t, id, assignment.ID)

	item := domain.ModuleExerciseItem{
		ID:            id,
		ModuleID:      id,
		ExerciseID:    id,
		SequenceOrder: 1,
		IsMandatory:   true,
	}
	assert.Equal(t, 1, item.SequenceOrder)

	desc := "desc"
	mat := domain.ModuleMaterial{
		ModuleID:    id,
		Title:       "Title",
		Description: &desc,
		URL:         "https://example.com",
	}
	assert.Equal(t, "Title", mat.Title)
}

// Covers SPEC-010 (slug): the shape of a module slug.
func TestValidateSlug(t *testing.T) {
	valid := []string{"abc", "historia-do-linux", "modulo-2", "a1b", "x-y-z", strings.Repeat("a", 60)}
	for _, slug := range valid {
		assert.NoError(t, domain.ValidateSlug(slug), slug)
	}
	invalid := []string{"", "ab", strings.Repeat("a", 61), "Historia", "com espaço", "acentuação", "-inicio", "fim-", "duplo--hifen", "under_score", "pon.to", "barra/x"}
	for _, slug := range invalid {
		assert.ErrorIs(t, domain.ValidateSlug(slug), domain.ErrInvalidSlug, slug)
	}
}

func TestNormalizeSlug(t *testing.T) {
	assert.Equal(t, "meu-modulo", domain.NormalizeSlug("  Meu-Modulo \n"))
	assert.Equal(t, "", domain.NormalizeSlug("   "))
}

// Covers SPEC-010: a module may have only a start, only an end, both or none.
func TestValidateDatesOpenEnded(t *testing.T) {
	start := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	assert.NoError(t, domain.ValidateDates(nil, nil), "no dates")
	assert.NoError(t, domain.ValidateDates(&start, nil), "only a start")
	assert.NoError(t, domain.ValidateDates(nil, &end), "only an end")
	assert.NoError(t, domain.ValidateDates(&start, &end), "start before end")
	assert.NoError(t, domain.ValidateDates(&start, &start), "same instant is allowed")
	assert.ErrorIs(t, domain.ValidateDates(&end, &start), domain.ErrInvalidDateRange, "end before start")
}
