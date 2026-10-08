// Package mailer sends e-mail asynchronously: callers enqueue messages and a
// pool of workers delivers them through a Sender, retrying failed attempts.
package mailer

import (
	"context"
	"errors"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Message is one e-mail to deliver.
type Message struct {
	To       []string
	Subject  string
	TextBody string
	HTMLBody string
}

// Sender delivers a single message synchronously.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// Errors returned by Enqueue.
var (
	ErrQueueFull = errors.New("mail queue is full")
	ErrClosed    = errors.New("mail dispatcher is closed")
)

// DispatcherOptions configures the dispatcher.
type DispatcherOptions struct {
	Workers     int
	QueueSize   int
	MaxAttempts int
	// BaseBackoff is the wait after the first failed attempt; it doubles on
	// each subsequent failure.
	BaseBackoff time.Duration
	SendTimeout time.Duration
}

// DefaultDispatcherOptions returns the values approved in SPEC-004.
func DefaultDispatcherOptions(workers int) DispatcherOptions {
	return DispatcherOptions{
		Workers:     workers,
		QueueSize:   256,
		MaxAttempts: 3,
		BaseBackoff: time.Second,
		SendTimeout: 30 * time.Second,
	}
}

// Dispatcher queues messages in memory and delivers them with a worker pool.
// Messages still queued when the process dies abruptly are lost.
type Dispatcher struct {
	sender Sender
	opts   DispatcherOptions
	log    *zap.Logger

	queue  chan Message
	wg     sync.WaitGroup
	mu     sync.RWMutex
	closed bool
	// stop aborts retries waits when shutdown runs out of time.
	stop     chan struct{}
	stopOnce sync.Once
}

// NewDispatcher starts the workers.
func NewDispatcher(sender Sender, opts DispatcherOptions, log *zap.Logger) *Dispatcher {
	d := &Dispatcher{
		sender: sender,
		opts:   opts,
		log:    log.Named("mailer"),
		queue:  make(chan Message, opts.QueueSize),
		stop:   make(chan struct{}),
	}
	for i := 0; i < opts.Workers; i++ {
		d.wg.Add(1)
		go d.work()
	}
	return d
}

// Enqueue schedules a message for delivery without blocking.
func (d *Dispatcher) Enqueue(msg Message) error {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if d.closed {
		return ErrClosed
	}
	select {
	case d.queue <- msg:
		return nil
	default:
		return ErrQueueFull
	}
}

// Shutdown stops accepting messages and waits for the queue to drain until
// ctx is done. Messages not delivered by then are reported as lost.
func (d *Dispatcher) Shutdown(ctx context.Context) error {
	d.mu.Lock()
	if !d.closed {
		d.closed = true
		close(d.queue)
	}
	d.mu.Unlock()

	done := make(chan struct{})
	go func() {
		d.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		d.stopOnce.Do(func() { close(d.stop) })
		lost := len(d.queue)
		d.log.Error("mail queue not drained before shutdown deadline", zap.Int("lost_messages", lost))
		return ctx.Err()
	}
}

func (d *Dispatcher) work() {
	defer d.wg.Done()
	for msg := range d.queue {
		select {
		case <-d.stop:
			return
		default:
		}
		d.deliver(msg)
	}
}

func (d *Dispatcher) deliver(msg Message) {
	backoff := d.opts.BaseBackoff
	for attempt := 1; attempt <= d.opts.MaxAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), d.opts.SendTimeout)
		err := d.sender.Send(ctx, msg)
		cancel()
		if err == nil {
			d.log.Info("mail sent", zap.Strings("to", msg.To), zap.String("subject", msg.Subject),
				zap.Int("attempt", attempt))
			return
		}
		if attempt == d.opts.MaxAttempts {
			d.log.Error("mail delivery failed", zap.Strings("to", msg.To), zap.String("subject", msg.Subject),
				zap.Int("attempts", attempt), zap.Error(err))
			return
		}
		d.log.Warn("mail delivery attempt failed, retrying", zap.Strings("to", msg.To),
			zap.Int("attempt", attempt), zap.Duration("retry_in", backoff), zap.Error(err))

		select {
		case <-time.After(backoff):
		case <-d.stop:
			return
		}
		backoff *= 2
	}
}
