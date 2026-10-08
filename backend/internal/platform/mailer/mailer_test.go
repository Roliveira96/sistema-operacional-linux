package mailer

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

type fakeSender struct {
	mu        sync.Mutex
	failFirst int
	calls     int
	delivered []Message
	delay     time.Duration
}

func (f *fakeSender) Send(_ context.Context, msg Message) error {
	time.Sleep(f.delay)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.calls <= f.failFirst {
		return errors.New("smtp unavailable")
	}
	f.delivered = append(f.delivered, msg)
	return nil
}

func testOptions() DispatcherOptions {
	return DispatcherOptions{Workers: 2, QueueSize: 10, MaxAttempts: 3, BaseBackoff: time.Millisecond, SendTimeout: time.Second}
}

// Covers SPEC-004 CA-14.
func TestEnqueuedMessageIsDelivered(t *testing.T) {
	sender := &fakeSender{}
	d := NewDispatcher(sender, testOptions(), zap.NewNop())
	if err := d.Enqueue(Message{To: []string{"a@example.com"}, Subject: "hello"}); err != nil {
		t.Fatal(err)
	}
	if err := d.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(sender.delivered) != 1 {
		t.Fatalf("delivered %d messages", len(sender.delivered))
	}
}

func TestRetriesThenSucceeds(t *testing.T) {
	sender := &fakeSender{failFirst: 2}
	d := NewDispatcher(sender, testOptions(), zap.NewNop())
	_ = d.Enqueue(Message{To: []string{"a@example.com"}})
	_ = d.Shutdown(context.Background())
	if sender.calls != 3 || len(sender.delivered) != 1 {
		t.Errorf("calls=%d delivered=%d", sender.calls, len(sender.delivered))
	}
}

func TestFinalFailureIsLoggedAsError(t *testing.T) {
	core, logs := observer.New(zapcore.ErrorLevel)
	sender := &fakeSender{failFirst: 10}
	d := NewDispatcher(sender, testOptions(), zap.New(core))
	_ = d.Enqueue(Message{To: []string{"a@example.com"}})
	_ = d.Shutdown(context.Background())
	if sender.calls != 3 {
		t.Errorf("expected 3 attempts, got %d", sender.calls)
	}
	if logs.FilterMessage("mail delivery failed").Len() != 1 {
		t.Errorf("expected one error log, got %v", logs.All())
	}
}

func TestEnqueueAfterShutdownFails(t *testing.T) {
	d := NewDispatcher(&fakeSender{}, testOptions(), zap.NewNop())
	_ = d.Shutdown(context.Background())
	if err := d.Enqueue(Message{}); !errors.Is(err, ErrClosed) {
		t.Errorf("got %v", err)
	}
}

func TestEnqueueFailsWhenQueueIsFull(t *testing.T) {
	opts := testOptions()
	opts.Workers = 0
	opts.QueueSize = 1
	d := NewDispatcher(&fakeSender{}, opts, zap.NewNop())
	_ = d.Enqueue(Message{})
	if err := d.Enqueue(Message{}); !errors.Is(err, ErrQueueFull) {
		t.Errorf("got %v", err)
	}
}

func TestShutdownRespectsDeadline(t *testing.T) {
	d := NewDispatcher(&fakeSender{delay: 200 * time.Millisecond}, testOptions(), zap.NewNop())
	for range 5 {
		_ = d.Enqueue(Message{})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := d.Shutdown(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("got %v", err)
	}
	if time.Since(start) > 150*time.Millisecond {
		t.Error("shutdown did not respect the deadline")
	}
}
