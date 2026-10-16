package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- SPEC-071: the guided practice of the lesson ----

// Covers SPEC-071 section 3.1: a round is RUNNING, PAUSED, ENDED or CLOSED; a paused round has not ended, and a closed one has.
func TestExerciseRun_Status(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	assert.Equal(t, domain.ExerciseStatusRunning, run.Status())

	require.NoError(t, run.Pause(exerciseStart.Add(time.Minute)))
	assert.Equal(t, domain.ExerciseStatusPaused, run.Status())
	assert.True(t, run.Paused())
	assert.True(t, run.Running(), "a paused round has not ended")

	require.NoError(t, run.End(exerciseStart.Add(2*time.Minute), domain.EndedByTeacher))
	assert.Equal(t, domain.ExerciseStatusEnded, run.Status())
	assert.False(t, run.Paused(), "the end takes the pause away")

	require.NoError(t, run.Close(exerciseStart.Add(3*time.Minute)))
	assert.Equal(t, domain.ExerciseStatusClosed, run.Status())
	assert.True(t, run.Closed())
	require.NotNil(t, run.ClosedAt)
	assert.True(t, run.ClosedAt.Equal(exerciseStart.Add(3*time.Minute)))
}

// Covers SPEC-071 RN-01 and CA-01: the pause keeps when it began; the resume puts the time that was left after it and counts the pause.
func TestExerciseRun_PauseAndResume(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5) // ends at 19:05
	pausedAt := exerciseStart.Add(2 * time.Minute)
	require.NoError(t, run.Pause(pausedAt))
	require.NotNil(t, run.PausedAt)
	assert.True(t, run.PausedAt.Equal(pausedAt))
	assert.False(t, run.Expired(exerciseStart.Add(time.Hour)), "a paused round never expires")

	require.NoError(t, run.Resume(pausedAt.Add(90*time.Second)))
	assert.Nil(t, run.PausedAt)
	assert.Equal(t, 90, run.PausedSeconds)
	assert.True(t, run.EndsAt.Equal(exerciseStart.Add(5*time.Minute+90*time.Second)), "the 3 minutes that were left come after the resume")
	assert.Equal(t, 300, run.DurationSeconds, "the pause does not change the time the round was given")

	require.NoError(t, run.Pause(exerciseStart.Add(4*time.Minute)))
	require.NoError(t, run.End(exerciseStart.Add(4*time.Minute+30*time.Second), domain.EndedByTeacher))
	assert.Equal(t, 120, run.PausedSeconds, "a round that ends paused counts the pause up to the end")
}

// Covers SPEC-071 RN-01: only a running round pauses, and only a paused one resumes.
func TestExerciseRun_PauseRefusals(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	assert.ErrorIs(t, run.Resume(exerciseStart), domain.ErrExerciseNotPaused)
	require.NoError(t, run.Pause(exerciseStart))
	assert.ErrorIs(t, run.Pause(exerciseStart), domain.ErrExercisePaused)
	require.NoError(t, run.End(exerciseStart, domain.EndedByTeacher))
	assert.ErrorIs(t, run.Pause(exerciseStart), domain.ErrExerciseEnded)
	assert.ErrorIs(t, run.Resume(exerciseStart), domain.ErrExerciseNotPaused)
}

// Covers SPEC-071 RN-02 and CA-02: more minutes push the end of a running or paused round; from 1 to 30 at a time, up to 60 in all.
func TestExerciseRun_Extend(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	reopened, err := run.Extend(2, exerciseStart.Add(time.Minute))
	require.NoError(t, err)
	assert.False(t, reopened)
	assert.Equal(t, 420, run.DurationSeconds)
	assert.True(t, run.EndsAt.Equal(exerciseStart.Add(7*time.Minute)))

	require.NoError(t, run.Pause(exerciseStart.Add(2*time.Minute)))
	_, err = run.Extend(1, exerciseStart.Add(3*time.Minute))
	require.NoError(t, err)
	assert.Equal(t, domain.ExerciseStatusPaused, run.Status(), "more time does not resume")
	require.NoError(t, run.Resume(exerciseStart.Add(3*time.Minute)))
	assert.True(t, run.EndsAt.Equal(exerciseStart.Add(9*time.Minute)), "8 minutes, 1 of them paused")

	for _, n := range []int{0, -1, 31} {
		_, err := run.Extend(n, exerciseStart)
		assert.ErrorIs(t, err, domain.ErrInvalidExerciseExtension, "%d minutes", n)
	}
	long := runOf(domain.DifficultyEasy, 30)
	_, err = long.Extend(30, exerciseStart)
	require.NoError(t, err, "60 minutes in all")
	_, err = long.Extend(1, exerciseStart)
	assert.ErrorIs(t, err, domain.ErrExerciseTooLong, "61 minutes in all")
	assert.Equal(t, 3600, long.DurationSeconds, "a refused extension changes nothing")
}

// Covers SPEC-071 RN-02 and CA-03: more minutes for a round that ended reopen it, from now, with the result hidden; a closed round never reopens.
func TestExerciseRun_ExtendReopens(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	require.NoError(t, run.End(run.EndsAt, domain.EndedByTimer))
	require.NoError(t, run.ShowResult(true))

	now := exerciseStart.Add(6 * time.Minute)
	reopened, err := run.Extend(2, now)
	require.NoError(t, err)
	assert.True(t, reopened)
	assert.Equal(t, domain.ExerciseStatusRunning, run.Status())
	assert.Nil(t, run.EndedAt)
	assert.Nil(t, run.EndedBy)
	assert.False(t, run.ResultVisible, "the result is hidden again")
	assert.True(t, run.EndsAt.Equal(now.Add(2*time.Minute)))
	assert.Equal(t, 420, run.DurationSeconds)

	require.NoError(t, run.End(now, domain.EndedByTeacher))
	require.NoError(t, run.Close(now))
	_, err = run.Extend(2, now)
	assert.ErrorIs(t, err, domain.ErrExerciseClosed)
}

// Covers SPEC-071 RN-04: only a round that ended closes, once.
func TestExerciseRun_CloseRefusals(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	assert.ErrorIs(t, run.Close(exerciseStart), domain.ErrExerciseRunning)
	require.NoError(t, run.End(exerciseStart, domain.EndedByTeacher))
	require.NoError(t, run.Close(exerciseStart))
	assert.ErrorIs(t, run.Close(exerciseStart), domain.ErrExerciseClosed)
	assert.NoError(t, run.ShowResult(true), "the result is still shown after the class went back to the lesson")
}

// Covers SPEC-071 RN-01 and CA-01: a paused round takes no answer.
func TestExerciseRun_PausedTakesNoAnswer(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	require.NoError(t, run.Pause(exerciseStart))
	assert.ErrorIs(t, run.AcceptsAnswerAt(exerciseStart), domain.ErrExercisePaused)
	require.NoError(t, run.Resume(exerciseStart))
	assert.NoError(t, run.AcceptsAnswerAt(exerciseStart))
}

// Covers SPEC-071 RN-07 and CA-12: the time of the student does not count the pauses.
func TestExerciseRun_ElapsedWithoutThePauses(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	require.NoError(t, run.Pause(exerciseStart.Add(time.Minute)))
	require.NoError(t, run.Resume(exerciseStart.Add(3*time.Minute)))
	assert.Equal(t, 120, run.ElapsedAt(exerciseStart.Add(4*time.Minute)), "4 minutes, 2 of them paused")
	assert.Equal(t, 0, run.ElapsedAt(exerciseStart), "never negative")
}

// Covers SPEC-071 RN-07 and CA-08: a student whose terminal the teacher took over concludes with no points; the others as in SPEC-065.
func TestExerciseRun_PointsWithTakeover(t *testing.T) {
	run := runOf(domain.DifficultyHard, 5)
	assert.Equal(t, 45, run.PointsFor(exerciseStart, false))
	assert.Equal(t, 0, run.PointsFor(exerciseStart, true))
	assert.Equal(t, 30, run.PointsFor(run.EndsAt, false))
	assert.Equal(t, 0, run.PointsFor(run.EndsAt, true))
}

// Covers SPEC-071 RN-09: the commands of a student are from 0 to 10,000.
func TestValidExerciseCommands(t *testing.T) {
	for _, n := range []int{0, 1, 10000} {
		assert.True(t, domain.ValidExerciseCommands(n), "%d", n)
	}
	for _, n := range []int{-1, 10001} {
		assert.False(t, domain.ValidExerciseCommands(n), "%d", n)
	}
}

// Covers SPEC-071 section 3.3 (live:exercise:key) and CA-09: a key is a name of up to 20 characters with no control character; a paste is
// from 1 to 2,000 characters, valid text, with line breaks and tabs but no other control character.
func TestTakeoverKeyAndPaste(t *testing.T) {
	for _, key := range []string{"a", "A", "ç", "Enter", "Backspace", "ArrowUp", "Escape", "Tab", " ", strings.Repeat("k", 20)} {
		assert.NoError(t, domain.ValidateTakeoverKey(key), "%q", key)
	}
	for _, key := range []string{"", strings.Repeat("k", 21), "\n", "a\x00", "\x1b", string([]byte{0xff})} {
		assert.ErrorIs(t, domain.ValidateTakeoverKey(key), domain.ErrInvalidTakeoverKey, "%q", key)
	}
	for _, text := range []string{"ls -l", "echo a\necho b\n", "a\tb", strings.Repeat("é", 2000)} {
		assert.NoError(t, domain.ValidateTakeoverPaste(text), "%.20q", text)
	}
	for _, text := range []string{"", strings.Repeat("x", 2001), "a\x00b", "a\x1b[2Jb", string([]byte{0xff})} {
		assert.ErrorIs(t, domain.ValidateTakeoverPaste(text), domain.ErrInvalidTakeoverKey, "%.20q", text)
	}
}
