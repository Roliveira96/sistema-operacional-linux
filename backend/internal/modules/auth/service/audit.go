package service

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
)

// AuditEntry is an audit event to record.
type AuditEntry struct {
	UserID     *uuid.UUID
	Event      domain.EventType
	Identifier string
	Request    domain.RequestInfo
	Metadata   map[string]any
}

// AuditStore persists audit entries.
type AuditStore interface {
	InsertAudit(ctx context.Context, a *domain.AuditLog) error
}

// AsyncAuditor records audit entries in the background so the response is
// not delayed (RN-13). Write failures are logged as errors, never ignored.
type AsyncAuditor struct {
	store AuditStore
	log   *zap.Logger
	now   func() time.Time

	queue  chan domain.AuditLog
	wg     sync.WaitGroup
	mu     sync.RWMutex
	closed bool
}

// NewAsyncAuditor starts the background writer.
func NewAsyncAuditor(store AuditStore, log *zap.Logger) *AsyncAuditor {
	a := &AsyncAuditor{store: store, log: log.Named("audit"), now: time.Now, queue: make(chan domain.AuditLog, 1024)}
	a.wg.Add(1)
	go a.run()
	return a
}

// Record queues an entry. If the queue is full or already shut down, the
// entry is written synchronously instead of being dropped.
func (a *AsyncAuditor) Record(ctx context.Context, e AuditEntry) {
	entry, err := toAuditLog(e, a.now())
	if err != nil {
		a.log.Error("could not build audit entry", zap.String("event", string(e.Event)), zap.Error(err))
		return
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.closed {
		a.write(context.WithoutCancel(ctx), entry)
		return
	}
	select {
	case a.queue <- entry:
	default:
		a.write(context.WithoutCancel(ctx), entry)
	}
}

// Shutdown stops accepting entries and waits until the queue is written or
// ctx is done.
func (a *AsyncAuditor) Shutdown(ctx context.Context) error {
	a.mu.Lock()
	if !a.closed {
		a.closed = true
		close(a.queue)
	}
	a.mu.Unlock()
	done := make(chan struct{})
	go func() {
		a.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		a.log.Error("audit queue not drained before shutdown deadline", zap.Int("pending", len(a.queue)))
		return ctx.Err()
	}
}

func (a *AsyncAuditor) run() {
	defer a.wg.Done()
	for entry := range a.queue {
		a.write(context.Background(), entry)
	}
}

func (a *AsyncAuditor) write(ctx context.Context, entry domain.AuditLog) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := a.store.InsertAudit(ctx, &entry); err != nil {
		a.log.Error("could not write audit entry", zap.String("event", string(entry.EventType)), zap.Error(err))
	}
}

func toAuditLog(e AuditEntry, at time.Time) (domain.AuditLog, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return domain.AuditLog{}, err
	}
	entry := domain.AuditLog{
		ID:         id,
		UserID:     e.UserID,
		EventType:  e.Event,
		IPAddress:  e.Request.IP,
		UserAgent:  e.Request.UserAgent,
		OccurredAt: at.UTC(),
	}
	if e.Identifier != "" {
		identifier := e.Identifier
		entry.AttemptedIdentifier = &identifier
	}
	if len(e.Metadata) > 0 {
		raw, err := json.Marshal(e.Metadata)
		if err != nil {
			return domain.AuditLog{}, err
		}
		entry.Metadata = raw
	}
	return entry, nil
}
