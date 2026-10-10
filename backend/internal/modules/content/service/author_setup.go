package service

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// Setup returns the snapshot of the module, which is part of the draft (SPEC-021 RN-01).
func (a *Author) Setup(ctx context.Context, who Actor, moduleID uuid.UUID) (json.RawMessage, error) {
	if err := a.authorize(ctx, moduleID, who); err != nil {
		return nil, err
	}
	return a.store.ModuleSetup(ctx, moduleID)
}

// SetSetup validates and stores the snapshot of the module (SPEC-021 RN-01).
func (a *Author) SetSetup(ctx context.Context, who Actor, moduleID uuid.UUID, raw json.RawMessage) (json.RawMessage, error) {
	if err := a.authorize(ctx, moduleID, who); err != nil {
		return nil, err
	}
	clean, err := domain.NormalizeSetup(raw)
	if err != nil {
		return nil, err
	}
	if err := a.store.SaveModuleSetup(ctx, moduleID, clean); err != nil {
		return nil, err
	}
	a.audit("module-setup", who, moduleID, nil)
	return clean, nil
}
