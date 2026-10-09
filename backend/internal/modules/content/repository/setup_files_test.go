package repository_test

import (
	"context"
	"encoding/json"
	"strings"
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

// Covers SPEC-021 RN-12 against PostgreSQL: the files of a snapshot come back exactly as they went in, large ones included,
// and a published version keeps them.
func TestModuleSetupKeepsLargeFilesExactly(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	repo := repository.New(db)

	teacher := userdomain.User{Email: "prof@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &teacher))
	module := cmdomain.CourseModule{TeacherID: teacher.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, teacher.ID))

	// A log of about 2 MB, with the characters that tend to break: quotes, backslashes, markup, accents, blank lines.
	line := "2026-10-09T12:00:00 ERROR \"falha\" \\n <b>ação</b> ç\n\n"
	content := strings.Repeat(line, 2<<20/len(line))
	setup, err := json.Marshal(map[string]any{"steps": []any{}, "files": []any{map[string]any{"path": "/var/log/app.log", "content": content, "mode": "640"}}})
	require.NoError(t, err)

	require.NoError(t, repo.SaveModuleSetup(ctx, module.ID, setup))
	got, err := repo.ModuleSetup(ctx, module.ID)
	require.NoError(t, err)
	var back struct {
		Files []struct{ Path, Content, Mode string }
	}
	require.NoError(t, json.Unmarshal(got, &back))
	require.Len(t, back.Files, 1)
	assert.Equal(t, content, back.Files[0].Content, "the file is byte for byte what was saved")
	assert.Equal(t, "640", back.Files[0].Mode)

	// Publishing keeps the files, so the students get them.
	v, err := repo.PublishVersion(ctx, module.ID, teacher.ID, "com log")
	require.NoError(t, err)
	var published struct {
		Setup struct {
			Files []struct{ Content string }
		}
	}
	require.NoError(t, json.Unmarshal(v.Content, &published))
	require.Len(t, published.Setup.Files, 1)
	assert.Equal(t, content, published.Setup.Files[0].Content)
}
