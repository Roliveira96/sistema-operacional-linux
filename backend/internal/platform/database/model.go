package database

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Model is the base embedded by every persisted entity: a UUIDv7 primary key,
// audit timestamps and soft delete.
type Model struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt gorm.DeletedAt `gorm:"index"`
}

// BeforeCreate assigns a UUIDv7 when the entity is created without an ID.
func (m *Model) BeforeCreate(_ *gorm.DB) error {
	if m.ID != uuid.Nil {
		return nil
	}
	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate uuidv7: %w", err)
	}
	m.ID = id
	return nil
}
