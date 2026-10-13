// Package scheduler runs periodic tasks inside the API process (SPEC-042): each task runs at most once per period and
// only while it holds a lock, so a second instance of the API does not run it again.
package scheduler

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Task is a job that runs every Every.
type Task struct {
	Name  string
	Every time.Duration
	Run   func(ctx context.Context, now time.Time) error
}

// Locker takes a named lock without waiting; unlock releases it.
type Locker interface {
	TryLock(ctx context.Context, name string) (unlock func(), ok bool, err error)
}

// Scheduler keeps the tasks and when each one last ran.
type Scheduler struct {
	locker  Locker
	now     func() time.Time
	log     *zap.Logger
	mu      sync.Mutex
	tasks   []Task
	lastRun map[string]time.Time
}

// New creates a scheduler.
func New(locker Locker, now func() time.Time, log *zap.Logger) *Scheduler {
	return &Scheduler{locker: locker, now: now, log: log, lastRun: map[string]time.Time{}}
}

// Add registers a task.
func (s *Scheduler) Add(task Task) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks = append(s.tasks, task)
}

// RunDue runs, one after the other, every task whose period has passed. A task that fails still counts as run for
// its period; a task whose lock is held elsewhere is tried again on the next pass.
func (s *Scheduler) RunDue(ctx context.Context) {
	s.mu.Lock()
	tasks := append([]Task(nil), s.tasks...)
	s.mu.Unlock()

	for _, task := range tasks {
		now := s.now()
		s.mu.Lock()
		last, ran := s.lastRun[task.Name]
		s.mu.Unlock()
		if ran && now.Sub(last) < task.Every {
			continue
		}
		unlock, ok, err := s.locker.TryLock(ctx, task.Name)
		if err != nil {
			s.log.Warn("scheduler lock failed", zap.String("task", task.Name), zap.Error(err))
			continue
		}
		if !ok {
			continue
		}
		if err := task.Run(ctx, now); err != nil {
			s.log.Error("scheduled task failed", zap.String("task", task.Name), zap.Error(err))
		}
		unlock()
		s.mu.Lock()
		s.lastRun[task.Name] = now
		s.mu.Unlock()
	}
}

// Start runs RunDue at once and then on every tick until ctx is done.
func (s *Scheduler) Start(ctx context.Context, tick time.Duration) {
	ticker := time.NewTicker(tick)
	defer ticker.Stop()
	s.RunDue(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.RunDue(ctx)
		}
	}
}
