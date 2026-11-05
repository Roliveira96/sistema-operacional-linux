package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-099 CA-01, CA-02 (D-01 to D-03, D-06): up to an hour before the time set, the teacher starts the exam and the period moves to begin
// now with the same length; the history keeps the old period and the new one. More than an hour before, it is refused; in the period, nothing moves.
func TestStart_EarlyWithinTheHourMovesThePeriod(t *testing.T) {
	f := newFixture(t)
	exam := f.createOnline(t) // 09:00 to 11:00

	f.now = at(21, 7, 59)
	_, err := f.svc.Start(ctx, f.teacher, f.class.ID, exam.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotOpenYet, "61 minutes before")

	f.now = at(21, 8, 10)
	got, err := f.svc.Start(ctx, f.teacher, f.class.ID, exam.ID)
	require.NoError(t, err)
	require.NotNil(t, got.StartedAt)
	assert.Equal(t, at(21, 8, 10), *got.StartedAt)
	assert.Equal(t, at(21, 8, 10), got.StartsAt, "the period begins now")
	assert.Equal(t, at(21, 10, 10), got.EndsAt, "with the same two hours")
	assert.Equal(t, domain.PhaseRunning, got.Phase)

	events := startedEvents(f, exam)
	require.Len(t, events, 1)
	e := events[0]
	require.NotNil(t, e.OldStartsAt)
	assert.Equal(t, at(21, 9, 0), *e.OldStartsAt)
	assert.Equal(t, at(21, 11, 0), *e.OldEndsAt)
	assert.Equal(t, at(21, 8, 10), *e.NewStartsAt)
	assert.Equal(t, at(21, 10, 10), *e.NewEndsAt)

	onTime := f.createOnline(t)
	f.now = at(21, 9, 5)
	started, err := f.svc.Start(ctx, f.teacher, f.class.ID, onTime.ID)
	require.NoError(t, err)
	assert.Equal(t, at(21, 9, 0), started.StartsAt, "in the period nothing moves")
	assert.Equal(t, at(21, 11, 0), started.EndsAt)
	assert.Nil(t, startedEvents(f, onTime)[0].OldStartsAt)
}

// Covers SPEC-099 CA-03 (D-04): an hour before the time set, the room takes the teacher and the students wait, and the student has the way in;
// earlier, the room refuses and the exam is not open yet.
func TestEarlyHour_TheRoomAndTheAccessOpen(t *testing.T) {
	f := newFixture(t)
	exam := f.createOnline(t)

	f.now = at(21, 7, 59)
	_, err := f.svc.EnterRoom(ctx, f.teacher, f.class.ID, exam.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotOpenYet)
	access, err := f.svc.AccessOf(ctx, f.ana.ID, exam.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotOpenYet, access)

	f.now = at(21, 8, 0)
	entry, err := f.svc.EnterRoom(ctx, f.teacher, f.class.ID, exam.ID)
	require.NoError(t, err)
	assert.True(t, entry.Controller)
	entry, err = f.svc.EnterRoom(ctx, f.as(f.ana), f.class.ID, exam.ID)
	require.NoError(t, err)
	assert.True(t, entry.Waiting, "the student waits for the start")
	access, err = f.svc.AccessOf(ctx, f.ana.ID, exam.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotStarted, access, "the way in to the waiting room shows up")
}
