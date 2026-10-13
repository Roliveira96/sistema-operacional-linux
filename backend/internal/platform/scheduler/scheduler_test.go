package scheduler_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/scheduler"
)

type fakeLocker struct {
	busy  map[string]bool
	calls []string
}

func (f *fakeLocker) TryLock(ctx context.Context, name string) (func(), bool, error) {
	f.calls = append(f.calls, name)
	if f.busy[name] {
		return nil, false, nil
	}
	return func() {}, true, nil
}

// Covers SPEC-042 section 3.2 and CA-14 to CA-16: each due task runs once per period and only with its lock.
func TestScheduler_RunsDueTasksOnce(t *testing.T) {
	now := time.Date(2026, 10, 18, 18, 0, 0, 0, time.UTC)
	locker := &fakeLocker{busy: map[string]bool{}}
	s := scheduler.New(locker, func() time.Time { return now }, zap.NewNop())

	runs := map[string]int{}
	s.Add(scheduler.Task{Name: "outbox", Every: time.Minute, Run: func(ctx context.Context, at time.Time) error {
		runs["outbox"]++
		return nil
	}})
	s.Add(scheduler.Task{Name: "digest", Every: time.Hour, Run: func(ctx context.Context, at time.Time) error {
		runs["digest"]++
		return errors.New("boom")
	}})

	s.RunDue(context.Background())
	s.RunDue(context.Background())
	assert.Equal(t, map[string]int{"outbox": 1, "digest": 1}, runs, "a task does not run twice in its period, even after an error")

	now = now.Add(time.Minute)
	s.RunDue(context.Background())
	assert.Equal(t, map[string]int{"outbox": 2, "digest": 1}, runs)

	locker.busy["outbox"] = true
	now = now.Add(time.Minute)
	s.RunDue(context.Background())
	assert.Equal(t, 2, runs["outbox"], "another instance holds the lock")

	locker.busy["outbox"] = false
	s.RunDue(context.Background())
	assert.Equal(t, 3, runs["outbox"], "a skipped task runs on the next pass")
}

func TestScheduler_StartStopsWithContext(t *testing.T) {
	s := scheduler.New(&fakeLocker{busy: map[string]bool{}}, time.Now, zap.NewNop())
	ran := make(chan struct{}, 1)
	s.Add(scheduler.Task{Name: "t", Every: time.Hour, Run: func(ctx context.Context, at time.Time) error {
		select {
		case ran <- struct{}{}:
		default:
		}
		return nil
	}})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.Start(ctx, 10*time.Millisecond)
		close(done)
	}()
	select {
	case <-ran:
	case <-time.After(time.Second):
		t.Fatal("the task did not run")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Start did not return after cancel")
	}
}
