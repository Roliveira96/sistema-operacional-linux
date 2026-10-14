package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
)

// archivedClass creates a class and archives it at `archived`, returning a service whose clock is `now`.
func archivedClass(t *testing.T, archived, now time.Time) (*service.Service, *fakeClassRepo, uuid.UUID, uuid.UUID) {
	t.Helper()
	repo := newFakeRepo()
	teacher := uuid.New()
	at := service.New(repo).WithNow(func() time.Time { return archived })
	class, err := at.CreateClass(context.Background(), teacher, newInput(archived))
	require.NoError(t, err)
	_, err = at.ArchiveClass(context.Background(), teacher, class.ID, "Semestre encerrado")
	require.NoError(t, err)
	return service.New(repo).WithNow(func() time.Time { return now }), repo, teacher, class.ID
}

// Covers SPEC-050 CA-01 and RN-01, RN-03: an archived class of more than 30 days is deleted, and who deleted is kept.
func TestDeleteClassArchivedLongAgo(t *testing.T) {
	archived := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	svc, repo, teacher, id := archivedClass(t, archived, archived.Add(45*24*time.Hour))
	require.NoError(t, svc.DeleteClass(context.Background(), teacher, id))
	assert.Equal(t, teacher, repo.deletedBy[id])
	_, err := repo.FindClassByID(context.Background(), id)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)

	// CA-03: once deleted, the class does not exist.
	assert.ErrorIs(t, svc.DeleteClass(context.Background(), teacher, id), domain.ErrClassNotFound)
}

// Covers SPEC-050 CA-02 and RN-01: the limits of the 30 days.
func TestDeleteClassRespectsThirtyDays(t *testing.T) {
	archived := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	svc, repo, teacher, id := archivedClass(t, archived, archived.Add(29*24*time.Hour))
	err := svc.DeleteClass(context.Background(), teacher, id)
	require.ErrorIs(t, err, domain.ErrClassNotDeletable)
	var nd *domain.NotDeletableError
	require.True(t, errors.As(err, &nd))
	require.NotNil(t, nd.After)
	assert.Equal(t, archived.Add(30*24*time.Hour), *nd.After, "RN-04: the date from which it can be deleted")
	assert.Empty(t, repo.deletedBy)

	svc, repo, teacher, id = archivedClass(t, archived, archived.Add(30*24*time.Hour))
	require.NoError(t, svc.DeleteClass(context.Background(), teacher, id), "exactly 30 days")
	assert.Contains(t, repo.deletedBy, id)
}

// Covers SPEC-050 CA-02: an active or draft class is not deleted, and there is no date to wait for.
func TestDeleteClassRefusesWhatIsNotArchived(t *testing.T) {
	svc, repo, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()
	active, err := svc.CreateClass(ctx, teacher, newInput(now))
	require.NoError(t, err)
	draftStatus := domain.ClassStatusDraft
	in := newInput(now)
	in.CourseCode = "SO99X"
	in.Status = &draftStatus
	draft, err := svc.CreateClass(ctx, teacher, in)
	require.NoError(t, err)

	for _, id := range []uuid.UUID{active.ID, draft.ID} {
		err := svc.DeleteClass(ctx, teacher, id)
		require.ErrorIs(t, err, domain.ErrClassNotDeletable)
		var nd *domain.NotDeletableError
		require.True(t, errors.As(err, &nd))
		assert.Nil(t, nd.After)
	}
	assert.Empty(t, repo.deletedBy)
}

// Covers SPEC-050 CA-02: an archived class without the date of the archiving (old data) is not deleted.
func TestDeleteClassWithoutTheArchiveDate(t *testing.T) {
	svc, repo, teacher, id := archivedClass(t, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC))
	c := repo.classes[id]
	c.ArchivedAt = nil
	repo.classes[id] = c
	assert.ErrorIs(t, svc.DeleteClass(context.Background(), teacher, id), domain.ErrClassNotDeletable)
}

// Covers SPEC-050 CA-03 and RN-02: only the owner deletes.
func TestDeleteClassIsForTheOwner(t *testing.T) {
	archived := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	svc, repo, _, id := archivedClass(t, archived, archived.Add(60*24*time.Hour))
	assert.ErrorIs(t, svc.DeleteClass(context.Background(), uuid.New(), id), domain.ErrForbidden)
	assert.ErrorIs(t, svc.DeleteClass(context.Background(), uuid.New(), uuid.New()), domain.ErrClassNotFound)
	assert.Empty(t, repo.deletedBy)
}
