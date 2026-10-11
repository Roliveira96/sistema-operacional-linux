package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func TestMCPOAuthRepository(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	owner := userdomain.User{Email: "t@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &owner))
	repo := repository.New(db)
	now := time.Now().UTC().Truncate(time.Microsecond)

	client := domain.OAuthClient{ClientName: "Claude Code", RedirectURIs: []string{"http://localhost:1/cb", "http://127.0.0.1:2/cb"}}
	require.NoError(t, repo.CreateOAuthClient(ctx, &client))
	assert.Equal(t, 7, int(client.ID.Version()))

	found, err := repo.FindOAuthClient(ctx, client.ID)
	require.NoError(t, err)
	assert.Equal(t, "Claude Code", found.ClientName)
	assert.Equal(t, client.RedirectURIs, found.RedirectURIs, "the list round-trips through jsonb")
	assert.True(t, found.AllowsRedirect("http://127.0.0.1:2/cb"))

	_, err = repo.FindOAuthClient(ctx, owner.ID)
	assert.ErrorIs(t, err, repository.ErrNotFound)

	token := domain.AccessToken{UserID: owner.ID, Name: "t", TokenHash: "token-hash", ExpiresAt: now.Add(time.Hour)}
	require.NoError(t, repo.CreateAccessToken(ctx, &token))

	code := domain.OAuthCode{
		ClientID: client.ID, UserID: owner.ID, CodeHash: "code-hash", RedirectURI: "http://localhost:1/cb",
		CodeChallenge: "challenge", ExpiresAt: now.Add(5 * time.Minute),
	}
	require.NoError(t, repo.CreateOAuthCode(ctx, &code))

	byHash, err := repo.FindOAuthCodeByHash(ctx, "code-hash")
	require.NoError(t, err)
	assert.Equal(t, code.ID, byHash.ID)
	assert.Nil(t, byHash.UsedAt)
	_, err = repo.FindOAuthCodeByHash(ctx, "other")
	assert.ErrorIs(t, err, repository.ErrNotFound)

	used, err := repo.MarkOAuthCodeUsed(ctx, code.ID, token.ID, now)
	require.NoError(t, err)
	assert.True(t, used)
	used, err = repo.MarkOAuthCodeUsed(ctx, code.ID, token.ID, now)
	require.NoError(t, err)
	assert.False(t, used, "a code is used once")

	after, err := repo.FindOAuthCodeByHash(ctx, "code-hash")
	require.NoError(t, err)
	require.NotNil(t, after.UsedAt)
	require.NotNil(t, after.AccessTokenID)
	assert.Equal(t, token.ID, *after.AccessTokenID)
}
