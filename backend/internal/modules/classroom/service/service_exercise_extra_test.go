package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// Covers SPEC-065 CA-03 (Fim da rodada): when somebody else ended the round a moment before (the timer of another call, or the teacher), what they did
// stays: the teacher who tries is told that it ended, the first reason is kept, and nobody is told twice.
func TestExercise_EndRaceKeepsTheFirstEnd(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, nil)

	// the round was ended in the repository by another path, and the memory of this service still has it running
	end := x.now.Add(10 * time.Second)
	require.NoError(t, x.repo.exercise.runs[0].End(end, domain.EndedByTimer))

	x.now = x.now.Add(20 * time.Second)
	_, err := x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	assert.ErrorIs(t, err, domain.ErrExerciseEnded, "it ended a moment before")
	assert.Equal(t, domain.EndedByTimer, *x.repo.exercise.runs[0].EndedBy, "the first reason stays")
	assert.Equal(t, end, *x.repo.exercise.runs[0].EndedAt)
	assert.Empty(t, x.events, "nobody is told by this call")

	got, err := x.svc.ExerciseOf(ctx, x.room.ID, false)
	require.NoError(t, err)
	assert.False(t, got.Run.Running(), "and the memory learned it")
	assert.Equal(t, domain.EndedByTimer, *got.Run.EndedBy)
}

// Covers SPEC-065 CA-03: the timer of a round that is no longer the one of the memory (another round started since) finds its own round in the
// repository and, it being ended, does nothing; one that cannot be found is told as a failure.
func TestExercise_TimerOfAnOlderRound(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, nil)
	_, err := x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	x.now = x.now.Add(time.Minute)
	second := x.startRound(t, x.hardIndex, nil)

	x.timers.timers[0].f() // the timer of the first round goes off late
	assert.True(t, x.repo.exercise.runs[1].Running(), "the second round is untouched")
	assert.Equal(t, second.Run.ID, x.repo.exercise.runs[1].ID)
	assert.Empty(t, x.events)
	assert.Empty(t, x.failures)

	// a timer for a round that the repository does not have
	x.repo.exercise.runs = x.repo.exercise.runs[1:] // the first round is gone
	x.timers.timers[0].f()
	require.Len(t, x.failures, 1)
	assert.ErrorIs(t, x.failures[0], domain.ErrNoExerciseRun)
}

// Covers SPEC-065 CA-03: with no timer put in, the service uses the one of the clock: it starts, and a round that ends cancels it with no harm.
func TestExercise_DefaultTimer(t *testing.T) {
	ctx := context.Background()
	w := setup(t)
	module := uuid.New()
	w.repo.modules[module] = true
	room, _, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "Aula", InitialModuleID: &module})
	require.NoError(t, err)
	block := uuid.New()
	fx := &fakeExercises{specs: map[exerciseKey]service.ExerciseSpec{{module, block, 0}: {Title: "Listar", Difficulty: domain.DifficultyEasy}}}
	w.svc.WithExercises(fx) // no WithExerciseTimer

	st, err := w.svc.StartExercise(ctx, w.teacher, room.ID, service.ExerciseStartInput{BlockID: block, Index: 0})
	require.NoError(t, err)
	assert.True(t, st.Run.Running())
	ended, err := w.svc.EndExercise(ctx, w.teacher, room.ID)
	require.NoError(t, err)
	assert.False(t, ended.Run.Running(), "ending it cancels the timer of the clock")
}
