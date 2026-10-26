package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
)

func newInput(now time.Time) service.CreateClassInput {
	return service.CreateClassInput{Name: "Turma", CourseCode: "SO34E", Semester: "2026/2", StartDate: now, EndDate: now.Add(60 * 24 * time.Hour)}
}

// Covers SPEC-049 CA-01 and RN-01: who created the class and when.
func TestAuditOnCreate(t *testing.T) {
	svc, repo, now := setupTest()
	actor := uuid.New()
	class, err := svc.CreateClass(context.Background(), actor, newInput(now))
	require.NoError(t, err)
	assert.Equal(t, actor, class.CreatedBy)
	assert.Equal(t, actor, class.UpdatedBy)
	assert.Nil(t, class.ArchivedAt)
	assert.Nil(t, class.ArchivedBy)
	assert.Equal(t, now, repo.classes[class.ID].CreatedAt)
	assert.Equal(t, now, repo.classes[class.ID].UpdatedAt)
}

// Covers SPEC-049 CA-02 and RN-02: an update records who and when, and never changes the creation.
func TestAuditOnUpdate(t *testing.T) {
	svc, repo, now := setupTest()
	ctx := context.Background()
	actor := uuid.New()
	class, err := svc.CreateClass(ctx, actor, newInput(now))
	require.NoError(t, err)

	later := now.Add(48 * time.Hour)
	svcLater := service.New(repo).WithNow(func() time.Time { return later })
	name := "Turma renomeada"
	updated, err := svcLater.UpdateClass(ctx, actor, class.ID, service.UpdateClassInput{Name: &name})
	require.NoError(t, err)

	assert.Equal(t, actor, updated.UpdatedBy)
	assert.Equal(t, later, updated.UpdatedAt)
	assert.Equal(t, actor, updated.CreatedBy, "the creator never changes")
	assert.Equal(t, now, updated.CreatedAt, "the creation date never changes")
	assert.Nil(t, updated.ArchivedAt)
	assert.Equal(t, updated.UpdatedBy, repo.classes[class.ID].UpdatedBy, "it is saved")
}

// Covers SPEC-049 CA-03 and RN-03: archiving records when and who, and renews the update.
func TestAuditOnArchive(t *testing.T) {
	svc, repo, now := setupTest()
	ctx := context.Background()
	actor := uuid.New()
	class, err := svc.CreateClass(ctx, actor, newInput(now))
	require.NoError(t, err)

	later := now.Add(72 * time.Hour)
	svcLater := service.New(repo).WithNow(func() time.Time { return later })
	archived, err := svcLater.ArchiveClass(ctx, actor, class.ID, "Semestre encerrado")
	require.NoError(t, err)

	require.NotNil(t, archived.ArchivedAt)
	assert.Equal(t, later, *archived.ArchivedAt)
	require.NotNil(t, archived.ArchivedBy)
	assert.Equal(t, actor, *archived.ArchivedBy)
	assert.Equal(t, actor, archived.UpdatedBy)
	assert.Equal(t, later, archived.UpdatedAt)
	assert.Equal(t, domain.ClassStatusArchived, repo.classes[class.ID].Status)
	assert.NotNil(t, repo.classes[class.ID].ArchivedAt, "it is saved")
}

// Covers SPEC-049 RN-04 and SPEC-086 CA-02 (RN-02, D-03): the names of who acted, the e-mail of one who has no name (as the lookup of the
// repository gives it), skipping the users that do not exist. It asked FindUserName before, which gives nobody without a name.
func TestUserNames(t *testing.T) {
	svc, repo, _ := setupTest()
	ana, bruno, ghost := uuid.New(), uuid.New(), uuid.New()
	repo.userLabels[ana] = "Ana"
	repo.userLabels[bruno] = "bruno@utfpr.edu.br"

	names, err := svc.UserNames(context.Background(), []uuid.UUID{ana, bruno, ana, ghost})
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]string{ana: "Ana", bruno: "bruno@utfpr.edu.br"}, names)

	empty, err := svc.UserNames(context.Background(), nil)
	require.NoError(t, err)
	assert.Empty(t, empty)
}
