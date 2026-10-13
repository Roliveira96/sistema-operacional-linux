package mailer_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
)

type fakeOutbox struct {
	items map[uuid.UUID]*mailer.OutboxMessage
}

func (f *fakeOutbox) Due(ctx context.Context, now time.Time, limit int) ([]mailer.OutboxMessage, error) {
	var out []mailer.OutboxMessage
	for _, m := range f.items {
		if m.Status == mailer.OutboxPending && !m.SendAfter.After(now) {
			out = append(out, *m)
		}
	}
	return out, nil
}

func (f *fakeOutbox) MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error {
	f.items[id].Status = mailer.OutboxSent
	f.items[id].SentAt = &at
	return nil
}

func (f *fakeOutbox) MarkRetry(ctx context.Context, id uuid.UUID, attempts int, next time.Time, lastErr string) error {
	f.items[id].Attempts = attempts
	f.items[id].SendAfter = next
	f.items[id].LastError = lastErr
	return nil
}

func (f *fakeOutbox) MarkFailed(ctx context.Context, id uuid.UUID, attempts int, lastErr string) error {
	f.items[id].Status = mailer.OutboxFailed
	f.items[id].Attempts = attempts
	f.items[id].LastError = lastErr
	return nil
}

type fakeSender struct {
	fail map[string]bool
	sent []string
}

func (f *fakeSender) Send(ctx context.Context, msg mailer.Message) error {
	if f.fail[msg.To[0]] {
		return errors.New("smtp down")
	}
	f.sent = append(f.sent, msg.To[0])
	return nil
}

// Covers SPEC-042 RN-09 and CA-16: a failing message is retried up to 3 more times and then marked FAILED,
// while the others are delivered.
func TestOutbox_RetriesThenFails(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	bad, good := uuid.New(), uuid.New()
	store := &fakeOutbox{items: map[uuid.UUID]*mailer.OutboxMessage{
		bad:  {ID: bad, To: "bad@x.br", Subject: "s", Status: mailer.OutboxPending, SendAfter: now},
		good: {ID: good, To: "good@x.br", Subject: "s", Status: mailer.OutboxPending, SendAfter: now},
	}}
	sender := &fakeSender{fail: map[string]bool{"bad@x.br": true}}
	opts := mailer.OutboxOptions{MaxRetries: 3, Backoff: time.Minute, Batch: 10}

	require.NoError(t, mailer.DeliverDue(context.Background(), store, sender, now, opts))
	assert.Equal(t, []string{"good@x.br"}, sender.sent)
	assert.Equal(t, mailer.OutboxSent, store.items[good].Status)
	assert.Equal(t, 1, store.items[bad].Attempts)
	assert.Equal(t, now.Add(time.Minute), store.items[bad].SendAfter)

	for i := 0; i < 3; i++ {
		now = store.items[bad].SendAfter
		require.NoError(t, mailer.DeliverDue(context.Background(), store, sender, now, opts))
	}
	assert.Equal(t, mailer.OutboxFailed, store.items[bad].Status)
	assert.Equal(t, 4, store.items[bad].Attempts)
	assert.Equal(t, "smtp down", store.items[bad].LastError)
	assert.Equal(t, []string{"good@x.br"}, sender.sent, "a sent message is not sent again")
}
