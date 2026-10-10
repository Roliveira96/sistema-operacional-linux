package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func TestAccessTokenRepository(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	users := userrepository.New(db)
	owner := userdomain.User{Email: "t@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	other := userdomain.User{Email: "o@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(ctx, &owner))
	require.NoError(t, users.Create(ctx, &other))
	repo := repository.New(db)
	now := time.Now().UTC().Truncate(time.Microsecond)

	newToken := func(userID uuid.UUID, hash string, at time.Time) *domain.AccessToken {
		tok := &domain.AccessToken{UserID: userID, Name: "claude", TokenHash: hash, ExpiresAt: now.Add(30 * 24 * time.Hour)}
		tok.CreatedAt, tok.UpdatedAt = at, at
		return tok
	}
	a, b, c := newToken(owner.ID, "hash-a", now), newToken(owner.ID, "hash-b", now.Add(time.Second)), newToken(other.ID, "hash-c", now)
	for _, tok := range []*domain.AccessToken{a, b, c} {
		require.NoError(t, repo.CreateAccessToken(ctx, tok))
		assert.Equal(t, 7, int(tok.ID.Version()), "UUIDv7 generated on create")
	}

	t.Run("find by hash and id", func(t *testing.T) {
		found, err := repo.FindAccessTokenByHash(ctx, "hash-a")
		require.NoError(t, err)
		assert.Equal(t, a.ID, found.ID)
		assert.Equal(t, owner.ID, found.UserID)
		assert.True(t, found.ExpiresAt.Equal(a.ExpiresAt))
		assert.Nil(t, found.LastUsedAt)
		assert.Nil(t, found.RevokedAt)

		byID, err := repo.FindAccessTokenByID(ctx, a.ID)
		require.NoError(t, err)
		assert.Equal(t, "hash-a", byID.TokenHash)

		_, err = repo.FindAccessTokenByHash(ctx, "missing")
		assert.ErrorIs(t, err, repository.ErrNotFound)
		_, err = repo.FindAccessTokenByID(ctx, uuid.New())
		assert.ErrorIs(t, err, repository.ErrNotFound)
	})

	t.Run("hash is unique", func(t *testing.T) {
		assert.Error(t, repo.CreateAccessToken(ctx, newToken(owner.ID, "hash-a", now)))
	})

	t.Run("list is per user", func(t *testing.T) {
		list, err := repo.ListAccessTokensByUser(ctx, owner.ID)
		require.NoError(t, err)
		require.Len(t, list, 2)
		assert.Equal(t, b.ID, list[0].ID, "newest first")
		list, err = repo.ListAccessTokensByUser(ctx, other.ID)
		require.NoError(t, err)
		assert.Len(t, list, 1)
	})

	t.Run("touch and revoke", func(t *testing.T) {
		at := now.Add(time.Minute)
		require.NoError(t, repo.TouchAccessToken(ctx, a.ID, at))
		found, _ := repo.FindAccessTokenByID(ctx, a.ID)
		require.NotNil(t, found.LastUsedAt)
		assert.True(t, found.LastUsedAt.Equal(at))

		require.NoError(t, repo.RevokeAccessToken(ctx, a.ID, at))
		found, _ = repo.FindAccessTokenByID(ctx, a.ID)
		require.NotNil(t, found.RevokedAt)
		assert.True(t, found.RevokedAt.Equal(at))
		assert.Equal(t, domain.AccessTokenRevoked, found.Status(at))

		require.NoError(t, repo.RevokeAccessToken(ctx, a.ID, at.Add(time.Hour)))
		found, _ = repo.FindAccessTokenByID(ctx, a.ID)
		assert.True(t, found.RevokedAt.Equal(at), "the first revocation time is kept")
	})

	t.Run("only the hash is stored", func(t *testing.T) {
		var cols []string
		require.NoError(t, db.Conn(ctx).Raw(
			"SELECT column_name FROM information_schema.columns WHERE table_name = 'access_tokens' AND table_schema = current_schema()").
			Scan(&cols).Error)
		assert.Contains(t, cols, "token_hash")
		assert.NotContains(t, cols, "token")
		assert.NotContains(t, cols, "role")
	})
}
