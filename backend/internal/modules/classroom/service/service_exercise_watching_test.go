package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-065 CA-07 and section 3.1 (live:exercise:watch): the service says whether the teacher watches a student, for the one who comes back
// to the room in the middle of the observation, who is told again that he is watched: it is the student of the round that runs, and nobody before
// it, after it ended, after the teacher stopped or after he switched to another.
func TestExerciseWatching(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	assert.False(t, x.svc.ExerciseWatching(x.room.ID, x.ana.UserID), "no round")

	x.startRound(t, x.easyIndex, nil)
	assert.False(t, x.svc.ExerciseWatching(x.room.ID, x.ana.UserID), "nobody is watched yet")

	_, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.ana.UserID)
	require.NoError(t, err)
	assert.True(t, x.svc.ExerciseWatching(x.room.ID, x.ana.UserID))
	assert.False(t, x.svc.ExerciseWatching(x.room.ID, x.bruno.UserID), "only the one that is watched")

	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.bruno.UserID)
	require.NoError(t, err)
	assert.False(t, x.svc.ExerciseWatching(x.room.ID, x.ana.UserID), "after the switch")
	assert.True(t, x.svc.ExerciseWatching(x.room.ID, x.bruno.UserID))

	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, nil)
	require.NoError(t, err)
	assert.False(t, x.svc.ExerciseWatching(x.room.ID, x.bruno.UserID), "after the teacher stopped")

	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.carla.UserID)
	require.NoError(t, err)
	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	assert.False(t, x.svc.ExerciseWatching(x.room.ID, x.carla.UserID), "after the round ended")
}
