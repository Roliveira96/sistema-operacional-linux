package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// Covers SPEC-014 CA-04 (domain rule).
func TestRecordKeepsFirstApproval(t *testing.T) {
	var p Progress
	t0 := time.Date(2026, 10, 9, 10, 0, 0, 0, time.UTC)
	p.Record(false, t0)
	assert.Equal(t, 1, p.Attempts)
	assert.Nil(t, p.CompletedAt)

	p.Record(true, t0.Add(time.Minute))
	p.Record(false, t0.Add(2*time.Minute))
	p.Record(true, t0.Add(3*time.Minute))
	assert.Equal(t, 4, p.Attempts)
	assert.True(t, p.LastPassed)
	assert.Equal(t, t0.Add(time.Minute), *p.CompletedAt, "the first approval date is kept")
	assert.Equal(t, "exercise_progress", Progress{}.TableName())
}
