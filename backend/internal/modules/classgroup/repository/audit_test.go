package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func newUser(t *testing.T, repo *userrepository.Repository, email string) userdomain.User {
	t.Helper()
	name := "Usuário " + email
	u := userdomain.User{Name: &name, Email: email, Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, repo.Create(context.Background(), &u))
	return u
}

// Covers SPEC-049 CA-01 to CA-04: who created, who updated and when it was archived survive the round trip to the database.
func TestClassRepositoryAudit(t *testing.T) {
	db := dbtest.Open(t)
	repo := repository.New(db)
	users := userrepository.New(db)
	ctx := context.Background()
	owner := newUser(t, users, "dona@utfpr.edu.br")
	admin := newUser(t, users, "admin@utfpr.edu.br")
	now := time.Now().Truncate(time.Microsecond)

	class := domain.ClassGroup{
		TeacherID: owner.ID, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: now, EndDate: now.Add(30 * 24 * time.Hour), Status: domain.ClassStatusActive,
		CreatedBy: admin.ID, UpdatedBy: admin.ID,
	}
	require.NoError(t, repo.CreateClass(ctx, &class, nil, now))

	found, err := repo.FindClassByID(ctx, class.ID)
	require.NoError(t, err)
	assert.Equal(t, admin.ID, found.CreatedBy)
	assert.Equal(t, admin.ID, found.UpdatedBy)
	assert.Nil(t, found.ArchivedAt)
	assert.Nil(t, found.ArchivedBy)

	archivedAt := now.Add(24 * time.Hour)
	found.Status = domain.ClassStatusArchived
	found.UpdatedBy = owner.ID
	found.ArchivedAt = &archivedAt
	found.ArchivedBy = &owner.ID
	require.NoError(t, repo.UpdateClass(ctx, &found))

	again, err := repo.FindClassByID(ctx, class.ID)
	require.NoError(t, err)
	assert.Equal(t, admin.ID, again.CreatedBy, "the creator stays")
	assert.Equal(t, owner.ID, again.UpdatedBy)
	require.NotNil(t, again.ArchivedAt)
	assert.WithinDuration(t, archivedAt, *again.ArchivedAt, time.Millisecond)
	require.NotNil(t, again.ArchivedBy)
	assert.Equal(t, owner.ID, *again.ArchivedBy)
}

// Covers SPEC-049 RN-01: a class saved without an author (as the other modules' tests do) gets the teacher as the author.
func TestClassRepositoryDefaultsTheAuthorToTheTeacher(t *testing.T) {
	db := dbtest.Open(t)
	repo := repository.New(db)
	owner := newUser(t, userrepository.New(db), "dona@utfpr.edu.br")
	now := time.Now().Truncate(time.Microsecond)
	class := domain.ClassGroup{TeacherID: owner.ID, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: now, EndDate: now.Add(time.Hour), Status: domain.ClassStatusActive}
	require.NoError(t, repo.CreateClass(context.Background(), &class, nil, now))
	assert.Equal(t, owner.ID, class.CreatedBy)
	assert.Equal(t, owner.ID, class.UpdatedBy)
	assert.NotEqual(t, uuid.Nil, class.CreatedBy)
}
