package mailer

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// PostgresOutbox keeps the outbox in the email_outbox table (SPEC-042, section 4).
type PostgresOutbox struct {
	db *database.DB
}

// NewOutboxStore creates the PostgreSQL outbox.
func NewOutboxStore(db *database.DB) *PostgresOutbox { return &PostgresOutbox{db: db} }

var _ OutboxStore = (*PostgresOutbox)(nil)

type outboxRecord struct {
	ID              uuid.UUID  `gorm:"column:id"`
	RecipientUserID *uuid.UUID `gorm:"column:recipient_user_id"`
	Recipient       string     `gorm:"column:recipient"`
	Kind            string     `gorm:"column:kind"`
	Subject         string     `gorm:"column:subject"`
	BodyText        string     `gorm:"column:body_text"`
	BodyHTML        string     `gorm:"column:body_html"`
	Status          string     `gorm:"column:status"`
	Attempts        int        `gorm:"column:attempts"`
	SendAfter       time.Time  `gorm:"column:send_after"`
	SentAt          *time.Time `gorm:"column:sent_at"`
	LastError       *string    `gorm:"column:last_error"`
}

// Due returns up to limit pending messages whose time has come, oldest first.
func (o *PostgresOutbox) Due(ctx context.Context, now time.Time, limit int) ([]OutboxMessage, error) {
	var rows []outboxRecord
	if err := o.db.Conn(ctx).Table("email_outbox").
		Where("status = ? AND send_after <= ?", OutboxPending, now).
		Order("send_after, id").Limit(limit).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]OutboxMessage, 0, len(rows))
	for _, r := range rows {
		msg := OutboxMessage{ID: r.ID, RecipientUserID: r.RecipientUserID, To: r.Recipient, Kind: r.Kind, Subject: r.Subject,
			TextBody: r.BodyText, HTMLBody: r.BodyHTML, Status: OutboxStatus(r.Status), Attempts: r.Attempts,
			SendAfter: r.SendAfter, SentAt: r.SentAt}
		if r.LastError != nil {
			msg.LastError = *r.LastError
		}
		out = append(out, msg)
	}
	return out, nil
}

func (o *PostgresOutbox) update(ctx context.Context, id uuid.UUID, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	return o.db.Conn(ctx).Table("email_outbox").Where("id = ?", id).Updates(fields).Error
}

// MarkSent records a delivered message.
func (o *PostgresOutbox) MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error {
	return o.update(ctx, id, map[string]any{"status": OutboxSent, "sent_at": at})
}

// MarkRetry records a failed attempt and when to try again.
func (o *PostgresOutbox) MarkRetry(ctx context.Context, id uuid.UUID, attempts int, next time.Time, lastErr string) error {
	return o.update(ctx, id, map[string]any{"attempts": attempts, "send_after": next, "last_error": lastErr})
}

// MarkFailed records a message that will not be tried again.
func (o *PostgresOutbox) MarkFailed(ctx context.Context, id uuid.UUID, attempts int, lastErr string) error {
	return o.update(ctx, id, map[string]any{"status": OutboxFailed, "attempts": attempts, "last_error": lastErr})
}
