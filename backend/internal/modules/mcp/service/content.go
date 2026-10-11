package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
)

// BlockInput is a block to write.
type BlockInput struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// BlocksResult is the draft after a change.
type BlocksResult struct {
	ModuleID uuid.UUID   `json:"moduleId"`
	Blocks   []BlockView `json:"blocks"`
}

// rewriteBlockField turns the path the service reports for a block of a card (blocks[2].steps[0].command)
// into the path of the tool input (blocks[2].payload.steps[0].command).
func rewriteBlockField(path string) string {
	end := strings.IndexByte(path, ']')
	if !strings.HasPrefix(path, "blocks[") || end < 0 || end+2 > len(path) {
		return path
	}
	head, rest := path[:end+2], path[end+2:]
	if rest == "type" || rest == "payload" {
		return path
	}
	return head + "payload." + rest
}

func cardBlocks(in []BlockInput) []contentservice.CardBlock {
	out := make([]contentservice.CardBlock, len(in))
	for i, b := range in {
		out[i] = contentservice.CardBlock{Type: contentdomain.BlockType(b.Type), Payload: b.Payload}
	}
	return out
}

// AppendContentBlocksInput appends blocks to the draft.
type AppendContentBlocksInput struct {
	ModuleID     string       `json:"moduleId"`
	AfterBlockID *string      `json:"afterBlockId,omitempty"`
	Blocks       []BlockInput `json:"blocks"`
}

// AppendContentBlocks adds blocks to the draft, all or none (append_content_blocks).
func (s *Service) AppendContentBlocks(ctx context.Context, c Caller, in AppendContentBlocksInput) (out BlocksResult, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolAppendContentBlocks, in.ModuleID)
	if terr != nil {
		return BlocksResult{}, terr
	}
	defer func() { done(terr) }()
	if len(in.Blocks) == 0 {
		return BlocksResult{}, invalid("blocks", "[]", "at least one block")
	}
	var after *uuid.UUID
	if in.AfterBlockID != nil {
		a, terr := parseID("afterBlockId", *in.AfterBlockID)
		if terr != nil {
			return BlocksResult{}, terr
		}
		after = &a
	}
	saved, err := s.authoring.SaveCard(ctx, c.actor(), id, contentservice.SaveCardInput{AfterID: after, Blocks: cardBlocks(in.Blocks)})
	if err != nil {
		return BlocksResult{}, fail(err, fieldContext{root: rootOf(in), rewrite: rewriteBlockField})
	}
	return BlocksResult{ModuleID: id, Blocks: blockViews(saved)}, nil
}

// ReplaceContentBlocksInput replaces the whole draft.
type ReplaceContentBlocksInput struct {
	ModuleID string       `json:"moduleId"`
	Blocks   []BlockInput `json:"blocks"`
}

// ReplaceContentBlocks replaces every block of the draft in one transaction (replace_content_blocks): the
// authoring service saves "the card" made of all the current blocks, so a failure leaves the draft as it was.
func (s *Service) ReplaceContentBlocks(ctx context.Context, c Caller, in ReplaceContentBlocksInput) (out BlocksResult, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolReplaceContentBlocks, in.ModuleID)
	if terr != nil {
		return BlocksResult{}, terr
	}
	defer func() { done(terr) }()
	if in.Blocks == nil {
		return BlocksResult{}, invalid("blocks", "", "a list of blocks")
	}
	current, err := s.authoring.List(ctx, c.actor(), id)
	if err != nil {
		return BlocksResult{}, fail(err, fieldContext{})
	}
	ids := make([]uuid.UUID, len(current))
	for i, b := range current {
		ids[i] = b.ID
	}
	saved, err := s.authoring.SaveCard(ctx, c.actor(), id, contentservice.SaveCardInput{ReplaceIDs: ids, Blocks: cardBlocks(in.Blocks)})
	if err != nil {
		return BlocksResult{}, fail(err, fieldContext{root: rootOf(in), rewrite: rewriteBlockField})
	}
	return BlocksResult{ModuleID: id, Blocks: blockViews(saved)}, nil
}

// Operations of update_content_block.
const (
	OpUpdate     = "UPDATE"
	OpActivate   = "ACTIVATE"
	OpDeactivate = "DEACTIVATE"
	OpDelete     = "DELETE"
)

// UpdateContentBlockInput changes one block of the draft.
type UpdateContentBlockInput struct {
	ModuleID          string          `json:"moduleId"`
	BlockID           string          `json:"blockId"`
	Operation         string          `json:"operation"`
	Payload           json.RawMessage `json:"payload,omitempty"`
	ExpectedUpdatedAt *string         `json:"expectedUpdatedAt,omitempty"`
}

// UpdateContentBlockResult is the block after the change; a deleted block has none.
type UpdateContentBlockResult struct {
	ModuleID uuid.UUID  `json:"moduleId"`
	Deleted  bool       `json:"deleted"`
	Block    *BlockView `json:"block"`
}

// UpdateContentBlock edits, activates, deactivates or deletes a block of the draft (update_content_block).
func (s *Service) UpdateContentBlock(ctx context.Context, c Caller, in UpdateContentBlockInput) (out UpdateContentBlockResult, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolUpdateContentBlock, in.ModuleID)
	if terr != nil {
		return UpdateContentBlockResult{}, terr
	}
	defer func() { done(terr) }()
	blockID, terr := parseID("blockId", in.BlockID)
	if terr != nil {
		return UpdateContentBlockResult{}, terr
	}
	if in.Operation != OpUpdate && in.Operation != OpActivate && in.Operation != OpDeactivate && in.Operation != OpDelete {
		return UpdateContentBlockResult{}, invalid("operation", in.Operation, "one of UPDATE, ACTIVATE, DEACTIVATE, DELETE")
	}
	// The block must belong to the module of the call; listing also authorizes the caller.
	blocks, err := s.authoring.List(ctx, c.actor(), id)
	if err != nil {
		return UpdateContentBlockResult{}, fail(err, fieldContext{})
	}
	found := false
	for _, b := range blocks {
		found = found || b.ID == blockID
	}
	if !found {
		return UpdateContentBlockResult{}, fail(contentservice.ErrBlockNotFound, fieldContext{})
	}

	res := UpdateContentBlockResult{ModuleID: id}
	var block contentdomain.ContentBlock
	switch in.Operation {
	case OpUpdate:
		if len(in.Payload) == 0 {
			return UpdateContentBlockResult{}, invalid("payload", "", "the new payload of the block")
		}
		var expected time.Time
		force := in.ExpectedUpdatedAt == nil
		if !force {
			if expected, terr = parseTime("expectedUpdatedAt", *in.ExpectedUpdatedAt); terr != nil {
				return UpdateContentBlockResult{}, terr
			}
		}
		block, err = s.authoring.Update(ctx, c.actor(), blockID, in.Payload, expected, force)
	case OpActivate, OpDeactivate:
		block, err = s.authoring.SetActive(ctx, c.actor(), blockID, in.Operation == OpActivate)
	case OpDelete:
		err = s.authoring.Delete(ctx, c.actor(), blockID)
		res.Deleted = true
	}
	if err != nil {
		return UpdateContentBlockResult{}, fail(err, fieldContext{root: rootOf(in), rewrite: func(p string) string {
			if p == "payload" {
				return p
			}
			return "payload." + p
		}})
	}
	if !res.Deleted {
		v := blockView(block)
		res.Block = &v
	}
	return res, nil
}

// SetModuleSetupInput sets the snapshot of the module.
type SetModuleSetupInput struct {
	ModuleID string          `json:"moduleId"`
	Setup    json.RawMessage `json:"setup"`
}

// SetModuleSetupResult is the stored snapshot.
type SetModuleSetupResult struct {
	ModuleID uuid.UUID       `json:"moduleId"`
	Setup    json.RawMessage `json:"setup"`
}

// SetModuleSetup stores the snapshot of the module (set_module_setup).
func (s *Service) SetModuleSetup(ctx context.Context, c Caller, in SetModuleSetupInput) (out SetModuleSetupResult, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolSetModuleSetup, in.ModuleID)
	if terr != nil {
		return SetModuleSetupResult{}, terr
	}
	defer func() { done(terr) }()
	if len(in.Setup) == 0 {
		return SetModuleSetupResult{}, invalid("setup", "", "a snapshot object")
	}
	clean, err := s.authoring.SetSetup(ctx, c.actor(), id, in.Setup)
	if err != nil {
		return SetModuleSetupResult{}, fail(err, fieldContext{root: rootOf(in)})
	}
	return SetModuleSetupResult{ModuleID: id, Setup: clean}, nil
}
