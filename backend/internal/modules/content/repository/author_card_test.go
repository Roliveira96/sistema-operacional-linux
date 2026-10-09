package repository_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

// Covers SPEC-019 RN-13 against PostgreSQL: a card is replaced in one transaction.
func TestReplaceCard(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	repo := repository.New(db)

	teacher := userdomain.User{Email: "prof@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	student := userdomain.User{Email: "aluno@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &teacher))
	require.NoError(t, userrepository.New(db).Create(ctx, &student))
	module := cmdomain.CourseModule{TeacherID: teacher.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, teacher.ID))

	now := time.Now().UTC().Truncate(time.Microsecond)
	entry := func(id *uuid.UUID, expected *time.Time, typ domain.BlockType, payload string) service.ReplaceCardEntry {
		return service.ReplaceCardEntry{ID: id, ExpectedUpdatedAt: expected, Type: typ, Payload: json.RawMessage(payload)}
	}
	replace := func(replace []uuid.UUID, after *uuid.UUID, at time.Time, entries ...service.ReplaceCardEntry) ([]domain.ContentBlock, error) {
		return repo.ReplaceCard(ctx, service.ReplaceCardInput{ModuleID: module.ID, ReplaceIDs: replace, AfterID: after, Entries: entries, Now: at})
	}

	// A first card at the end, then a second one that must stay after it.
	card1, err := replace(nil, nil, now,
		entry(nil, nil, domain.BlockText, `{"title":"Um","html":""}`),
		entry(nil, nil, domain.BlockCommand, `{"steps":[{"command":"ls"}]}`),
		entry(nil, nil, domain.BlockTip, `{"variant":"DEFAULT","html":"<p>a</p>"}`))
	require.NoError(t, err)
	assert.Equal(t, []int{1, 2, 3}, []int{card1[0].Position, card1[1].Position, card1[2].Position})
	card2, err := replace(nil, nil, now, entry(nil, nil, domain.BlockText, `{"title":"Dois","html":""}`))
	require.NoError(t, err)
	assert.Equal(t, 4, card2[0].Position)

	// A student has read the heading and the tip of the first card.
	for _, b := range []domain.ContentBlock{card1[0], card1[2]} {
		_, err := repo.SaveBlockProgress(ctx, student.ID, b.ID, true)
		require.NoError(t, err)
	}

	// Edit the first card: keep the heading (new text) and the command (same content), drop the
	// tip, add two boxes. The second card must move by +1.
	later := now.Add(time.Minute)
	head, cmd, tip := card1[0], card1[1], card1[2]
	saved, err := replace([]uuid.UUID{head.ID, cmd.ID, tip.ID}, nil, later,
		entry(&head.ID, &head.UpdatedAt, domain.BlockText, `{"title":"Um editado","html":""}`),
		entry(&cmd.ID, &cmd.UpdatedAt, domain.BlockCommand, `{ "steps": [ {"command": "ls"} ] }`),
		entry(nil, nil, domain.BlockCuriosity, `{"title":"Na vida real","html":"<p>b</p>"}`),
		entry(nil, nil, domain.BlockTip, `{"variant":"WARNING","html":"<p>c</p>"}`))
	require.NoError(t, err)
	require.Len(t, saved, 4)
	assert.Equal(t, head.ID, saved[0].ID, "the kept heading keeps its identity")
	assert.Equal(t, cmd.ID, saved[1].ID)
	assert.True(t, saved[1].UpdatedAt.Equal(cmd.UpdatedAt), "an unchanged block is not touched")
	assert.True(t, saved[0].UpdatedAt.Equal(later))

	blocks, err := repo.ListBlocks(ctx, module.ID)
	require.NoError(t, err)
	require.Len(t, blocks, 5)
	for i, b := range blocks {
		assert.Equal(t, i+1, b.Position, "positions stay sequential")
	}
	assert.Equal(t, card2[0].ID, blocks[4].ID, "the next card moved after the grown one")

	// Reading progress: kept block survives, the removed tip loses it.
	progress, err := repo.ListModuleBlockProgress(ctx, student.ID, module.ID)
	require.NoError(t, err)
	require.Len(t, progress, 1)
	assert.Equal(t, head.ID, progress[0].BlockID)

	// Conflict: the editor still holds the old instant.
	_, err = replace([]uuid.UUID{head.ID}, nil, later.Add(time.Minute),
		entry(&head.ID, &head.UpdatedAt, domain.BlockText, `{"title":"Outro","html":""}`))
	assert.ErrorIs(t, err, service.ErrBlockConflict)
	after, err := repo.FindBlock(ctx, head.ID)
	require.NoError(t, err)
	assert.Contains(t, string(after.Payload), "Um editado", "nothing was written")

	// A new card after the first block, and the removal of a whole card (replace with nothing).
	inserted, err := replace(nil, &head.ID, later.Add(2*time.Minute), entry(nil, nil, domain.BlockTip, `{"variant":"DEFAULT","html":"<p>z</p>"}`))
	require.NoError(t, err)
	assert.Equal(t, 2, inserted[0].Position)
	_, err = replace([]uuid.UUID{inserted[0].ID}, nil, later.Add(3*time.Minute))
	require.NoError(t, err)
	positions(t, repo, module.ID)

	// SetActiveMany marks the blocks of a card and leaves the others alone.
	require.NoError(t, repo.SetActiveMany(ctx, module.ID, []uuid.UUID{head.ID, cmd.ID}, false, later))
	blocks, err = repo.ListBlocks(ctx, module.ID)
	require.NoError(t, err)
	assert.False(t, blocks[0].Active())
	assert.False(t, blocks[1].Active())
	assert.True(t, blocks[2].Active())
	require.NoError(t, repo.SetActiveMany(ctx, module.ID, nil, true, later))
}
