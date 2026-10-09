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
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

// Covers SPEC-020 RN-01 against PostgreSQL: a recorded machine has no source key and reads back whole.
func TestRecordedEnvironmentRoundTrip(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	repo := repository.New(db)

	now := time.Now().UTC().Truncate(time.Microsecond)
	machine := `{"formato":"exame-so/maquina","versao":1,"hostname":"lab","contas":{"usuarios":[],"grupos":[]},"raiz":{"nome":"","tipo":"dir"}}`
	sc := domain.Scenario{ID: uuid.New(), Snapshot: json.RawMessage(machine), FormatVersion: domain.MachineVersion, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, repo.SaveScenario(ctx, &sc))
	// Two recorded machines do not collide (they have no source key).
	other := domain.Scenario{ID: uuid.New(), Snapshot: json.RawMessage(machine), FormatVersion: domain.MachineVersion, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, repo.SaveScenario(ctx, &other))

	got, err := repo.FindScenario(ctx, sc.ID)
	require.NoError(t, err)
	assert.Nil(t, got.SourceKey)
	assert.JSONEq(t, machine, string(got.Snapshot))
	assert.NoError(t, domain.ValidateSnapshot(got.Snapshot))

	_, err = repo.FindScenario(ctx, uuid.New())
	assert.ErrorIs(t, err, service.ErrNotFound)
}
