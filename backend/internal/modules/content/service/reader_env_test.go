package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// envStore gives each environment its own machine.
type envStore struct {
	*fakeReadStore
	machines map[uuid.UUID]string
}

func (s envStore) FindScenario(_ context.Context, id uuid.UUID) (domain.Scenario, error) {
	if m, ok := s.machines[id]; ok {
		return domain.Scenario{ID: id, Snapshot: json.RawMessage(m)}, nil
	}
	return domain.Scenario{}, ErrNotFound
}

func card(id uuid.UUID, position int, env *uuid.UUID, inactive bool) domain.ContentBlock {
	payload := `{"title":"Card","html":""}`
	if env != nil {
		payload = `{"title":"Card","html":"","environment":{"scenarioId":"` + env.String() + `"}}`
	}
	b := domain.ContentBlock{ID: id, BlockType: domain.BlockText, Position: position, Payload: json.RawMessage(payload)}
	if inactive {
		now := time.Now()
		b.InactiveAt = &now
	}
	return b
}

// Covers SPEC-020 RN-03, RN-04 and CA-03, CA-04.
func TestTopicScenario_UsesTheEffectiveEnvironment(t *testing.T) {
	ctx := context.Background()
	e1, e2, gone := uuid.New(), uuid.New(), uuid.New()
	key := "pacotes"
	store := envStore{
		fakeReadStore: &fakeReadStore{keys: map[string]domain.Scenario{TopicScenarioPrefix + key: {Snapshot: json.RawMessage(`{"cenario":"topico"}`)}}},
		machines:      map[uuid.UUID]string{e1: `{"cenario":"um"}`, e2: `{"cenario":"dois"}`},
	}
	read := func(blocks ...domain.ContentBlock) string {
		store.blocks = blocks
		got, err := NewReader(&fakeAccess{sourceKey: &key}, store).TopicScenario(ctx, uuid.New(), Viewer{})
		require.NoError(t, err)
		return string(got)
	}

	assert.JSONEq(t, `{"cenario":"topico"}`, read(card(uuid.New(), 1, nil, false)), "no environment: the topic scenario")
	assert.JSONEq(t, `{"cenario":"um"}`, read(card(uuid.New(), 1, &e1, false), card(uuid.New(), 2, nil, false)))
	assert.JSONEq(t, `{"cenario":"dois"}`, read(card(uuid.New(), 1, &e1, false), card(uuid.New(), 2, &e2, false)), "the last card with an environment wins")
	assert.JSONEq(t, `{"cenario":"um"}`, read(card(uuid.New(), 1, &e1, false), card(uuid.New(), 2, &e2, true)), "an inactive card does not count")
	assert.JSONEq(t, `{"cenario":"topico"}`, read(card(uuid.New(), 1, &gone, false)), "an environment that is gone falls back")

	// A module the authors made has no topic scenario: the environment is all it has.
	store.blocks = []domain.ContentBlock{card(uuid.New(), 1, &e2, false)}
	got, err := NewReader(&fakeAccess{}, store).TopicScenario(ctx, uuid.New(), Viewer{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"cenario":"dois"}`, string(got))
	store.blocks = nil
	got, err = NewReader(&fakeAccess{}, store).TopicScenario(ctx, uuid.New(), Viewer{})
	require.NoError(t, err)
	assert.Nil(t, got)
}
