package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

type initialStore struct {
	err   error
	calls int
	note  string
}

func (s *initialStore) PublishVersion(_ context.Context, _, _ uuid.UUID, note string) (domain.ModuleVersion, error) {
	s.calls++
	s.note = note
	return domain.ModuleVersion{Number: 1}, s.err
}

func TestInitialVersions_CreateInitialVersion(t *testing.T) {
	t.Run("publishes the first version without the gate of the tests", func(t *testing.T) {
		store := &initialStore{}
		require.NoError(t, service.NewInitialVersions(store).CreateInitialVersion(context.Background(), uuid.New(), uuid.New()))
		assert.Equal(t, 1, store.calls)
		assert.Equal(t, "Initial version", store.note)
	})
	t.Run("a module that already has the version is left alone", func(t *testing.T) {
		store := &initialStore{err: service.ErrNoChanges}
		assert.NoError(t, service.NewInitialVersions(store).CreateInitialVersion(context.Background(), uuid.New(), uuid.New()))
	})
	t.Run("other errors are returned", func(t *testing.T) {
		store := &initialStore{err: assert.AnError}
		assert.Error(t, service.NewInitialVersions(store).CreateInitialVersion(context.Background(), uuid.New(), uuid.New()))
	})
}
