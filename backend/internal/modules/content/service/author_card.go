package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// MaxCardBlocks is the most blocks a card may be saved with (SPEC-019 RN-13).
const MaxCardBlocks = 200

// ErrInvalidCard means the request does not describe a card of this module: unknown or
// non-adjacent blocks to replace, a kept block that does not exist, or a type that changed.
var ErrInvalidCard = errors.New("the card does not match the blocks of the module")

// CardBlock is one block of a card being saved. A block with an ID keeps its identity (and
// the reading progress on it); one without an ID is created.
type CardBlock struct {
	ID *uuid.UUID
	// UpdatedAt is the instant of the last change the editor knows, checked unless Force.
	UpdatedAt *time.Time
	Type      domain.BlockType
	Payload   json.RawMessage
}

// SaveCardInput replaces the blocks of one card with the ones given (SPEC-019 RN-13).
type SaveCardInput struct {
	// ReplaceIDs are the current blocks of the card, adjacent in the module. Empty for a new card.
	ReplaceIDs []uuid.UUID
	// AfterID puts a new card after this block; without it, at the end. Ignored when ReplaceIDs is set.
	AfterID *uuid.UUID
	Blocks  []CardBlock
	Force   bool
}

// ReplaceCardEntry is a validated block ready to be stored.
type ReplaceCardEntry struct {
	ID                *uuid.UUID
	ExpectedUpdatedAt *time.Time
	Type              domain.BlockType
	Payload           json.RawMessage
}

// ReplaceCardInput is what the store applies in one transaction.
type ReplaceCardInput struct {
	ModuleID   uuid.UUID
	ReplaceIDs []uuid.UUID
	AfterID    *uuid.UUID
	Entries    []ReplaceCardEntry
	Now        time.Time
}

// SaveCard validates and stores a whole card: the blocks that stay are updated in place, the
// new ones are created and the ones left out are removed, all together or not at all.
func (a *Author) SaveCard(ctx context.Context, who Actor, moduleID uuid.UUID, in SaveCardInput) ([]domain.ContentBlock, error) {
	if err := a.authorize(ctx, moduleID, who); err != nil {
		return nil, err
	}
	if len(in.Blocks) > MaxCardBlocks {
		return nil, &domain.PayloadError{Fields: []domain.FieldError{{Field: "blocks", Reason: fmt.Sprintf("must have at most %d blocks", MaxCardBlocks)}}}
	}

	entries := make([]ReplaceCardEntry, len(in.Blocks))
	var problems []domain.FieldError
	for i, b := range in.Blocks {
		clean, err := domain.NormalizePayload(b.Type, b.Payload, a.san)
		var pe *domain.PayloadError
		if errors.As(err, &pe) {
			for _, f := range pe.Fields {
				problems = append(problems, domain.FieldError{Field: fmt.Sprintf("blocks[%d].%s", i, f.Field), Reason: f.Reason})
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		e := ReplaceCardEntry{ID: b.ID, Type: b.Type, Payload: clean}
		if !in.Force {
			e.ExpectedUpdatedAt = b.UpdatedAt
		}
		entries[i] = e
	}
	if len(problems) > 0 {
		return nil, &domain.PayloadError{Fields: problems}
	}

	current, err := a.store.ListBlocks(ctx, moduleID)
	if err != nil {
		return nil, err
	}
	if err := checkCard(current, in, entries); err != nil {
		return nil, err
	}

	saved, err := a.store.ReplaceCard(ctx, ReplaceCardInput{ModuleID: moduleID, ReplaceIDs: in.ReplaceIDs, AfterID: in.AfterID, Entries: entries, Now: a.now()})
	if err != nil {
		return nil, err
	}
	a.audit("save-card", who, moduleID, nil)
	return saved, nil
}

// checkCard makes sure the request talks about blocks of this module and that the blocks
// to replace are adjacent, so a card is never a scatter of unrelated blocks.
func checkCard(current []domain.ContentBlock, in SaveCardInput, entries []ReplaceCardEntry) error {
	byID := make(map[uuid.UUID]domain.ContentBlock, len(current))
	for _, b := range current {
		byID[b.ID] = b
	}

	replacing := make(map[uuid.UUID]bool, len(in.ReplaceIDs))
	positions := make([]int, 0, len(in.ReplaceIDs))
	for _, id := range in.ReplaceIDs {
		b, ok := byID[id]
		if !ok || replacing[id] {
			return ErrInvalidCard
		}
		replacing[id] = true
		positions = append(positions, b.Position)
	}
	sort.Ints(positions)
	for i := 1; i < len(positions); i++ {
		if positions[i] != positions[i-1]+1 {
			return ErrInvalidCard
		}
	}
	if len(in.ReplaceIDs) == 0 && in.AfterID != nil {
		if _, ok := byID[*in.AfterID]; !ok {
			return ErrBlockNotFound
		}
	}

	kept := make(map[uuid.UUID]bool, len(entries))
	for _, e := range entries {
		if e.ID == nil {
			continue
		}
		old, ok := byID[*e.ID]
		if !ok || !replacing[*e.ID] || kept[*e.ID] || old.BlockType != e.Type {
			return ErrInvalidCard
		}
		kept[*e.ID] = true
	}
	return nil
}

// SetActiveMany inactivates or reactivates several blocks of a module at once, such as a card (RN-12).
func (a *Author) SetActiveMany(ctx context.Context, who Actor, moduleID uuid.UUID, ids []uuid.UUID, active bool) ([]domain.ContentBlock, error) {
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
	for _, id := range ids {
		if !known[id] {
			return nil, ErrInvalidCard
		}
	}
	if err := a.store.SetActiveMany(ctx, moduleID, ids, active, a.now()); err != nil {
		return nil, err
	}
	action := "inactivate-card"
	if active {
		action = "activate-card"
	}
	a.audit(action, who, moduleID, nil)
	return a.store.ListBlocks(ctx, moduleID)
}
