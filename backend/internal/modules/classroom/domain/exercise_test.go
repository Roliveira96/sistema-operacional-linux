package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- SPEC-065: the exercise of the lesson ----

func ptr[T any](v T) *T { return &v }

var exerciseStart = time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)

func runOf(difficulty string, minutes int) domain.LiveExerciseRun {
	return domain.StartExerciseRun(uuid.New(), uuid.New(), 2, "Criar a pasta", difficulty, minutes, exerciseStart)
}

// Covers SPEC-065 CA-05 and section 3.1 (Pontos): the base of the level (10, 20 and 30) plus a bonus of up to 50% of the base, proportional to
// the time that was left, rounded down: the first instant gives 1.5 times the base, the last gives the base, and after the end it gives the
// base. An unknown level gives nothing; a clock that went back is capped at the first instant.
func TestExercisePoints_Table(t *testing.T) {
	five := 5 * time.Minute
	for _, tc := range []struct {
		name       string
		difficulty string
		duration   time.Duration
		remaining  time.Duration
		want       int
	}{
		{"easy, first instant", domain.DifficultyEasy, five, five, 15},
		{"easy, middle: 10 + floor(2.5)", domain.DifficultyEasy, five, 150 * time.Second, 12},
		{"easy, last instant", domain.DifficultyEasy, five, 0, 10},
		{"medium, first instant", domain.DifficultyMedium, five, five, 30},
		{"medium, middle", domain.DifficultyMedium, five, 150 * time.Second, 25},
		{"medium, last instant", domain.DifficultyMedium, five, 0, 20},
		{"hard, first instant", domain.DifficultyHard, five, five, 45},
		{"hard, middle: 30 + floor(7.5)", domain.DifficultyHard, five, 150 * time.Second, 37},
		{"hard, one second left: the bonus is under one point", domain.DifficultyHard, five, time.Second, 30},
		{"hard, one second gone: 30 + floor(14.95)", domain.DifficultyHard, five, 299 * time.Second, 44},
		{"hard, after the end", domain.DifficultyHard, five, -10 * time.Second, 30},
		{"hard, more time left than the round has (a clock that went back)", domain.DifficultyHard, five, 10 * time.Minute, 45},
		{"easy, one minute round, 30 s left", domain.DifficultyEasy, time.Minute, 30 * time.Second, 12},
		{"hard, the longest round, first instant", domain.DifficultyHard, time.Hour, time.Hour, 45},
		{"unknown level", "IMPOSSIBLE", five, five, 0},
		{"empty level", "", five, five, 0},
		{"no duration gives the base", domain.DifficultyMedium, 0, 0, 20},
	} {
		assert.Equal(t, tc.want, domain.ExercisePoints(tc.difficulty, tc.duration, tc.remaining), tc.name)
	}
}

// Covers SPEC-065 CA-05: the base of each level.
func TestExerciseBasePoints(t *testing.T) {
	assert.Equal(t, 10, domain.ExerciseBasePoints(domain.DifficultyEasy))
	assert.Equal(t, 20, domain.ExerciseBasePoints(domain.DifficultyMedium))
	assert.Equal(t, 30, domain.ExerciseBasePoints(domain.DifficultyHard))
	assert.Equal(t, 0, domain.ExerciseBasePoints("other"))
}

// Covers SPEC-065 CA-01 and section 3.1 (live:exercise:start): the minutes are from 1 to 60 and, when missing, 5.
func TestExerciseMinutes(t *testing.T) {
	got, err := domain.ExerciseMinutes(nil)
	require.NoError(t, err)
	assert.Equal(t, 5, got, "the default is 5 minutes")
	assert.Equal(t, 5, domain.DefaultExerciseMinutes)

	for _, minutes := range []int{1, 2, 5, 30, 59, 60} {
		got, err := domain.ExerciseMinutes(ptr(minutes))
		assert.NoError(t, err, "%d", minutes)
		assert.Equal(t, minutes, got)
	}
	for _, minutes := range []int{0, -1, -60, 61, 100, 3600} {
		_, err := domain.ExerciseMinutes(ptr(minutes))
		assert.ErrorIs(t, err, domain.ErrInvalidExerciseMinutes, "%d", minutes)
	}
}

// Covers SPEC-065 section 3.1: the levels the round takes.
func TestValidExerciseDifficulty(t *testing.T) {
	for _, d := range []string{"EASY", "MEDIUM", "HARD"} {
		assert.True(t, domain.ValidExerciseDifficulty(d), d)
	}
	for _, d := range []string{"", "easy", "Easy", "EXPERT", " EASY"} {
		assert.False(t, domain.ValidExerciseDifficulty(d), d)
	}
}

// Covers SPEC-065 section 3.2 (domain): a round is born running, with the time that the teacher chose and the level and title of the exercise.
func TestStartExerciseRun(t *testing.T) {
	session, block := uuid.New(), uuid.New()
	run := domain.StartExerciseRun(session, block, 3, "Mudar a permissão", domain.DifficultyHard, 7, exerciseStart)
	assert.Equal(t, session, run.SessionID)
	assert.Equal(t, block, run.BlockID)
	assert.Equal(t, 3, run.ExerciseIndex)
	assert.Equal(t, "Mudar a permissão", run.Title)
	assert.Equal(t, domain.DifficultyHard, run.Difficulty)
	assert.Equal(t, 420, run.DurationSeconds)
	assert.Equal(t, 7*time.Minute, run.Duration())
	assert.Equal(t, exerciseStart, run.StartedAt)
	assert.Equal(t, exerciseStart.Add(7*time.Minute), run.EndsAt)
	assert.True(t, run.Running())
	assert.Nil(t, run.EndedAt)
	assert.Nil(t, run.EndedBy)
	assert.False(t, run.ResultVisible, "the result starts hidden")
	assert.Equal(t, "live_exercise_runs", run.TableName())
	assert.Equal(t, "live_exercise_results", domain.LiveExerciseResult{}.TableName())
}

// Covers SPEC-065 CA-03 and section 3.1 (Fim da rodada): a round goes from running to ended, by the timer, by the teacher or by the lesson,
// and the reason is kept; ending twice keeps the first end; a reason that is not one of the three is refused.
func TestExerciseRun_End(t *testing.T) {
	for _, by := range []string{domain.EndedByTimer, domain.EndedByTeacher, domain.EndedBySession} {
		run := runOf(domain.DifficultyEasy, 5)
		at := exerciseStart.Add(90 * time.Second)
		require.NoError(t, run.End(at, by), by)
		assert.False(t, run.Running())
		require.NotNil(t, run.EndedAt)
		assert.Equal(t, at, *run.EndedAt)
		require.NotNil(t, run.EndedBy)
		assert.Equal(t, by, *run.EndedBy)
	}

	run := runOf(domain.DifficultyEasy, 5)
	first := exerciseStart.Add(time.Minute)
	require.NoError(t, run.End(first, domain.EndedByTeacher))
	assert.ErrorIs(t, run.End(first.Add(time.Minute), domain.EndedByTimer), domain.ErrExerciseEnded)
	assert.Equal(t, first, *run.EndedAt, "the first end stays")
	assert.Equal(t, domain.EndedByTeacher, *run.EndedBy)

	fresh := runOf(domain.DifficultyEasy, 5)
	assert.Error(t, fresh.End(first, "NOBODY"))
	assert.Error(t, fresh.End(first, ""))
	assert.True(t, fresh.Running(), "a reason that does not exist ends nothing")
	assert.Equal(t, "TIMER", domain.EndedByTimer)
	assert.Equal(t, "TEACHER", domain.EndedByTeacher)
	assert.Equal(t, "SESSION", domain.EndedBySession)
}

// Covers SPEC-065 CA-10 and section 3.1 (live:exercise:reveal): the result is shown or hidden only when the round has ended.
func TestExerciseRun_ShowResultOnlyWhenEnded(t *testing.T) {
	run := runOf(domain.DifficultyMedium, 5)
	assert.ErrorIs(t, run.ShowResult(true), domain.ErrExerciseRunning)
	assert.ErrorIs(t, run.ShowResult(false), domain.ErrExerciseRunning)
	assert.False(t, run.ResultVisible)

	require.NoError(t, run.End(exerciseStart.Add(time.Minute), domain.EndedByTeacher))
	require.NoError(t, run.ShowResult(true))
	assert.True(t, run.ResultVisible)
	require.NoError(t, run.ShowResult(true), "showing again changes nothing and is not an error")
	assert.True(t, run.ResultVisible)
	require.NoError(t, run.ShowResult(false))
	assert.False(t, run.ResultVisible)
}

// Covers SPEC-065 CA-03 and section 3.1 (Fim da rodada): a running round is expired from its endsAt on, and never before; an ended one is not.
func TestExerciseRun_Expired(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	assert.False(t, run.Expired(exerciseStart))
	assert.False(t, run.Expired(run.EndsAt.Add(-time.Nanosecond)))
	assert.True(t, run.Expired(run.EndsAt), "at endsAt it is over")
	assert.True(t, run.Expired(run.EndsAt.Add(time.Hour)))
	require.NoError(t, run.End(run.EndsAt, domain.EndedByTimer))
	assert.False(t, run.Expired(run.EndsAt.Add(time.Hour)), "an ended round is not expired, it is ended")
}

// Covers SPEC-065 CA-04 and section 3.1 (Conferência): an answer is taken while the round runs, and up to 2 seconds after it ended (a submission
// in transit); after that, the round is over.
func TestExerciseRun_AcceptsAnswerAt(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 5)
	assert.NoError(t, run.AcceptsAnswerAt(exerciseStart.Add(time.Minute)), "running")

	end := exerciseStart.Add(2 * time.Minute)
	require.NoError(t, run.End(end, domain.EndedByTeacher))
	assert.NoError(t, run.AcceptsAnswerAt(end), "at the end")
	assert.NoError(t, run.AcceptsAnswerAt(end.Add(time.Second)), "one second after")
	assert.NoError(t, run.AcceptsAnswerAt(end.Add(2*time.Second)), "two seconds after: the last instant")
	assert.ErrorIs(t, run.AcceptsAnswerAt(end.Add(2*time.Second+time.Millisecond)), domain.ErrExerciseEnded)
	assert.ErrorIs(t, run.AcceptsAnswerAt(end.Add(time.Hour)), domain.ErrExerciseEnded)
	assert.Equal(t, 2*time.Second, domain.ExerciseSubmitGrace)
}

// Covers SPEC-065 CA-04, CA-05: the time of the student is counted in whole seconds from the start (never negative), and his points are those
// of the instant he finished.
func TestExerciseRun_ElapsedAndPointsAt(t *testing.T) {
	run := runOf(domain.DifficultyEasy, 1) // 60 seconds
	assert.Equal(t, 0, run.ElapsedAt(exerciseStart))
	assert.Equal(t, 95, runOf(domain.DifficultyEasy, 5).ElapsedAt(exerciseStart.Add(95900*time.Millisecond)), "whole seconds, rounded down")
	assert.Equal(t, 0, run.ElapsedAt(exerciseStart.Add(-time.Second)), "never negative")

	assert.Equal(t, 15, run.PointsAt(exerciseStart), "first instant")
	assert.Equal(t, 12, run.PointsAt(exerciseStart.Add(30*time.Second)), "middle")
	assert.Equal(t, 10, run.PointsAt(exerciseStart.Add(60*time.Second)), "at endsAt")
	assert.Equal(t, 10, run.PointsAt(exerciseStart.Add(61*time.Second)), "in the grace after the end")
}

// Covers SPEC-065 section 3.1 (live:exercise:progress): met and total are from 0 to 100 with met up to total; the last command has up to 200
// characters (counted by character) and no control characters, and it is kept as it came.
func TestExerciseProgress_Rules(t *testing.T) {
	for _, tc := range []struct {
		met, total int
		ok         bool
	}{{0, 0, true}, {0, 4, true}, {2, 4, true}, {4, 4, true}, {100, 100, true}, {0, 100, true},
		{5, 4, false}, {-1, 4, false}, {0, -1, false}, {1, 101, false}, {101, 101, false}, {-1, -1, false}} {
		assert.Equal(t, tc.ok, domain.ValidExerciseProgress(tc.met, tc.total), "%d of %d", tc.met, tc.total)
	}

	for _, last := range []string{"", "ls -l /home", "echo 'olá, mundo' > /tmp/a.txt", strings.Repeat("a", 200), strings.Repeat("ã", 200), strings.Repeat("😀", 200),
		"  com espaços nas pontas  ", "<b>negrito</b> && rm -rf /; $(x)"} {
		got, err := domain.NormalizeExerciseLast(last)
		assert.NoError(t, err, last)
		assert.Equal(t, last, got, "it is kept as it came")
	}
	for _, last := range []string{strings.Repeat("a", 201), strings.Repeat("😀", 201), "a\tb", "a\nb", "a\rb", "a\x00b", "a\x1bb", "a\x7fb", "a\u0085b", "a\xffb"} {
		got, err := domain.NormalizeExerciseLast(last)
		assert.ErrorIs(t, err, domain.ErrInvalidExerciseProgress, "%q", last)
		assert.Empty(t, got)
	}
}

// Covers SPEC-065 CA-10 and section 3.1 (live:exercise:result): the scoreboard is ordered by points, from the highest, and then by time, from the
// shortest; a tie of both is told by the moment of the conclusion and then by the student, so that the order is always the same.
func TestSortScoreboard(t *testing.T) {
	id := func(n byte) uuid.UUID { return uuid.UUID{15: n} }
	at := func(s int) time.Time { return exerciseStart.Add(time.Duration(s) * time.Second) }
	list := []domain.ExerciseResultEntry{
		{StudentID: id(1), Name: "Ana", Points: 20, ElapsedSeconds: 60, CompletedAt: at(60)},
		{StudentID: id(2), Name: "Bruno", Points: 30, ElapsedSeconds: 200, CompletedAt: at(200)},
		{StudentID: id(3), Name: "Carla", Points: 30, ElapsedSeconds: 100, CompletedAt: at(100)},
		{StudentID: id(5), Name: "Eva", Points: 20, ElapsedSeconds: 60, CompletedAt: at(61)},
		{StudentID: id(4), Name: "Davi", Points: 20, ElapsedSeconds: 60, CompletedAt: at(61)},
		{StudentID: id(6), Name: "Fábio", Points: 10, ElapsedSeconds: 5, CompletedAt: at(5)},
	}
	domain.SortScoreboard(list)
	names := make([]string, len(list))
	for i, e := range list {
		names[i] = e.Name
	}
	assert.Equal(t, []string{"Carla", "Bruno", "Ana", "Davi", "Eva", "Fábio"}, names)

	domain.SortScoreboard(nil) // nothing to sort is no error
}
