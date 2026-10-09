package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

const machineJSON = `{"formato":"exame-so/maquina","versao":1,"hostname":"lab","contas":{"usuarios":[],"grupos":[]},"raiz":{"nome":"","tipo":"dir"}}`

func (m *memStore) SaveScenario(_ context.Context, s *domain.Scenario) error {
	if m.scenarios == nil {
		m.scenarios = map[uuid.UUID]domain.Scenario{}
	}
	m.scenarios[s.ID] = *s
	return nil
}

func (m *memStore) FindScenario(_ context.Context, id uuid.UUID) (domain.Scenario, error) {
	if s, ok := m.scenarios[id]; ok {
		return s, nil
	}
	return domain.Scenario{}, ErrNotFound
}

// Covers SPEC-020 RN-01, RN-05 and CA-05, CA-08.
func TestAuthor_Environment(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()

	id, err := f.a.CreateEnvironment(ctx, f.teach, f.module, json.RawMessage(machineJSON))
	require.NoError(t, err)
	got, err := f.a.Environment(ctx, id)
	require.NoError(t, err)
	assert.JSONEq(t, machineJSON, string(got))

	_, err = f.a.CreateEnvironment(ctx, f.teach, f.module, json.RawMessage(`{"formato":"outra"}`))
	assert.ErrorIs(t, err, ErrInvalidSnapshot)
	_, err = f.a.CreateEnvironment(ctx, f.teach, f.module, json.RawMessage(`not json`))
	assert.ErrorIs(t, err, ErrInvalidSnapshot)
	_, err = f.a.CreateEnvironment(ctx, f.teach, f.module, json.RawMessage(`"`+strings.Repeat("a", domain.MaxSnapshotBytes)+`"`))
	assert.ErrorIs(t, err, ErrSnapshotTooLarge)

	_, err = f.a.CreateEnvironment(ctx, Actor{UserID: uuid.New(), Role: "TEACHER"}, f.module, json.RawMessage(machineJSON))
	assert.ErrorIs(t, err, ErrForbidden)
	_, err = f.a.CreateEnvironment(ctx, f.admin, f.module, json.RawMessage(machineJSON))
	assert.NoError(t, err)

	_, err = f.a.Environment(ctx, uuid.New())
	assert.ErrorIs(t, err, ErrEnvironmentNotFound)
}

// Covers SPEC-020 RN-02 and CA-06: a card points only to an environment that exists.
func TestAuthor_SaveCardChecksTheEnvironment(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	env, err := f.a.CreateEnvironment(ctx, f.teach, f.module, json.RawMessage(machineJSON))
	require.NoError(t, err)

	header := func(id string) []CardBlock {
		return []CardBlock{{Type: domain.BlockText, Payload: raw(`{"title":"Card","html":"","environment":{"scenarioId":"` + id + `","summary":"pronto","commands":["mkdir /x"]}}`)}}
	}

	saved, err := f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{Blocks: header(env.String())})
	require.NoError(t, err)
	assert.Contains(t, string(saved[0].Payload), env.String())

	_, err = f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{Blocks: header(uuid.NewString())})
	var pe *domain.PayloadError
	require.ErrorAs(t, err, &pe)
	assert.Equal(t, "blocks[0].environment.scenarioId", pe.Fields[0].Field)

	_, err = f.a.SaveCard(ctx, f.teach, f.module, SaveCardInput{Blocks: header("not-a-uuid")})
	require.ErrorAs(t, err, &pe)
	assert.Equal(t, "environment.scenarioId", strings.TrimPrefix(pe.Fields[0].Field, "blocks[0]."))
}
