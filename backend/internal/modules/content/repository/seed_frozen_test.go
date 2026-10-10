package repository_test

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/seed/data"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

// Covers SPEC-011 RN-04a against PostgreSQL with the real manifest: a module the authors edited
// is not given the blocks a newer manifest adds, which would collide with the order they made.
func TestSeedFreezesAnEditedModule(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	manifest, err := service.ReadManifest(bytes.NewReader(data.Manifest))
	require.NoError(t, err)
	admin := userdomain.User{Email: adminEmail, Role: userdomain.RoleAdmin, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &admin))
	seeder := newSeeder(db)
	_, err = seeder.Run(ctx, manifest, adminEmail)
	require.NoError(t, err)
	before := counts(t, db)

	// The authors edited one block of "pacotes"; a newer manifest brings one more block to it.
	require.NoError(t, db.Conn(ctx).Exec("UPDATE content_blocks SET edited_by_teacher_at = now() WHERE source_key = 'pacotes/demo'").Error)
	for i := range manifest.Modules {
		if manifest.Modules[i].SourceKey == "pacotes" {
			manifest.Modules[i].Blocks = append([]service.ManifestBlock{{
				SourceKey: "pacotes/concepts/0", Type: "TEXT", Payload: json.RawMessage(`{"title":"Novo","html":"<p>x</p>"}`),
			}}, manifest.Modules[i].Blocks...)
		}
	}

	report, err := seeder.Run(ctx, manifest, adminEmail)
	require.NoError(t, err, "the new block would have taken a position the authors already use")
	assert.Equal(t, before, counts(t, db), "nothing was added to the edited module")
	assert.Positive(t, report.Blocks.Preserved)

	// The other modules keep being loaded as before.
	var inserted int64
	require.NoError(t, db.Conn(ctx).Table("content_blocks").Where("source_key = ?", "pacotes/concepts/0").Count(&inserted).Error)
	assert.Zero(t, inserted)
}
