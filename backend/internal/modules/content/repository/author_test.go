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

func positions(t *testing.T, repo *repository.Repository, moduleID uuid.UUID) []uuid.UUID {
	t.Helper()
	blocks, err := repo.ListBlocks(context.Background(), moduleID)
	require.NoError(t, err)
	ids := make([]uuid.UUID, len(blocks))
	for i, b := range blocks {
		assert.Equal(t, i+1, b.Position, "positions stay sequential from 1")
		ids[i] = b.ID
	}
	return ids
}

// Covers SPEC-019 CA-02, CA-04, CA-05, CA-09 and CA-10 against PostgreSQL.
func TestAuthoringRepository(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	repo := repository.New(db)

	teacher := userdomain.User{Email: "prof@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	student := userdomain.User{Email: "aluno@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &teacher))
	require.NoError(t, userrepository.New(db).Create(ctx, &student))
	module := cmdomain.CourseModule{TeacherID: teacher.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, teacher.ID))

	owner, err := repo.ModuleTeacher(ctx, module.ID)
	require.NoError(t, err)
	assert.Equal(t, teacher.ID, owner)
	_, err = repo.ModuleTeacher(ctx, uuid.New())
	assert.ErrorIs(t, err, service.ErrNotFound)

	now := time.Now().UTC().Truncate(time.Microsecond)
	newBlock := func(html string) *domain.ContentBlock {
		return &domain.ContentBlock{ID: uuid.New(), ModuleID: module.ID, BlockType: domain.BlockText,
			Payload: json.RawMessage(`{"html":"` + html + `"}`), EditedByTeacherAt: &now, CreatedAt: now, UpdatedAt: now}
	}

	// A loaded block (it has a source key) that has not been edited yet.
	key := "module/x/block/1"
	loaded := &domain.ContentBlock{ID: uuid.New(), ModuleID: module.ID, SourceKey: &key, BlockType: domain.BlockText,
		Position: 1, Payload: json.RawMessage(`{"html":"p"}`), CreatedAt: now, UpdatedAt: now}
	require.NoError(t, repo.SaveBlock(ctx, loaded))

	// CA-02: at the end, then right after the first one (shifting the next).
	a := newBlock("a")
	require.NoError(t, repo.InsertBlock(ctx, a, nil))
	assert.Equal(t, 2, a.Position)
	b := newBlock("b")
	require.NoError(t, repo.InsertBlock(ctx, b, &loaded.ID))
	assert.Equal(t, 2, b.Position)
	assert.Equal(t, []uuid.UUID{loaded.ID, b.ID, a.ID}, positions(t, repo, module.ID))

	// CA-10: a change of structure protects the loaded block from the initial load.
	got, err := repo.FindBlockBySourceKey(ctx, key)
	require.NoError(t, err)
	assert.NotNil(t, got.EditedByTeacherAt)

	// A block that is not in this module cannot be the anchor.
	other := uuid.New()
	assert.Error(t, repo.InsertBlock(ctx, newBlock("x"), &other))
	positions(t, repo, module.ID)

	// CA-09: the guard on updated_at.
	later := now.Add(time.Minute)
	updated, err := repo.UpdateBlock(ctx, a.ID, json.RawMessage(`{"html":"a2"}`), &now, later)
	require.NoError(t, err)
	assert.JSONEq(t, `{"html":"a2"}`, string(updated.Payload))
	assert.True(t, updated.UpdatedAt.Equal(later))
	_, err = repo.UpdateBlock(ctx, a.ID, json.RawMessage(`{"html":"a3"}`), &now, later.Add(time.Minute))
	assert.ErrorIs(t, err, service.ErrBlockConflict)
	_, err = repo.UpdateBlock(ctx, a.ID, json.RawMessage(`{"html":"a3"}`), nil, later.Add(time.Minute))
	assert.NoError(t, err, "without the guard the change goes through")
	_, err = repo.UpdateBlock(ctx, uuid.New(), json.RawMessage(`{}`), nil, later)
	assert.ErrorIs(t, err, service.ErrNotFound)

	// CA-05: one transaction with the new order.
	require.NoError(t, repo.ReorderBlocks(ctx, module.ID, []uuid.UUID{a.ID, loaded.ID, b.ID}, later))
	assert.Equal(t, []uuid.UUID{a.ID, loaded.ID, b.ID}, positions(t, repo, module.ID))

	// CA-04: removing a block drops the reading progress and closes the gap.
	_, err = repo.SaveBlockProgress(ctx, student.ID, loaded.ID, true)
	require.NoError(t, err)
	require.NoError(t, repo.DeleteBlock(ctx, domain.ContentBlock{ID: loaded.ID, ModuleID: module.ID, Position: 2}))
	assert.Equal(t, []uuid.UUID{a.ID, b.ID}, positions(t, repo, module.ID))
	progress, err := repo.ListModuleBlockProgress(ctx, student.ID, module.ID)
	require.NoError(t, err)
	assert.Empty(t, progress)
}
