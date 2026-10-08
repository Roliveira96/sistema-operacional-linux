// Package ratelimit implements an in-memory sliding-window limiter keyed by
// arbitrary strings (IP addresses, normalized identifiers). It is checked
// before any database access or cryptographic work.
package ratelimit

import (
	"sync"
	"time"
)

// sweepEvery bounds memory: after this many operations, keys whose events
// all fell out of the window are removed.
const sweepEvery = 1024

// Limiter allows at most Limit events per key within Window.
type Limiter struct {
	limit  int
	window time.Duration
	now    func() time.Time

	mu     sync.Mutex
	events map[string][]time.Time
	ops    int
}

// New creates a limiter.
func New(limit int, window time.Duration) *Limiter {
	return NewWithClock(limit, window, time.Now)
}

// NewWithClock creates a limiter with an injectable clock, for tests.
func NewWithClock(limit int, window time.Duration, now func() time.Time) *Limiter {
	return &Limiter{limit: limit, window: window, now: now, events: map[string][]time.Time{}}
}

// Allow records an event for key when the limit is not reached. When it is,
// nothing is recorded and the time until the oldest event leaves the window
// is returned.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	ok, retry := l.check(key)
	if ok {
		l.events[key] = append(l.events[key], l.now())
	}
	return ok, retry
}

// Check reports whether key is below the limit without recording an event.
func (l *Limiter) Check(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.check(key)
}

// Record adds an event for key regardless of the limit. It is used to count
// failures after the fact.
func (l *Limiter) Record(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(key)
	l.events[key] = append(l.events[key], l.now())
}

// Reset forgets every event of key.
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.events, key)
}

func (l *Limiter) check(key string) (bool, time.Duration) {
	l.ops++
	if l.ops%sweepEvery == 0 {
		for k := range l.events {
			l.prune(k)
		}
	}
	l.prune(key)

	events := l.events[key]
	if len(events) < l.limit {
		return true, 0
	}
	retry := events[0].Add(l.window).Sub(l.now())
	if retry < time.Second {
		retry = time.Second
	}
	return false, retry
}

// prune drops events older than the window; the caller holds the lock.
func (l *Limiter) prune(key string) {
	events := l.events[key]
	cutoff := l.now().Add(-l.window)
	i := 0
	for i < len(events) && !events[i].After(cutoff) {
		i++
	}
	if i == len(events) {
		delete(l.events, key)
		return
	}
	l.events[key] = events[i:]
}
