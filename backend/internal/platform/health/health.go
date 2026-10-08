// Package health checks the application dependencies and exposes the
// GET /api/v1/health endpoint.
package health

import (
	"context"
	"sync"
	"time"
)

// Overall and component statuses.
const (
	StatusHealthy   = "HEALTHY"
	StatusDegraded  = "DEGRADED"
	StatusUnhealthy = "UNHEALTHY"
)

// DefaultTimeout bounds each dependency check.
const DefaultTimeout = 2 * time.Second

// Check verifies one dependency. Critical checks make the whole service
// unavailable when they fail; the others only degrade it.
type Check struct {
	Name     string
	Critical bool
	Ping     func(ctx context.Context) error
}

// ComponentResult is the outcome of one check.
type ComponentResult struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	LatencyMs int64  `json:"latencyMs"`
	// err is kept for logging only and is never serialized.
	err error
}

// Err returns the check failure, if any.
func (c ComponentResult) Err() error { return c.err }

// Report is the outcome of all checks.
type Report struct {
	Status     string
	Available  bool
	CheckedAt  time.Time
	Components []ComponentResult
}

// Checker runs every check in parallel, each bounded by a timeout.
type Checker struct {
	checks  []Check
	timeout time.Duration
	now     func() time.Time
}

// NewChecker builds a checker. A zero timeout uses DefaultTimeout.
func NewChecker(timeout time.Duration, checks ...Check) *Checker {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	return &Checker{checks: checks, timeout: timeout, now: time.Now}
}

// Run executes the checks. A failed critical check makes the report
// unavailable; a failed non-critical check makes it DEGRADED.
func (c *Checker) Run(ctx context.Context) Report {
	results := make([]ComponentResult, len(c.checks))
	var wg sync.WaitGroup
	for i, check := range c.checks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = c.runOne(ctx, check)
		}()
	}
	wg.Wait()

	report := Report{Status: StatusHealthy, Available: true, CheckedAt: c.now().UTC(), Components: results}
	for i, r := range results {
		if r.Status == StatusHealthy {
			continue
		}
		if c.checks[i].Critical {
			report.Available = false
			report.Status = StatusUnhealthy
		} else if report.Available {
			report.Status = StatusDegraded
		}
	}
	return report
}

func (c *Checker) runOne(ctx context.Context, check Check) ComponentResult {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	start := time.Now()
	err := check.Ping(ctx)
	result := ComponentResult{
		Name:      check.Name,
		Status:    StatusHealthy,
		LatencyMs: time.Since(start).Milliseconds(),
		err:       err,
	}
	if err != nil {
		result.Status = StatusUnhealthy
	}
	return result
}
