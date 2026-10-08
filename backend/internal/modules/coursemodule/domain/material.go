package domain

import (
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ModuleMaterial represents an instructional material associated with a module.
type ModuleMaterial struct {
	database.Model
	ModuleID    uuid.UUID `gorm:"type:uuid;not null"`
	Title       string    `gorm:"not null"`
	Description *string
	URL         string    `gorm:"not null"`
}

// TableName maps to "module_materials".
func (ModuleMaterial) TableName() string { return "module_materials" }
