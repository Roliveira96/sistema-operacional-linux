package repository

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

// ModuleSetup returns the snapshot of the module, or nil when it has none (SPEC-021).
func (r *Repository) ModuleSetup(ctx context.Context, moduleID uuid.UUID) (json.RawMessage, error) {
	var row struct{ Setup []byte }
	if err := r.db.Conn(ctx).Raw("SELECT setup FROM course_modules WHERE id = ?", moduleID).Scan(&row).Error; err != nil {
		return nil, err
	}
	if len(row.Setup) == 0 {
		return nil, nil
	}
	return json.RawMessage(row.Setup), nil
}

// SaveModuleSetup replaces the snapshot of the module.
func (r *Repository) SaveModuleSetup(ctx context.Context, moduleID uuid.UUID, setup json.RawMessage) error {
	return r.db.Conn(ctx).Exec("UPDATE course_modules SET setup = ?::jsonb WHERE id = ?", string(setup), moduleID).Error
}
