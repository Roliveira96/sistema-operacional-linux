package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestAccessTokenStatus(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	revoked := now.Add(-time.Hour)

	active := AccessToken{ExpiresAt: now.Add(time.Second)}
	assert.Equal(t, AccessTokenActive, active.Status(now))
	assert.True(t, active.Usable(now))

	expired := AccessToken{ExpiresAt: now}
	assert.Equal(t, AccessTokenExpired, expired.Status(now))
	assert.False(t, expired.Usable(now))

	both := AccessToken{ExpiresAt: now.Add(-time.Hour), RevokedAt: &revoked}
	assert.Equal(t, AccessTokenRevoked, both.Status(now), "revocation wins over expiry")
	assert.False(t, both.Usable(now))

	assert.Equal(t, "access_tokens", AccessToken{}.TableName())
}
