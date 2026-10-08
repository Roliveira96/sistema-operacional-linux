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

func session(userID uuid.UUID, hash string, now time.Time) *domain.Session {
	id, _ := uuid.NewV7()
	return &domain.Session{ID: id, UserID: userID, TokenHash: hash, IPAddress: "10.0.0.1", UserAgent: "ua",
		Status: domain.SessionActive, LastActivityAt: now, ExpiresAt: now.Add(domain.AbsoluteTimeout), CreatedAt: now}
}

func TestAuthRepository(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	user := userdomain.User{Email: "s@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &user))
	repo := repository.New(db)
	now := time.Now().UTC().Truncate(time.Microsecond)

	t.Run("sessions", func(t *testing.T) {
		a, b, c := session(user.ID, "hash-a", now), session(user.ID, "hash-b", now), session(user.ID, "hash-c", now)
		for _, s := range []*domain.Session{a, b, c} {
			require.NoError(t, repo.CreateSession(ctx, s))
		}
		found, err := repo.FindSessionByTokenHash(ctx, "hash-a")
		require.NoError(t, err)
		assert.Equal(t, a.ID, found.ID)
		_, err = repo.FindSessionByTokenHash(ctx, "missing")
		assert.ErrorIs(t, err, repository.ErrNotFound)

		later := now.Add(time.Minute)
		require.NoError(t, repo.TouchSession(ctx, a.ID, later))
		found, _ = repo.FindSessionByTokenHash(ctx, "hash-a")
		assert.True(t, found.LastActivityAt.Equal(later))

		n, err := repo.EndUserSessions(ctx, user.ID, a.ID, domain.SessionRevokedConcurrency, later)
		require.NoError(t, err)
		assert.EqualValues(t, 2, n)
		found, _ = repo.FindSessionByTokenHash(ctx, "hash-b")
		assert.Equal(t, domain.SessionRevokedConcurrency, found.Status)
		assert.NotNil(t, found.RevokedAt)

		require.NoError(t, repo.EndSession(ctx, a.ID, domain.SessionRevokedLogout, later))
		found, _ = repo.FindSessionByTokenHash(ctx, "hash-a")
		assert.Equal(t, domain.SessionRevokedLogout, found.Status)
		n, err = repo.EndUserSessions(ctx, user.ID, uuid.Nil, domain.SessionRevokedPasswordReset, later)
		require.NoError(t, err)
		assert.Zero(t, n, "ended sessions are not touched again")
	})

	t.Run("reset tokens are single use", func(t *testing.T) {
		id, _ := uuid.NewV7()
		tok := &domain.PasswordResetToken{ID: id, UserID: user.ID, TokenHash: "reset-hash",
			ExpiresAt: now.Add(time.Hour), CreatedAt: now}
		require.NoError(t, repo.CreateResetToken(ctx, tok))
		found, err := repo.FindResetTokenByHash(ctx, "reset-hash")
		require.NoError(t, err)
		assert.Nil(t, found.UsedAt)
		_, err = repo.FindResetTokenByHash(ctx, "missing")
		assert.ErrorIs(t, err, repository.ErrNotFound)

		require.NoError(t, repo.MarkResetTokenUsed(ctx, id, now))
		assert.ErrorIs(t, repo.MarkResetTokenUsed(ctx, id, now), repository.ErrNotFound)
	})

	t.Run("audit log is append-only", func(t *testing.T) {
		id, _ := uuid.NewV7()
		entry := &domain.AuditLog{ID: id, UserID: &user.ID, EventType: domain.EventLoginSucceeded,
			IPAddress: "10.0.0.1", UserAgent: "ua", Metadata: []byte(`{"k":"v"}`), OccurredAt: now}
		require.NoError(t, repo.InsertAudit(ctx, entry))

		err := db.Conn(ctx).Exec("UPDATE security_audit_logs SET ip_address = 'x' WHERE id = ?", id).Error
		assert.ErrorContains(t, err, "append-only")
		err = db.Conn(ctx).Exec("DELETE FROM security_audit_logs WHERE id = ?", id).Error
		assert.ErrorContains(t, err, "append-only")
	})
}
