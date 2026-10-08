package domain

import (
	"time"

	"github.com/google/uuid"
)

// ModuleExerciseItem represents a sequenced activity in the pedagogical path.
type ModuleExerciseItem struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey"`
	ModuleID      uuid.UUID `gorm:"type:uuid;not null"`
	ExerciseID    uuid.UUID `gorm:"type:uuid;not null"`
	SequenceOrder int       `gorm:"not null"`
	IsMandatory   bool      `gorm:"not null;default:true"`
	CreatedAt     time.Time `gorm:"not null"`
	UpdatedAt     time.Time `gorm:"not null"`
}

// TableName maps to "module_exercise_items".
func (ModuleExerciseItem) TableName() string { return "module_exercise_items" }
