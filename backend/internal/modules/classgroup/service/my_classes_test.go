package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

func TestListMyClasses(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	active := string(domain.EnrollmentActive)

	t.Run("teacher uses the teacher query with the limit", func(t *testing.T) {
		repo := newFakeRepo()
		repo.teacherMenu = repository.MyClassesResult{
			Items: []repository.MyClass{{ID: uuid.New(), Name: "SO", Relation: domain.RelationTeacher}},
			Total: 35,
		}
		res, err := service.New(repo).ListMyClasses(ctx, userID, authn.RoleTeacher)
		require.NoError(t, err)
		assert.Len(t, res.Items, 1)
		assert.Equal(t, int64(35), res.Total)
		assert.Equal(t, []string{"teacher:" + userID.String() + ":20"}, repo.menuCalls)
	})

	t.Run("student uses the student query", func(t *testing.T) {
		repo := newFakeRepo()
		repo.studentMenu = repository.MyClassesResult{
			Items: []repository.MyClass{{ID: uuid.New(), Relation: domain.RelationStudent, EnrollmentStatus: &active}},
			Total: 1,
		}
		res, err := service.New(repo).ListMyClasses(ctx, userID, authn.RoleStudent)
		require.NoError(t, err)
		require.Len(t, res.Items, 1)
		assert.Equal(t, "ACTIVE", *res.Items[0].EnrollmentStatus)
		assert.Equal(t, []string{"student:" + userID.String() + ":20"}, repo.menuCalls)
	})

	t.Run("admin gets an empty list without touching the repository", func(t *testing.T) {
		repo := newFakeRepo()
		res, err := service.New(repo).ListMyClasses(ctx, userID, authn.RoleAdmin)
		require.NoError(t, err)
		assert.NotNil(t, res.Items)
		assert.Empty(t, res.Items)
		assert.Zero(t, res.Total)
		assert.Empty(t, repo.menuCalls)
	})

	t.Run("nil items become an empty slice", func(t *testing.T) {
		repo := newFakeRepo()
		res, err := service.New(repo).ListMyClasses(ctx, userID, authn.RoleStudent)
		require.NoError(t, err)
		assert.NotNil(t, res.Items)
	})

	t.Run("repository errors propagate", func(t *testing.T) {
		repo := newFakeRepo()
		repo.menuErr = errors.New("db down")
		for _, role := range []string{authn.RoleTeacher, authn.RoleStudent} {
			_, err := service.New(repo).ListMyClasses(ctx, userID, role)
			assert.EqualError(t, err, "db down")
		}
	})
}
