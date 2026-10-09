package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// MaxVersionNote is the longest note of a version (SPEC-021 5).
const MaxVersionNote = 200

// ModuleVersion is a frozen copy of the content of a module: its blocks and its snapshot (SPEC-021).
type ModuleVersion struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	ModuleID    uuid.UUID `gorm:"type:uuid"`
	Number      int
	Note        string
	Content     json.RawMessage `gorm:"type:jsonb"`
	ContentHash string
	CreatedBy   *uuid.UUID `gorm:"type:uuid"`
	CreatedAt   time.Time
}

func (ModuleVersion) TableName() string { return "module_versions" }

// VersionContent is what a version holds.
type VersionContent struct {
	Blocks []VersionBlock  `json:"blocks"`
	Setup  json.RawMessage `json:"setup"`
}

// VersionBlock is one block of a version; Active is false for a block the author inactivated.
type VersionBlock struct {
	ID       uuid.UUID       `json:"id"`
	Type     BlockType       `json:"type"`
	Position int             `json:"position"`
	Payload  json.RawMessage `json:"payload"`
	Active   bool            `json:"active"`
}

// ContentBlocks returns the blocks of the version as content blocks, the active ones only when activeOnly is set.
func (c VersionContent) ContentBlocks(moduleID uuid.UUID, activeOnly bool) []ContentBlock {
	out := make([]ContentBlock, 0, len(c.Blocks))
	for _, b := range c.Blocks {
		if activeOnly && !b.Active {
			continue
		}
		out = append(out, ContentBlock{ID: b.ID, ModuleID: moduleID, BlockType: b.Type, Position: b.Position, Payload: b.Payload})
	}
	return out
}

// SetupOrNil is the snapshot of the module stored in the version, or nil when it had none.
func (c VersionContent) SetupOrNil() json.RawMessage {
	if len(c.Setup) == 0 || string(c.Setup) == "null" {
		return nil
	}
	return c.Setup
}
