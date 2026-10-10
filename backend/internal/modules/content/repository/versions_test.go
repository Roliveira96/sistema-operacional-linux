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

// Covers SPEC-021 RN-05 to RN-07, RN-11 and CA-06 to CA-09 against PostgreSQL (migration 00013).
func TestModuleVersions(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	repo := repository.New(db)

	name := "Profa"
	teacher := userdomain.User{Email: "prof@example.com", Name: &name, Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &teacher))
	module := cmdomain.CourseModule{TeacherID: teacher.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, teacher.ID))

	// RN-11: a module is born with an empty version 1, already published.
	v1, err := repo.LatestVersion(ctx, module.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, v1.Number)
	var content domain.VersionContent
	require.NoError(t, json.Unmarshal(v1.Content, &content))
	assert.Empty(t, content.Blocks)
	list, changed, err := repo.ListVersions(ctx, module.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "Profa", list[0].CreatedBy)
	assert.False(t, changed, "an empty draft is the version 1")

	// Publishing with no changes is refused.
	_, err = repo.PublishVersion(ctx, module.ID, teacher.ID, "")
	assert.ErrorIs(t, err, service.ErrNoChanges)

	// Edit the draft: two blocks and a snapshot.
	now := time.Now().UTC().Truncate(time.Microsecond)
	block := func(pos int, html string) *domain.ContentBlock {
		return &domain.ContentBlock{ID: uuid.New(), ModuleID: module.ID, BlockType: domain.BlockText, Position: pos,
			Payload: json.RawMessage(`{"html":"` + html + `"}`), CreatedAt: now, UpdatedAt: now}
	}
	a, b := block(1, "a"), block(2, "b")
	require.NoError(t, repo.SaveBlock(ctx, a))
	require.NoError(t, repo.SaveBlock(ctx, b))
	require.NoError(t, repo.SaveModuleSetup(ctx, module.ID, json.RawMessage(`{"steps":[{"command":"mkdir /x"}]}`)))
	_, changed, err = repo.ListVersions(ctx, module.ID)
	require.NoError(t, err)
	assert.True(t, changed, "CA-07: there are unpublished changes")

	// CA-07: the students still read the version 1 while the draft is edited.
	still, err := repo.LatestVersion(ctx, module.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, still.Number)

	// Publish: version 2 holds the draft.
	v2, err := repo.PublishVersion(ctx, module.ID, teacher.ID, "primeira")
	require.NoError(t, err)
	assert.Equal(t, 2, v2.Number)
	latest, err := repo.LatestVersion(ctx, module.ID)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(latest.Content, &content))
	require.Len(t, content.Blocks, 2)
	assert.Equal(t, a.ID, content.Blocks[0].ID)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /x"}]}`, string(content.Setup))
	_, changed, _ = repo.ListVersions(ctx, module.ID)
	assert.False(t, changed)
	_, err = repo.PublishVersion(ctx, module.ID, teacher.ID, "")
	assert.ErrorIs(t, err, service.ErrNoChanges, "the same draft twice")

	// Edit again: change a, remove b, add c, change the snapshot, inactivate nothing.
	require.NoError(t, db.Conn(ctx).Exec("UPDATE content_blocks SET payload = '{\"html\":\"a2\"}'::jsonb WHERE id = ?", a.ID).Error)
	require.NoError(t, db.Conn(ctx).Delete(&domain.ContentBlock{}, "id = ?", b.ID).Error)
	c := block(2, "c")
	require.NoError(t, repo.SaveBlock(ctx, c))
	require.NoError(t, repo.SaveModuleSetup(ctx, module.ID, json.RawMessage(`{"steps":[]}`)))
	v3, err := repo.PublishVersion(ctx, module.ID, teacher.ID, "segunda")
	require.NoError(t, err)
	assert.Equal(t, 3, v3.Number)

	// Restore version 2 into the draft (CA-08): a keeps its id (and so its progress), b comes back with its
	// id, c goes away, the snapshot is the old one. Nothing is published.
	student := userdomain.User{Email: "aluno@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &student))
	_, err = repo.SaveBlockProgress(ctx, student.ID, a.ID, true)
	require.NoError(t, err)

	require.NoError(t, repo.RestoreVersion(ctx, module.ID, 2, now))
	blocks, err := repo.ListBlocks(ctx, module.ID)
	require.NoError(t, err)
	require.Len(t, blocks, 2)
	assert.Equal(t, []uuid.UUID{a.ID, b.ID}, []uuid.UUID{blocks[0].ID, blocks[1].ID})
	assert.JSONEq(t, `{"html":"a"}`, string(blocks[0].Payload))
	assert.NotNil(t, blocks[0].EditedByTeacherAt, "restored blocks belong to the authors")
	setup, err := repo.ModuleSetup(ctx, module.ID)
	require.NoError(t, err)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /x"}]}`, string(setup))
	progress, err := repo.ListModuleBlockProgress(ctx, student.ID, module.ID)
	require.NoError(t, err)
	require.Len(t, progress, 1, "the progress of the block that exists in both is kept")
	assert.Equal(t, a.ID, progress[0].BlockID)

	last, err := repo.LatestVersion(ctx, module.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, last.Number, "restoring does not publish")
	_, changed, _ = repo.ListVersions(ctx, module.ID)
	assert.True(t, changed, "the restored draft differs from the version 3")

	// A version that does not exist.
	err = repo.RestoreVersion(ctx, module.ID, 99, now)
	assert.ErrorIs(t, err, service.ErrNotFound)
	_, err = repo.FindVersion(ctx, module.ID, 99)
	assert.ErrorIs(t, err, service.ErrNotFound)

	// Restoring an inactive block keeps it inactive, and a snapshot of null clears the module's one.
	inactiveAt := now
	require.NoError(t, db.Conn(ctx).Exec("UPDATE content_blocks SET inactive_at = ? WHERE id = ?", inactiveAt, b.ID).Error)
	v4, err := repo.PublishVersion(ctx, module.ID, teacher.ID, "")
	require.NoError(t, err)
	require.NoError(t, db.Conn(ctx).Exec("UPDATE content_blocks SET inactive_at = NULL WHERE id = ?", b.ID).Error)
	require.NoError(t, repo.RestoreVersion(ctx, module.ID, v4.Number, now))
	blocks, _ = repo.ListBlocks(ctx, module.ID)
	assert.False(t, blocks[1].Active())
	require.NoError(t, repo.RestoreVersion(ctx, module.ID, 1, now))
	blocks, _ = repo.ListBlocks(ctx, module.ID)
	assert.Empty(t, blocks, "version 1 was empty")
	setup, _ = repo.ModuleSetup(ctx, module.ID)
	assert.Nil(t, setup)
}
