package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

func (m *memStore) SetActiveMany(_ context.Context, _ uuid.UUID, ids []uuid.UUID, active bool, now time.Time) error {
	for _, id := range ids {
		if _, err := m.SetActive(context.Background(), id, active, now); err != nil {
			return err
		}
	}
	return nil
}

// ReplaceCard mirrors the repository: kept blocks keep their identity, the others go or come in,
// and the blocks after the card move by how much it grew or shrank.
func (m *memStore) ReplaceCard(_ context.Context, in ReplaceCardInput) ([]domain.ContentBlock, error) {
	oldByID := map[uuid.UUID]domain.ContentBlock{}
	start, end := len(m.blocks)+1, len(m.blocks)
	if len(in.ReplaceIDs) > 0 {
		start, end = 1<<30, 0
		for _, id := range in.ReplaceIDs {
			for _, b := range m.blocks {
				if b.ID != id {
					continue
				}
				oldByID[id] = b
				start, end = min(start, b.Position), max(end, b.Position)
			}
		}
	} else if in.AfterID != nil {
		for _, b := range m.blocks {
			if b.ID == *in.AfterID {
				start, end = b.Position+1, b.Position
			}
		}
	}

	delta := len(in.Entries) - len(oldByID)
	var next []domain.ContentBlock
	for _, b := range m.blocks {
		if _, replaced := oldByID[b.ID]; replaced {
			continue
		}
		if b.Position > end {
			b.Position += delta
		}
		next = append(next, b)
	}

	var out []domain.ContentBlock
	for i, e := range in.Entries {
		var b domain.ContentBlock
		if e.ID != nil {
			b = oldByID[*e.ID]
			if e.ExpectedUpdatedAt != nil && !b.UpdatedAt.Equal(*e.ExpectedUpdatedAt) {
				return nil, ErrBlockConflict
			}
			b.Payload, b.UpdatedAt = e.Payload, in.Now
		} else {
			b = domain.ContentBlock{ID: uuid.New(), ModuleID: in.ModuleID, BlockType: e.Type, Payload: e.Payload, CreatedAt: in.Now, UpdatedAt: in.Now}
		}
		b.Position = start + i
		b.EditedByTeacherAt = &in.Now
		next = append(next, b)
		out = append(out, b)
	}
	m.blocks = next
	return out, nil
}

func raw(s string) json.RawMessage { return json.RawMessage(s) }

func (f authorFixture) all(t *testing.T) []domain.ContentBlock {
	t.Helper()
	list, err := f.a.List(context.Background(), f.teach, f.module)
	require.NoError(t, err)
	return list
}

// Covers SPEC-019 RN-13: a card is saved as a whole.
func TestAuthor_SaveCard_CreatesAndReplaces(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	tail := f.add(t, "fim")

	created, err := f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{Blocks: []CardBlock{
		{Type: domain.BlockText, Payload: raw(`{"title":"Card","command":"ls","html":""}`)},
		{Type: domain.BlockCommand, Payload: raw(`{"steps":[{"command":"ls"}]}`)},
	}})
	require.NoError(t, err)
	require.Len(t, created, 2)
	assert.Equal(t, []int{2, 3}, []int{created[0].Position, created[1].Position})

	// Edit: keep the heading (new title), drop the command, add two boxes.
	head, cmd := created[0], created[1]
	saved, err := f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{
		ReplaceIDs: []uuid.UUID{head.ID, cmd.ID},
		Blocks: []CardBlock{
			{ID: &head.ID, UpdatedAt: &head.UpdatedAt, Type: domain.BlockText, Payload: raw(`{"title":"Card novo","html":""}`)},
			{Type: domain.BlockTip, Payload: raw(`{"variant":"DEFAULT","title":"LPIC","html":"<p>x</p>"}`)},
			{Type: domain.BlockCuriosity, Payload: raw(`{"title":"Na vida real","html":"<p>y</p>"}`)},
		},
	})
	require.NoError(t, err)
	require.Len(t, saved, 3)
	assert.Equal(t, head.ID, saved[0].ID, "the kept block keeps its identity (and the reading progress)")
	assert.Contains(t, string(saved[0].Payload), "Card novo")

	list := f.all(t)
	require.Len(t, list, 4)
	assert.Equal(t, tail.ID, list[0].ID)
	for i, b := range list {
		assert.Equal(t, i+1, b.Position, "positions stay sequential")
		assert.NotEqual(t, cmd.ID, b.ID, "the block left out is gone")
	}
}

func TestAuthor_SaveCard_PutsANewCardAfterABlock(t *testing.T) {
	f := newAuthorFixture()
	first := f.add(t, "um")
	second := f.add(t, "dois")
	after := first.ID
	saved, err := f.a.SaveCard(context.Background(), f.teach, f.module, SaveCardInput{
		AfterID: &after,
		Blocks:  []CardBlock{{Type: domain.BlockTip, Payload: raw(`{"variant":"DEFAULT","html":"<p>x</p>"}`)}},
	})
	require.NoError(t, err)
	list := f.all(t)
	assert.Equal(t, []uuid.UUID{first.ID, saved[0].ID, second.ID}, []uuid.UUID{list[0].ID, list[1].ID, list[2].ID})
}

func TestAuthor_SaveCard_RemovesACardWithNoBlocks(t *testing.T) {
	f := newAuthorFixture()
	a, b, c := f.add(t, "a"), f.add(t, "b"), f.add(t, "c")
	_, err := f.a.SaveCard(context.Background(), f.teach, f.module, SaveCardInput{ReplaceIDs: []uuid.UUID{a.ID, b.ID}})
	require.NoError(t, err)
	list := f.all(t)
	require.Len(t, list, 1)
	assert.Equal(t, c.ID, list[0].ID)
	assert.Equal(t, 1, list[0].Position)
}

func TestAuthor_SaveCard_Validation(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	a, b, c := f.add(t, "a"), f.add(t, "b"), f.add(t, "c")
	ok := raw(`{"html":"<p>x</p>"}`)

	_, err := f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{Blocks: []CardBlock{
		{Type: domain.BlockCommand, Payload: raw(`{"steps":[]}`)},
		{Type: domain.BlockTip, Payload: raw(`{"html":""}`)},
	}})
	var pe *domain.PayloadError
	require.True(t, errors.As(err, &pe))
	names := []string{}
	for _, field := range pe.Fields {
		names = append(names, field.Field)
	}
	assert.Contains(t, names, "blocks[0].steps")
	assert.Contains(t, names, "blocks[1].html")

	// Not adjacent, unknown, repeated, a kept block that is not being replaced, or a changed type.
	cases := map[string]SaveCardInput{
		"not adjacent": {ReplaceIDs: []uuid.UUID{a.ID, c.ID}, Blocks: []CardBlock{{Type: domain.BlockText, Payload: ok}}},
		"unknown":      {ReplaceIDs: []uuid.UUID{uuid.New()}},
		"repeated":     {ReplaceIDs: []uuid.UUID{a.ID, a.ID}},
		"kept outside": {ReplaceIDs: []uuid.UUID{a.ID}, Blocks: []CardBlock{{ID: &b.ID, Type: domain.BlockText, Payload: ok}}},
		"type changed": {ReplaceIDs: []uuid.UUID{a.ID}, Blocks: []CardBlock{{ID: &a.ID, Type: domain.BlockTip, Payload: ok}}},
	}
	for name, in := range cases {
		_, err := f.a.SaveCard(ctx, f.teach, f.module, in)
		assert.ErrorIs(t, err, ErrInvalidCard, name)
	}

	missing := uuid.New()
	_, err = f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{AfterID: &missing, Blocks: []CardBlock{{Type: domain.BlockText, Payload: ok}}})
	assert.ErrorIs(t, err, ErrBlockNotFound)

	_, err = f.a.SaveCard(ctx, Actor{UserID: uuid.New(), Role: "TEACHER"}, f.module, SaveCardInput{})
	assert.ErrorIs(t, err, ErrForbidden)

	_, err = f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{Blocks: make([]CardBlock, MaxCardBlocks+1)})
	assert.True(t, errors.As(err, &pe))
}

func TestAuthor_SaveCard_Conflict(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	a := f.add(t, "a")
	stale := a.UpdatedAt.Add(-time.Hour)
	in := SaveCardInput{ReplaceIDs: []uuid.UUID{a.ID}, Blocks: []CardBlock{{ID: &a.ID, UpdatedAt: &stale, Type: domain.BlockText, Payload: raw(`{"html":"<p>novo</p>"}`)}}}

	_, err := f.a.SaveCard(ctx, f.teach, f.module, in)
	assert.ErrorIs(t, err, ErrBlockConflict)

	in.Force = true
	_, err = f.a.SaveCard(ctx, f.teach, f.module, in)
	assert.NoError(t, err, "writing over it is a conscious choice")
}

// Covers SPEC-019 RN-12 for a whole card.
func TestAuthor_SetActiveMany(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	a, b := f.add(t, "a"), f.add(t, "b")
	list, err := f.a.SetActiveMany(ctx, f.teach, f.module, []uuid.UUID{a.ID, b.ID}, false)
	require.NoError(t, err)
	assert.False(t, list[0].Active())
	assert.False(t, list[1].Active())
	_, err = f.a.SetActiveMany(ctx, f.teach, f.module, []uuid.UUID{uuid.New()}, false)
	assert.ErrorIs(t, err, ErrInvalidCard)
}
