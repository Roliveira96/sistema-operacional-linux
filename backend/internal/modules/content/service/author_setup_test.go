package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

func (m *memStore) ModuleSetup(context.Context, uuid.UUID) (json.RawMessage, error) {
	return m.setup, nil
}

func (m *memStore) SaveModuleSetup(_ context.Context, _ uuid.UUID, setup json.RawMessage) error {
	m.setup = setup
	return nil
}

// Covers SPEC-021 RN-01 and CA-01, CA-11.
func TestAuthor_ModuleSetup(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()

	got, err := f.a.Setup(ctx, f.teach, f.module)
	require.NoError(t, err)
	assert.Nil(t, got, "a module has no snapshot until one is recorded")

	saved, err := f.a.SetSetup(ctx, f.teach, f.module, json.RawMessage(`{"summary":" pronto ","steps":[{"command":" mkdir /x "}]}`))
	require.NoError(t, err)
	assert.JSONEq(t, `{"summary":"pronto","steps":[{"command":"mkdir /x"}]}`, string(saved))
	got, _ = f.a.Setup(ctx, f.admin, f.module)
	assert.JSONEq(t, string(saved), string(got))

	_, err = f.a.SetSetup(ctx, f.teach, f.module, json.RawMessage(`{"steps":[{"command":""}]}`))
	var pe *domain.PayloadError
	require.ErrorAs(t, err, &pe)
	assert.JSONEq(t, string(saved), string(f.store.setup), "a refused snapshot changes nothing")

	other := Actor{UserID: uuid.New(), Role: "TEACHER"}
	_, err = f.a.SetSetup(ctx, other, f.module, json.RawMessage(`{"steps":[]}`))
	assert.ErrorIs(t, err, ErrForbidden)
	_, err = f.a.Setup(ctx, other, f.module)
	assert.ErrorIs(t, err, ErrForbidden)
	_, err = f.a.Setup(ctx, f.teach, uuid.Nil)
	assert.ErrorIs(t, err, ErrModuleNotFound)
}

// Covers SPEC-021 5: the study screen reads the snapshot of the module with the blocks.
func TestReader_ContentHasTheModuleSetup(t *testing.T) {
	store := &fakeReadStore{setup: json.RawMessage(`{"steps":[{"command":"mkdir /x"}]}`)}
	got, err := NewReader(&fakeAccess{}, store).Content(context.Background(), uuid.New(), Viewer{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /x"}]}`, string(got.Setup))
	assert.NotEmpty(t, got.Blocks)

	store.setup = nil
	got, err = NewReader(&fakeAccess{}, store).Content(context.Background(), uuid.New(), Viewer{})
	require.NoError(t, err)
	assert.Nil(t, got.Setup)
}
