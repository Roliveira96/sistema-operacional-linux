package repository_test

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/seed/data"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	userservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

const adminEmail = "admin@rmo.dev.br"

func counts(t *testing.T, db *database.DB) map[string]int64 {
	t.Helper()
	out := map[string]int64{}
	for _, table := range []string{"course_modules", "content_blocks", "scenarios", "questions", "assessment_templates",
		"assessment_template_questions", "module_exercise_items"} {
		var n int64
		require.NoError(t, db.Conn(context.Background()).Table(table).Count(&n).Error)
		out[table] = n
	}
	return out
}

func newSeeder(db *database.DB) *service.Seeder {
	return service.NewSeeder(cmservice.NewSeeder(cmrepository.New(db)), userservice.New(userrepository.New(db)),
		repository.New(db), db, zap.NewNop())
}

// Covers SPEC-011 CA-01, CA-05 to CA-11 against PostgreSQL with the real manifest.
func TestSeedWithRealManifest(t *testing.T) {
	db := dbtest.Open(t) // CA-01: every migration, including 00006, applies cleanly
	ctx := context.Background()
	manifest, err := service.ReadManifest(bytes.NewReader(data.Manifest))
	require.NoError(t, err)
	seeder := newSeeder(db)

	// CA-09: no admin yet.
	_, err = seeder.Run(ctx, manifest, adminEmail)
	require.ErrorIs(t, err, service.ErrAdminMissing)
	assert.Zero(t, counts(t, db)["course_modules"], "CA-08: nothing is written on failure")

	admin := userdomain.User{Email: adminEmail, Role: userdomain.RoleAdmin, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &admin))

	// CA-05: first load inserts everything.
	report, err := seeder.Run(ctx, manifest, adminEmail)
	require.NoError(t, err)
	assert.Equal(t, len(manifest.Modules), report.Modules.Inserted)
	assert.Equal(t, len(manifest.Questions), report.Questions.Inserted)
	assert.Equal(t, len(manifest.Scenarios), report.Scenarios.Inserted)
	first := counts(t, db)
	assert.EqualValues(t, len(manifest.Questions), first["questions"])

	// CA-11: every EXERCISE question is in its module path.
	exercises := 0
	for _, q := range manifest.Questions {
		if q.Usage == "EXERCISE" {
			exercises++
		}
	}
	assert.EqualValues(t, exercises, first["module_exercise_items"])
	assert.Equal(t, exercises, report.ExercisesLinked)

	// CA-10: no unsafe HTML reached the database.
	var unsafe int64
	require.NoError(t, db.Conn(ctx).Table("content_blocks").
		Where("payload::text ~* ?", `<script|\son[a-z]+=|javascript:`).Count(&unsafe).Error)
	assert.Zero(t, unsafe)

	// CA-07: a teacher edit survives a reload.
	require.NoError(t, db.Conn(ctx).Exec(
		"UPDATE questions SET title = 'Teacher title', edited_by_teacher_at = now() WHERE source_key = 'dir-1'").Error)

	// CA-06: a second load keeps every row count.
	report, err = seeder.Run(ctx, manifest, adminEmail)
	require.NoError(t, err)
	assert.Equal(t, first, counts(t, db))
	assert.Equal(t, 1, report.Questions.Preserved)
	assert.Zero(t, report.Questions.Inserted)
	assert.Zero(t, report.ExercisesLinked)
	var title string
	require.NoError(t, db.Conn(ctx).Table("questions").Select("title").Where("source_key = 'dir-1'").Scan(&title).Error)
	assert.Equal(t, "Teacher title", title)

	// CA-08: a failure in the middle rolls back the whole load.
	broken := manifest
	broken.Questions = append([]service.ManifestQuestion{}, manifest.Questions...)
	broken.Questions[len(broken.Questions)-1].ModuleSourceKey = "missing-module"
	require.NoError(t, db.Conn(ctx).Exec("UPDATE course_modules SET title = 'before' WHERE source_key = 'historia'").Error)
	_, err = seeder.Run(ctx, broken, adminEmail)
	require.Error(t, err)
	require.NoError(t, db.Conn(ctx).Table("course_modules").Select("title").Where("source_key = 'historia'").Scan(&title).Error)
	assert.Equal(t, "before", title, "the module update of the failed run was rolled back")
}
