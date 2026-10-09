package ratelimit

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

// Covers SPEC-003 RN-09.
func TestAllowBlocksAfterLimitAndRecovers(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := NewWithClock(3, time.Minute, c.now)

	for i := range 3 {
		ok, _ := l.Allow("ip")
		assert.True(t, ok, "attempt %d", i)
	}
	ok, retry := l.Allow("ip")
	assert.False(t, ok)
	assert.Equal(t, time.Minute, retry)

	c.t = c.t.Add(30 * time.Second)
	_, retry = l.Check("ip")
	assert.Equal(t, 30*time.Second, retry)

	c.t = c.t.Add(31 * time.Second)
	ok, _ = l.Allow("ip")
	assert.True(t, ok, "window slid")

	ok, _ = l.Allow("other")
	assert.True(t, ok, "keys are independent")
}

func TestRecordCheckAndReset(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := NewWithClock(2, time.Minute, c.now)

	l.Record("id")
	ok, _ := l.Check("id")
	assert.True(t, ok)
	l.Record("id")
	ok, retry := l.Check("id")
	assert.False(t, ok)
	assert.GreaterOrEqual(t, retry, time.Second)

	l.Reset("id")
	ok, _ = l.Check("id")
	assert.True(t, ok)
}

func TestSweepRemovesStaleKeys(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := NewWithClock(1, time.Second, c.now)
	l.Record("stale")
	c.t = c.t.Add(time.Hour)
	for range sweepEvery {
		l.Check("fresh")
	}
	_, exists := l.events["stale"]
	assert.False(t, exists)
	assert.NotNil(t, New(1, time.Second))
}

func TestZeroLimitRefusesWithoutPanicking(t *testing.T) {
	l := New(0, time.Minute)
	ok, retry := l.Allow("k")
	assert.False(t, ok)
	assert.Equal(t, time.Minute, retry)
}
