package repository_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

// Covers SPEC-021 RN-01 against PostgreSQL (migration 00012): the snapshot of a module.
func TestModuleSetupRoundTrip(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	repo := repository.New(db)

	teacher := userdomain.User{Email: "prof@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &teacher))
	module := cmdomain.CourseModule{TeacherID: teacher.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, teacher.ID))

	got, err := repo.ModuleSetup(ctx, module.ID)
	require.NoError(t, err)
	assert.Nil(t, got, "no snapshot yet")

	setup := json.RawMessage(`{"summary":"pronto","steps":[{"command":"mkdir /x","terminal":1}]}`)
	require.NoError(t, repo.SaveModuleSetup(ctx, module.ID, setup))
	got, err = repo.ModuleSetup(ctx, module.ID)
	require.NoError(t, err)
	assert.JSONEq(t, string(setup), string(got))

	// Saving the module again (any edit of its data) does not lose the snapshot.
	module.Title = "Novo título"
	require.NoError(t, db.Conn(ctx).Save(&module).Error)
	got, err = repo.ModuleSetup(ctx, module.ID)
	require.NoError(t, err)
	assert.JSONEq(t, string(setup), string(got))

	require.NoError(t, repo.SaveModuleSetup(ctx, module.ID, json.RawMessage(`{"steps":[]}`)))
	got, _ = repo.ModuleSetup(ctx, module.ID)
	assert.JSONEq(t, `{"steps":[]}`, string(got))
}
