package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// Authoring errors (SPEC-019).
var (
	ErrBlockNotFound = errors.New("content block not found")
	// ErrBlockConflict means the block changed after the instant the editor knew.
	ErrBlockConflict = errors.New("content block was changed by someone else")
	// ErrInvalidOrder means the list of ids is not exactly the blocks of the module.
	ErrInvalidOrder = errors.New("the order must list every block of the module once")
)

// AuthorStore is the persistence the authoring needs. Create, delete and
// reorder keep the positions of the module sequential from 1 to N.
type AuthorStore interface {
	ModuleTeacher(ctx context.Context, moduleID uuid.UUID) (uuid.UUID, error)
	FindBlock(ctx context.Context, id uuid.UUID) (domain.ContentBlock, error)
	ListBlocks(ctx context.Context, moduleID uuid.UUID) ([]domain.ContentBlock, error)
	// InsertBlock puts the block after afterID, or at the end when afterID is nil.
	InsertBlock(ctx context.Context, b *domain.ContentBlock, afterID *uuid.UUID) error
	// UpdateBlock replaces the payload. When expected is not nil it only writes
	// if the block still has that updated_at, and returns ErrBlockConflict otherwise.
	UpdateBlock(ctx context.Context, id uuid.UUID, payload json.RawMessage, expected *time.Time, now time.Time) (domain.ContentBlock, error)
	DeleteBlock(ctx context.Context, b domain.ContentBlock) error
	// ReplaceCard applies a whole card in one transaction (SPEC-019 RN-13) and returns its blocks in order.
	ReplaceCard(ctx context.Context, in ReplaceCardInput) ([]domain.ContentBlock, error)
	// ModuleSetup and SaveModuleSetup read and write the snapshot of the module (SPEC-021).
	ModuleSetup(ctx context.Context, moduleID uuid.UUID) (json.RawMessage, error)
	SaveModuleSetup(ctx context.Context, moduleID uuid.UUID, setup json.RawMessage) error
	// SetActiveMany inactivates or reactivates blocks of a module, marking them as edited.
	SetActiveMany(ctx context.Context, moduleID uuid.UUID, ids []uuid.UUID, active bool, now time.Time) error
	// SetActive inactivates (active=false) or reactivates a block and marks it as edited.
	SetActive(ctx context.Context, id uuid.UUID, active bool, now time.Time) (domain.ContentBlock, error)
	ReorderBlocks(ctx context.Context, moduleID uuid.UUID, ids []uuid.UUID, now time.Time) error
}

// Actor is who edits.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// Author is the block authoring use case (SPEC-019).
type Author struct {
	store AuthorStore
	san   *domain.HTMLSanitizer
	log   *zap.Logger
	now   func() time.Time
}

// microNow is the clock at the precision the database keeps, so the instant returned
// to the editor is exactly the one it must send back to detect a conflict (RN-08).
func microNow() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }

// NewAuthor creates the authoring service.
func NewAuthor(store AuthorStore, log *zap.Logger) *Author {
	return &Author{store: store, san: domain.NewHTMLSanitizer(), log: log.Named("authoring"), now: microNow}
}

// authorize lets ADMIN edit any module and TEACHER only the ones they created (RN-01).
func (a *Author) authorize(ctx context.Context, moduleID uuid.UUID, who Actor) error {
	owner, err := a.store.ModuleTeacher(ctx, moduleID)
	if errors.Is(err, ErrNotFound) {
		return ErrModuleNotFound
	}
	if err != nil {
		return err
	}
	if who.Role == "ADMIN" || (who.Role == "TEACHER" && owner == who.UserID) {
		return nil
	}
	return ErrForbidden
}

func (a *Author) audit(action string, who Actor, moduleID uuid.UUID, blockID *uuid.UUID) {
	fields := []zap.Field{zap.String("action", action), zap.String("userId", who.UserID.String()), zap.String("moduleId", moduleID.String())}
	if blockID != nil {
		fields = append(fields, zap.String("blockId", blockID.String()))
	}
	a.log.Info("content block change", fields...)
}

// List returns the whole content of the module, in order.
func (a *Author) List(ctx context.Context, who Actor, moduleID uuid.UUID) ([]domain.ContentBlock, error) {
	if err := a.authorize(ctx, moduleID, who); err != nil {
		return nil, err
	}
	return a.store.ListBlocks(ctx, moduleID)
}

// Create validates and stores a new block (RN-02 to RN-07).
func (a *Author) Create(ctx context.Context, who Actor, moduleID uuid.UUID, t domain.BlockType, payload json.RawMessage, afterID *uuid.UUID) (domain.ContentBlock, error) {
	if err := a.authorize(ctx, moduleID, who); err != nil {
		return domain.ContentBlock{}, err
	}
	clean, err := domain.NormalizePayload(t, payload, a.san)
	if err != nil {
		return domain.ContentBlock{}, err
	}
	if afterID != nil {
		after, err := a.store.FindBlock(ctx, *afterID)
		if errors.Is(err, ErrNotFound) || (err == nil && after.ModuleID != moduleID) {
			return domain.ContentBlock{}, ErrBlockNotFound
		}
		if err != nil {
			return domain.ContentBlock{}, err
		}
	}
	now := a.now()
	b := domain.ContentBlock{ID: uuid.New(), ModuleID: moduleID, BlockType: t, Payload: clean, EditedByTeacherAt: &now, CreatedAt: now, UpdatedAt: now}
	if err := a.store.InsertBlock(ctx, &b, afterID); err != nil {
		return domain.ContentBlock{}, err
	}
	a.audit("create", who, moduleID, &b.ID)
	return b, nil
}

// find loads the block and checks the editor may change its module.
func (a *Author) find(ctx context.Context, who Actor, blockID uuid.UUID) (domain.ContentBlock, error) {
	b, err := a.store.FindBlock(ctx, blockID)
	if errors.Is(err, ErrNotFound) {
		return b, ErrBlockNotFound
	}
	if err != nil {
		return b, err
	}
	return b, a.authorize(ctx, b.ModuleID, who)
}

// Update replaces the payload of a block; the type never changes (RN-02, RN-08).
func (a *Author) Update(ctx context.Context, who Actor, blockID uuid.UUID, payload json.RawMessage, expected time.Time, force bool) (domain.ContentBlock, error) {
	b, err := a.find(ctx, who, blockID)
	if err != nil {
		return domain.ContentBlock{}, err
	}
	clean, err := domain.NormalizePayload(b.BlockType, payload, a.san)
	if err != nil {
		return domain.ContentBlock{}, err
	}
	var guard *time.Time
	if !force {
		guard = &expected
	}
	updated, err := a.store.UpdateBlock(ctx, blockID, clean, guard, a.now())
	if err != nil {
		return domain.ContentBlock{}, err
	}
	a.audit("update", who, b.ModuleID, &blockID)
	return updated, nil
}

// SetActive inactivates or reactivates a block (RN-12). Idempotent.
func (a *Author) SetActive(ctx context.Context, who Actor, blockID uuid.UUID, active bool) (domain.ContentBlock, error) {
	b, err := a.find(ctx, who, blockID)
	if err != nil {
		return domain.ContentBlock{}, err
	}
	updated, err := a.store.SetActive(ctx, blockID, active, a.now())
	if err != nil {
		return domain.ContentBlock{}, err
	}
	action := "inactivate"
	if active {
		action = "activate"
	}
	a.audit(action, who, b.ModuleID, &blockID)
	return updated, nil
}

// Delete removes a block and the reading progress on it (RN-09).
func (a *Author) Delete(ctx context.Context, who Actor, blockID uuid.UUID) error {
	b, err := a.find(ctx, who, blockID)
	if err != nil {
		return err
	}
	if err := a.store.DeleteBlock(ctx, b); err != nil {
		return err
	}
	a.audit("delete", who, b.ModuleID, &blockID)
	return nil
}

// Reorder sets the order of the blocks; ids must be exactly the module blocks (RN-06).
func (a *Author) Reorder(ctx context.Context, who Actor, moduleID uuid.UUID, ids []uuid.UUID) ([]domain.ContentBlock, error) {
	if err := a.authorize(ctx, moduleID, who); err != nil {
		return nil, err
	}
	current, err := a.store.ListBlocks(ctx, moduleID)
	if err != nil {
		return nil, err
	}
	known := make(map[uuid.UUID]bool, len(current))
	for _, b := range current {
		known[b.ID] = true
	}
	seen := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		if !known[id] || seen[id] {
			return nil, ErrInvalidOrder
		}
		seen[id] = true
	}
	if len(ids) != len(current) {
		return nil, ErrInvalidOrder
	}
	if err := a.store.ReorderBlocks(ctx, moduleID, ids, a.now()); err != nil {
		return nil, err
	}
	a.audit("reorder", who, moduleID, nil)
	return a.store.ListBlocks(ctx, moduleID)
}
