package repository_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func TestUserRepository(t *testing.T) {
	repo := repository.New(dbtest.Open(t))
	ctx := context.Background()
	ra := "1234567"
	hash := "$argon2id$hash"
	u := domain.User{Email: "student@example.com", AcademicID: &ra, PasswordHash: &hash,
		Role: domain.RoleStudent, Status: domain.StatusActive}
	require.NoError(t, repo.Create(ctx, &u))
	assert.Equal(t, 7, int(u.ID.Version()))

	byEmail, err := repo.FindByEmail(ctx, "student@example.com")
	require.NoError(t, err)
	assert.Equal(t, u.ID, byEmail.ID)
	byRA, err := repo.FindByAcademicID(ctx, "1234567")
	require.NoError(t, err)
	assert.Equal(t, u.ID, byRA.ID)

	_, err = repo.FindByID(ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrNotFound)

	dupEmail := domain.User{Email: "student@example.com", Role: domain.RoleStudent, Status: domain.StatusActive}
	assert.ErrorIs(t, repo.Create(ctx, &dupEmail), domain.ErrEmailTaken)
	dupRA := domain.User{Email: "other@example.com", AcademicID: &ra, Role: domain.RoleStudent, Status: domain.StatusActive}
	assert.ErrorIs(t, repo.Create(ctx, &dupRA), domain.ErrAcademicIDTaken)

	require.NoError(t, repo.UpdatePassword(ctx, u.ID, "$argon2id$new", true))
	updated, err := repo.FindByID(ctx, u.ID)
	require.NoError(t, err)
	assert.Equal(t, "$argon2id$new", *updated.PasswordHash)
	assert.True(t, updated.MustChangePassword)
	assert.ErrorIs(t, repo.UpdatePassword(ctx, uuid.New(), "x", false), domain.ErrNotFound)

	upper := domain.User{Email: "UPPER@example.com", Role: domain.RoleStudent, Status: domain.StatusActive}
	assert.Error(t, repo.Create(ctx, &upper), "the database rejects non-normalized e-mails")
}
