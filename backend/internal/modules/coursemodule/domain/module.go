// Package domain defines the entities and business rules for course modules (SPEC-010).
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Visibility defines access exposure of a module.
type Visibility string

const (
	VisibilityPublic        Visibility = "PUBLIC"
	VisibilityAuthenticated Visibility = "AUTHENTICATED"
	VisibilityPrivate       Visibility = "PRIVATE"
)

// ModuleStatus defines operational lifecycle of a module.
type ModuleStatus string

const (
	ModuleStatusActive   ModuleStatus = "ACTIVE"
	ModuleStatusInactive ModuleStatus = "INACTIVE"
	ModuleStatusArchived ModuleStatus = "ARCHIVED"
)

var (
	ErrModuleNotFound          = errors.New("course module not found")
	ErrModuleInactive          = errors.New("course module is inactive")
	ErrModuleExpired           = errors.New("course module is outside activation period")
	ErrInvalidVisibility       = errors.New("invalid module visibility")
	ErrInvalidStatus           = errors.New("invalid module status")
	ErrInvalidDateRange        = errors.New("activation start date must be before or equal to end date")
	ErrPrivateRequiresClass    = errors.New("private visibility requires at least one assigned class")
	ErrForbidden               = errors.New("user does not have permission for this module")
	ErrDuplicateExerciseOrder  = errors.New("duplicate exercise or sequence order detected")
	ErrInvalidExerciseSequence = errors.New("invalid exercise sequence order")
)

// CourseModule represents a pedagogical learning unit.
type CourseModule struct {
	database.Model
	TeacherID       uuid.UUID    `gorm:"type:uuid;not null"`
	Title           string       `gorm:"not null"`
	Description     string       `gorm:"not null"`
	Visibility      Visibility   `gorm:"not null"`
	Status          ModuleStatus `gorm:"not null;default:'ACTIVE'"`
	ActivationStart *time.Time
	ActivationEnd   *time.Time

	// Content seed metadata (SPEC-011). SourceKey identifies modules loaded
	// from the legacy content; EditedByTeacherAt protects them from reloads.
	SourceKey         *string
	Icon              *string
	Color             *string
	DisplayOrder      *int
	EditedByTeacherAt *time.Time
}

// TableName maps CourseModule to the "course_modules" table.
func (CourseModule) TableName() string { return "course_modules" }

// IsActiveNow evaluates if the module is operational and inside its activation time window.
func (m *CourseModule) IsActiveNow(now time.Time) bool {
	if m.Status != ModuleStatusActive {
		return false
	}
	if m.ActivationStart != nil && now.Before(*m.ActivationStart) {
		return false
	}
	if m.ActivationEnd != nil && now.After(*m.ActivationEnd) {
		return false
	}
	return true
}

// IsPubliclyAvailable checks if an anonymous or public visitor can access this module.
func (m *CourseModule) IsPubliclyAvailable(now time.Time) bool {
	return m.Visibility == VisibilityPublic && m.IsActiveNow(now)
}

// ValidateDates checks if activation dates are chronologically coherent.
func ValidateDates(start, end *time.Time) error {
	if start != nil && end != nil && start.After(*end) {
		return ErrInvalidDateRange
	}
	return nil
}

// ValidateVisibility checks if a given visibility string is valid.
func ValidateVisibility(v Visibility) bool {
	switch v {
	case VisibilityPublic, VisibilityAuthenticated, VisibilityPrivate:
		return true
	default:
		return false
	}
}
