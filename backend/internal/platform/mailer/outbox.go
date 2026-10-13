package mailer

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// OutboxStatus is the state of a message in the outbox.
type OutboxStatus string

// States of an outbox message (SPEC-042, section 4).
const (
	OutboxPending OutboxStatus = "PENDING"
	OutboxSent    OutboxStatus = "SENT"
	OutboxFailed  OutboxStatus = "FAILED"
)

// OutboxMessage is an e-mail kept in the database until it is delivered (SPEC-042 RN-09).
type OutboxMessage struct {
	ID              uuid.UUID
	RecipientUserID *uuid.UUID
	To              string
	Kind            string
	Subject         string
	TextBody        string
	HTMLBody        string
	Status          OutboxStatus
	Attempts        int
	SendAfter       time.Time
	SentAt          *time.Time
	LastError       string
}

// OutboxStore reads due messages and records each delivery attempt.
type OutboxStore interface {
	Due(ctx context.Context, now time.Time, limit int) ([]OutboxMessage, error)
	MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error
	MarkRetry(ctx context.Context, id uuid.UUID, attempts int, next time.Time, lastErr string) error
	MarkFailed(ctx context.Context, id uuid.UUID, attempts int, lastErr string) error
}

// OutboxOptions configures the delivery of the outbox.
type OutboxOptions struct {
	// MaxRetries is how many times a failed message is tried again before it is marked FAILED.
	MaxRetries int
	// Backoff is the wait after the first failure; it doubles on each new failure.
	Backoff time.Duration
	// Batch is how many due messages are taken per pass.
	Batch int
}

// DefaultOutboxOptions returns the values of SPEC-042 RN-09.
func DefaultOutboxOptions() OutboxOptions {
	return OutboxOptions{MaxRetries: 3, Backoff: time.Minute, Batch: 50}
}

// DeliverDue sends the due messages through sender. A failure only affects its own message (SPEC-042 CA-16).
func DeliverDue(ctx context.Context, store OutboxStore, sender Sender, now time.Time, opts OutboxOptions) error {
	due, err := store.Due(ctx, now, opts.Batch)
	if err != nil {
		return err
	}
	for _, msg := range due {
		sendErr := sender.Send(ctx, Message{To: []string{msg.To}, Subject: msg.Subject, TextBody: msg.TextBody, HTMLBody: msg.HTMLBody})
		attempts := msg.Attempts + 1
		switch {
		case sendErr == nil:
			err = store.MarkSent(ctx, msg.ID, now)
		case attempts > opts.MaxRetries:
			err = store.MarkFailed(ctx, msg.ID, attempts, sendErr.Error())
		default:
			wait := opts.Backoff << (attempts - 1)
			err = store.MarkRetry(ctx, msg.ID, attempts, now.Add(wait), sendErr.Error())
		}
		if err != nil {
			return err
		}
	}
	return nil
}
