package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
)

// Covers RN-15.
func TestArgon2HasherRoundTrip(t *testing.T) {
	var h Argon2Hasher
	encoded, err := h.Hash("correct horse battery")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(encoded, "$argon2id$v=19$m=19456,t=2,p=1$"))
	assert.True(t, h.Verify("correct horse battery", encoded))
	assert.False(t, h.Verify("wrong horse battery", encoded))

	again, err := h.Hash("correct horse battery")
	require.NoError(t, err)
	assert.NotEqual(t, encoded, again, "salts are random")
}

func TestArgon2HasherRejectsMalformedHashes(t *testing.T) {
	var h Argon2Hasher
	for _, bad := range []string{
		"", "plain", "$bcrypt$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=1$m=1,t=1,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=19$garbage$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=1,t=1,p=1$!!!$aGFzaA",
		"$argon2id$v=19$m=1,t=1,p=1$c2FsdA$!!!",
		"$argon2id$v=19$m=1,t=1,p=1$c2FsdA$",
	} {
		assert.False(t, h.Verify("x", bad), bad)
	}
}

func TestTokensAreRandomAndHashed(t *testing.T) {
	raw1, hash1, err := newToken()
	require.NoError(t, err)
	raw2, _, err := newToken()
	require.NoError(t, err)
	assert.NotEqual(t, raw1, raw2)
	assert.Len(t, raw1, 43, "32 bytes in unpadded base64url")
	assert.Equal(t, hash1, hashToken(raw1))
	assert.Len(t, hash1, 64)
}

type memoryAuditStore struct {
	mu   sync.Mutex
	logs []domain.AuditLog
	err  error
}

func (m *memoryAuditStore) InsertAudit(_ context.Context, a *domain.AuditLog) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.logs = append(m.logs, *a)
	return nil
}

// Covers SPEC-003 CA-14 and RN-13.
func TestAsyncAuditorWritesEntries(t *testing.T) {
	store := &memoryAuditStore{}
	a := NewAsyncAuditor(store, zap.NewNop())
	userID := uuid.New()
	a.Record(context.Background(), AuditEntry{
		UserID: &userID, Event: domain.EventLoginSucceeded, Identifier: "a1234567",
		Request: domain.RequestInfo{IP: "10.0.0.1", UserAgent: "ua"}, Metadata: map[string]any{"k": "v"},
	})
	require.NoError(t, a.Shutdown(context.Background()))

	require.Len(t, store.logs, 1)
	entry := store.logs[0]
	assert.Equal(t, domain.EventLoginSucceeded, entry.EventType)
	assert.Equal(t, "a1234567", *entry.AttemptedIdentifier)
	assert.Equal(t, "10.0.0.1", entry.IPAddress)
	assert.Equal(t, "ua", entry.UserAgent)
	assert.Equal(t, 7, int(entry.ID.Version()))
	var meta map[string]string
	require.NoError(t, json.Unmarshal(entry.Metadata, &meta))
	assert.Equal(t, "v", meta["k"])

	a.Record(context.Background(), AuditEntry{Event: domain.EventLogout})
	assert.Len(t, store.logs, 2, "after shutdown entries are written synchronously")
	assert.Nil(t, store.logs[1].AttemptedIdentifier)
}

func TestAsyncAuditorLogsFailures(t *testing.T) {
	core, logs := observer.New(zapcore.ErrorLevel)
	store := &memoryAuditStore{err: errors.New("insert failed")}
	a := NewAsyncAuditor(store, zap.New(core))
	a.Record(context.Background(), AuditEntry{Event: domain.EventLogout})
	a.Record(context.Background(), AuditEntry{Event: domain.EventLogout, Metadata: map[string]any{"bad": make(chan int)}})
	require.NoError(t, a.Shutdown(context.Background()))

	assert.Equal(t, 1, logs.FilterMessage("could not write audit entry").Len())
	assert.Equal(t, 1, logs.FilterMessage("could not build audit entry").Len())
}

func TestAsyncAuditorShutdownDeadline(t *testing.T) {
	store := &slowStore{delay: 200 * time.Millisecond}
	a := NewAsyncAuditor(store, zap.NewNop())
	a.Record(context.Background(), AuditEntry{Event: domain.EventLogout})
	a.Record(context.Background(), AuditEntry{Event: domain.EventLogout})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	assert.ErrorIs(t, a.Shutdown(ctx), context.DeadlineExceeded)
}

type slowStore struct{ delay time.Duration }

func (s *slowStore) InsertAudit(context.Context, *domain.AuditLog) error {
	time.Sleep(s.delay)
	return nil
}

func TestResetEmailIsPortugueseAndEscapesToken(t *testing.T) {
	msg := resetPasswordEmail("s@example.com", "http://host:3010", "a+b/c")
	assert.Contains(t, msg.Subject, "Redefinição de senha")
	assert.Contains(t, msg.TextBody, "http://host:3010/reset-password?token=a%2Bb%2Fc")
	assert.Contains(t, msg.HTMLBody, `href="http://host:3010/reset-password?token=a%2Bb%2Fc"`)
}
