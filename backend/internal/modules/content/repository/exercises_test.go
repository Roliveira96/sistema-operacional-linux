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
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

// Covers SPEC-022 against PostgreSQL (migration 00014): the group of exercises is a block of the card, and the published
// version keeps it.
func TestExercisesBlockIsStoredAndPublished(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	repo := repository.New(db)

	teacher := userdomain.User{Email: "prof@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &teacher))
	module := cmdomain.CourseModule{TeacherID: teacher.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, teacher.ID))

	now := time.Now().UTC().Truncate(time.Microsecond)
	payload := json.RawMessage(`{"items":[{"title":"Criar a pasta","difficulty":"EASY","conditions":[{"kind":"DIR_EXISTS","path":"/srv/x"}],"solution":{"steps":[{"command":"mkdir /srv/x"}]}}],"setup":{"steps":[{"command":"mkdir /srv"}]}}`)
	block := &domain.ContentBlock{ID: uuid.New(), ModuleID: module.ID, BlockType: domain.BlockExercises, Position: 1, Payload: payload, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, repo.SaveBlock(ctx, block), "the database accepts the new type of block")

	got, err := repo.ListBlocks(ctx, module.ID)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, domain.BlockExercises, got[0].BlockType)
	assert.JSONEq(t, string(payload), string(got[0].Payload))

	// CA-08: the version holds the exercises and the snapshot of the group.
	v, err := repo.PublishVersion(ctx, module.ID, teacher.ID, "com exercícios")
	require.NoError(t, err)
	var content domain.VersionContent
	require.NoError(t, json.Unmarshal(v.Content, &content))
	require.Len(t, content.Blocks, 1)
	assert.Equal(t, domain.BlockExercises, content.Blocks[0].Type)
	assert.JSONEq(t, string(payload), string(content.Blocks[0].Payload))

	// A type that is not in the catalog is still refused by the database.
	bad := &domain.ContentBlock{ID: uuid.New(), ModuleID: module.ID, BlockType: "OTHER", Position: 2, Payload: json.RawMessage(`{}`), CreatedAt: now, UpdatedAt: now}
	assert.Error(t, repo.SaveBlock(ctx, bad))
}
