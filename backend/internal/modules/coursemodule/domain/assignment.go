package domain

import (
	"time"

	"github.com/google/uuid"
)

// ModuleClassAssignment links a private module to an authorized class.
type ModuleClassAssignment struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	ModuleID   uuid.UUID `gorm:"type:uuid;not null"`
	ClassID    uuid.UUID `gorm:"type:uuid;not null"`
	AssignedBy uuid.UUID `gorm:"type:uuid;not null"`
	CreatedAt  time.Time `gorm:"not null"`
}

// TableName maps to "module_class_assignments".
func (ModuleClassAssignment) TableName() string { return "module_class_assignments" }
