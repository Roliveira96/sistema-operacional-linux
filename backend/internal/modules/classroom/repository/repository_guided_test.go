package repository_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- SPEC-071: the guided practice of the lesson ----

func (e env) readRun(t *testing.T, id uuid.UUID) domain.LiveExerciseRun {
	t.Helper()
	got, err := e.repo.FindExerciseRun(e.ctx, id)
	require.NoError(t, err)
	return got
}

func participantsOf(t *testing.T, e env, run uuid.UUID) map[uuid.UUID]domain.ExerciseParticipant {
	t.Helper()
	list, err := e.repo.ListExerciseParticipants(e.ctx, run)
	require.NoError(t, err)
	out := map[uuid.UUID]domain.ExerciseParticipant{}
	for _, p := range list {
		out[p.StudentID] = p
	}
	return out
}

// Covers SPEC-071 RN-01 and section 3.4: the pause is kept and taken back, and the resume keeps the new end and the time paused; each one only
// changes the round in the state it expects.
func TestExerciseRun_PauseResumeKept(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)

	at := e.now.Add(time.Minute)
	changed, err := e.repo.PauseExerciseRun(e.ctx, run.ID, at)
	require.NoError(t, err)
	assert.True(t, changed)
	got := e.readRun(t, run.ID)
	require.NotNil(t, got.PausedAt)
	assert.True(t, got.PausedAt.Equal(at))
	changed, err = e.repo.PauseExerciseRun(e.ctx, run.ID, at)
	require.NoError(t, err)
	assert.False(t, changed, "a round already paused does not pause again")

	require.NoError(t, got.Resume(at.Add(30*time.Second)))
	changed, err = e.repo.ResumeExerciseRun(e.ctx, got)
	require.NoError(t, err)
	assert.True(t, changed)
	back := e.readRun(t, run.ID)
	assert.Nil(t, back.PausedAt)
	assert.Equal(t, 30, back.PausedSeconds)
	assert.True(t, back.EndsAt.Equal(run.EndsAt.Add(30*time.Second)))
	changed, err = e.repo.ResumeExerciseRun(e.ctx, back)
	require.NoError(t, err)
	assert.False(t, changed, "a round that is not paused does not resume")
}

// Covers SPEC-071 RN-01: a round that ends while paused counts the pause up to the end and is no longer paused.
func TestExerciseRun_EndWhilePaused(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	_, err := e.repo.PauseExerciseRun(e.ctx, run.ID, e.now.Add(time.Minute))
	require.NoError(t, err)
	got := e.endRun(t, run, e.now.Add(3*time.Minute), domain.EndedByTeacher)
	assert.Nil(t, got.PausedAt)
	assert.Equal(t, 120, got.PausedSeconds)
}

// Covers SPEC-071 RN-02, CA-02 and CA-03: more time is kept in a running round; a round that ended reopens, with no end and the result hidden;
// a closed round, or one that runs when a reopening is asked, does not change.
func TestExerciseRun_ExtendAndReopenKept(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)

	_, err := run.Extend(2, e.now)
	require.NoError(t, err)
	changed, err := e.repo.ExtendExerciseRun(e.ctx, run, false)
	require.NoError(t, err)
	assert.True(t, changed)
	got := e.readRun(t, run.ID)
	assert.Equal(t, 420, got.DurationSeconds)
	assert.True(t, got.EndsAt.Equal(e.now.Add(7*time.Minute)))
	changed, err = e.repo.ExtendExerciseRun(e.ctx, got, true)
	require.NoError(t, err)
	assert.False(t, changed, "a round that runs is not reopened")

	ended := e.endRun(t, got, e.now.Add(7*time.Minute), domain.EndedByTimer)
	_, err = e.repo.SetExerciseResultVisible(e.ctx, run.ID, true)
	require.NoError(t, err)
	ended.ResultVisible = true
	changed, err = e.repo.ExtendExerciseRun(e.ctx, ended, false)
	require.NoError(t, err)
	assert.False(t, changed, "more time without reopening needs a round that runs")

	reopenAt := e.now.Add(8 * time.Minute)
	_, err = ended.Extend(3, reopenAt)
	require.NoError(t, err)
	changed, err = e.repo.ExtendExerciseRun(e.ctx, ended, true)
	require.NoError(t, err)
	assert.True(t, changed)
	again := e.readRun(t, run.ID)
	assert.True(t, again.Running())
	assert.Nil(t, again.EndedBy)
	assert.False(t, again.ResultVisible)
	assert.Equal(t, 600, again.DurationSeconds)
	assert.True(t, again.EndsAt.Equal(reopenAt.Add(3*time.Minute)))
	current, err := e.repo.CurrentExerciseRun(e.ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, run.ID, current.ID)

	closed := e.endRun(t, again, reopenAt, domain.EndedByTeacher)
	changed, err = e.repo.CloseExerciseRun(e.ctx, run.ID, reopenAt)
	require.NoError(t, err)
	assert.True(t, changed)
	_, err = closed.Extend(1, reopenAt)
	require.NoError(t, err)
	changed, err = e.repo.ExtendExerciseRun(e.ctx, closed, true)
	require.NoError(t, err)
	assert.False(t, changed, "a closed round never reopens")
}

// Covers SPEC-071 RN-02: a round reopens only if no other one runs in the room (the unique index of the round that runs).
func TestExerciseRun_ReopenWithAnotherRunning(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	first := e.startRun(t, s, domain.DifficultyEasy, 5, e.now.Add(-time.Hour))
	ended := e.endRun(t, first, e.now.Add(-50*time.Minute), domain.EndedByTimer)
	e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	_, err := ended.Extend(2, e.now)
	require.NoError(t, err)
	_, err = e.repo.ExtendExerciseRun(e.ctx, ended, true)
	assert.ErrorIs(t, err, domain.ErrExerciseRunning)
}

// Covers SPEC-071 RN-04: only a round that ended is closed, once, with the moment.
func TestExerciseRun_CloseKept(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	changed, err := e.repo.CloseExerciseRun(e.ctx, run.ID, e.now)
	require.NoError(t, err)
	assert.False(t, changed, "a round that runs is not closed")
	e.endRun(t, run, e.now.Add(time.Minute), domain.EndedByTeacher)
	at := e.now.Add(2 * time.Minute)
	changed, err = e.repo.CloseExerciseRun(e.ctx, run.ID, at)
	require.NoError(t, err)
	assert.True(t, changed)
	got := e.readRun(t, run.ID)
	require.NotNil(t, got.ClosedAt)
	assert.True(t, got.ClosedAt.Equal(at))
	assert.Equal(t, domain.ExerciseStatusClosed, got.Status())
	changed, err = e.repo.CloseExerciseRun(e.ctx, run.ID, at.Add(time.Minute))
	require.NoError(t, err)
	assert.False(t, changed, "closed once")
}

// Covers SPEC-071 RN-08 and CA-12: every student of the round has one row, made when he gets the round, IN_PROGRESS; joining again does not
// make another one; the help and the takeover are marked, also for a student who had no row yet.
func TestExerciseParticipants_OneRowEach(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	carla := e.newStudent(t, "1000003", "Carla")
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)

	require.NoError(t, e.repo.JoinExerciseRun(e.ctx, run.ID, []uuid.UUID{e.student.ID, bruno.ID}))
	require.NoError(t, e.repo.JoinExerciseRun(e.ctx, run.ID, []uuid.UUID{e.student.ID}))
	require.NoError(t, e.repo.JoinExerciseRun(e.ctx, run.ID, nil))
	require.NoError(t, e.repo.MarkExerciseHelp(e.ctx, run.ID, bruno.ID))
	require.NoError(t, e.repo.MarkExerciseTakeover(e.ctx, run.ID, carla.ID))

	got := participantsOf(t, e, run.ID)
	require.Len(t, got, 3)
	assert.Equal(t, domain.ParticipantInProgress, got[e.student.ID].Status)
	assert.False(t, got[e.student.ID].HelpRequested)
	assert.False(t, got[e.student.ID].TakenOver)
	assert.True(t, got[bruno.ID].HelpRequested)
	assert.True(t, got[carla.ID].TakenOver)
	assert.Equal(t, domain.ParticipantInProgress, got[carla.ID].Status)
	assert.Equal(t, "Bruno", got[bruno.ID].Name)
}

// Covers SPEC-071 RN-07, RN-08 and CA-08: the conclusion turns the row of the student into COMPLETED with the time, the commands and the attempts;
// a student who had his terminal taken over concludes with 0 points, whatever points were asked; it is kept once.
func TestExerciseResult_OverTheParticipantRow(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyHard, 5, e.now)
	require.NoError(t, e.repo.JoinExerciseRun(e.ctx, run.ID, []uuid.UUID{e.student.ID, bruno.ID}))
	require.NoError(t, e.repo.MarkExerciseTakeover(e.ctx, run.ID, bruno.ID))

	save := func(student uuid.UUID, points, commands int) (domain.LiveExerciseResult, bool) {
		r := domain.LiveExerciseResult{RunID: run.ID, StudentID: student, CompletedAt: e.now.Add(time.Minute), ElapsedSeconds: 60,
			Points: points, Attempts: 2, Commands: commands}
		saved, created, err := e.repo.SaveExerciseResult(e.ctx, &r)
		require.NoError(t, err)
		return saved, created
	}
	ana, created := save(e.student.ID, 39, 7)
	assert.True(t, created)
	assert.Equal(t, 39, ana.Points)
	helped, created := save(bruno.ID, 39, 4)
	assert.True(t, created)
	assert.Equal(t, 0, helped.Points, "the teacher took over his terminal")
	assert.True(t, helped.TakenOver)
	_, created = save(e.student.ID, 45, 9)
	assert.False(t, created, "kept once")

	got := participantsOf(t, e, run.ID)
	require.Len(t, got, 2, "the conclusion did not make another row")
	assert.Equal(t, domain.ParticipantCompleted, got[e.student.ID].Status)
	assert.Equal(t, 7, got[e.student.ID].Commands)
	kept, err := e.repo.FindExerciseResult(e.ctx, run.ID, e.student.ID)
	require.NoError(t, err)
	assert.Equal(t, 39, kept.Points)
	assert.Equal(t, 60, kept.ElapsedSeconds)

	list, err := e.repo.ListExerciseResults(e.ctx, run.ID)
	require.NoError(t, err)
	require.Len(t, list, 2, "the scoreboard has who concluded")
	assert.Equal(t, e.student.ID, list[0].StudentID)
	assert.Equal(t, 0, list[1].Points)
}

// Covers SPEC-071 RN-08: a student who did not conclude has no result: not found, not on the scoreboard, and no points in the sum.
func TestExerciseResult_InProgressIsNotAResult(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	require.NoError(t, e.repo.JoinExerciseRun(e.ctx, run.ID, []uuid.UUID{e.student.ID}))
	_, err := e.repo.FindExerciseResult(e.ctx, run.ID, e.student.ID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseResult)
	list, err := e.repo.ListExerciseResults(e.ctx, run.ID)
	require.NoError(t, err)
	assert.Empty(t, list)
	points, err := e.repo.ExercisePointsByStudent(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Empty(t, points, "a round he did not conclude does not count")
}

// Covers SPEC-071 RN-08 and RN-09: at the end, who did not conclude becomes NOT_COMPLETED with the commands he reported; who concluded stays; a
// reopening takes them back to IN_PROGRESS; the commands only grow.
func TestExerciseParticipants_FinishAndReopen(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	require.NoError(t, e.repo.JoinExerciseRun(e.ctx, run.ID, []uuid.UUID{e.student.ID, bruno.ID}))
	e.result(t, run, e.student.ID, 30, 12, 1)

	require.NoError(t, e.repo.FinishExerciseParticipants(e.ctx, run.ID, map[uuid.UUID]int{bruno.ID: 5}))
	got := participantsOf(t, e, run.ID)
	assert.Equal(t, domain.ParticipantCompleted, got[e.student.ID].Status)
	assert.Equal(t, domain.ParticipantNotCompleted, got[bruno.ID].Status)
	assert.Equal(t, 5, got[bruno.ID].Commands)

	require.NoError(t, e.repo.ReopenExerciseParticipants(e.ctx, run.ID))
	got = participantsOf(t, e, run.ID)
	assert.Equal(t, domain.ParticipantCompleted, got[e.student.ID].Status)
	assert.Equal(t, domain.ParticipantInProgress, got[bruno.ID].Status)

	require.NoError(t, e.repo.FinishExerciseParticipants(e.ctx, run.ID, map[uuid.UUID]int{bruno.ID: 2}))
	got = participantsOf(t, e, run.ID)
	assert.Equal(t, 5, got[bruno.ID].Commands, "a smaller number does not take the commands back")
}

// Covers SPEC-071 CA-16 and section 4: the migration 00040 adds the columns of the pause, of the close and of the participants; the results of
// SPEC-065 become COMPLETED and the rounds that ended before it are closed; going down takes the columns back and keeps only the conclusions.
func TestMigration00040_AddsTheColumnsAndTakesThemBack(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00040_")
	columns, _ := exerciseTables(t, e)
	for _, c := range []string{"paused_at", "paused_seconds", "closed_at"} {
		assert.Contains(t, columns["live_exercise_runs"], c)
	}
	for _, c := range []string{"status", "commands", "help_requested", "taken_over"} {
		assert.Contains(t, columns["live_exercise_results"], c)
	}

	bruno := e.newStudent(t, "1000002", "Bruno")
	s := e.openRoom(t)
	old := e.startRun(t, s, domain.DifficultyEasy, 5, e.now.Add(-time.Hour))
	e.result(t, old, e.student.ID, 30, 12, 1)
	require.NoError(t, e.repo.JoinExerciseRun(e.ctx, old.ID, []uuid.UUID{bruno.ID}))
	e.endRun(t, old, e.now.Add(-50*time.Minute), domain.EndedByTimer)

	runMigration(t, e, down)
	columns, _ = exerciseTables(t, e)
	assert.NotContains(t, columns["live_exercise_runs"], "closed_at")
	assert.NotContains(t, columns["live_exercise_results"], "status")
	var rows int64
	require.NoError(t, e.db.Conn(e.ctx).Table("live_exercise_results").Where("deleted_at IS NULL").Count(&rows).Error)
	assert.Equal(t, int64(1), rows, "only the conclusion stays, as SPEC-065 kept it")

	runMigration(t, e, up)
	got := participantsOf(t, e, old.ID)
	assert.Equal(t, domain.ParticipantCompleted, got[e.student.ID].Status, "the results of SPEC-065 are conclusions")
	closed := e.readRun(t, old.ID)
	assert.Equal(t, domain.ExerciseStatusClosed, closed.Status(), "a round that ended before 00040 is closed: the class went back to the lesson")
}

// Covers SPEC-071 section 4: the database refuses a result that says COMPLETED with no time, and one that has a time but is not COMPLETED.
func TestExercise_TheDatabaseHoldsTheParticipantRules(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	ra := 2000000
	insert := func(status string, completed bool) error {
		ra++
		var at any
		var elapsed, points any
		if completed {
			at, elapsed, points = e.now, 10, 10
		}
		return e.db.Conn(e.ctx).Exec(`INSERT INTO live_exercise_results (id, run_id, student_id, status, completed_at, elapsed_seconds, points, attempts,
			commands, help_requested, taken_over, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, false, false, now(), now())`,
			uuid.New(), run.ID, e.newStudent(t, strconv.Itoa(ra), "X").ID, status, at, elapsed, points).Error
	}
	assert.Error(t, insert(domain.ParticipantCompleted, false))
	assert.Error(t, insert(domain.ParticipantInProgress, true))
	assert.Error(t, insert("DONE", false))
	assert.NoError(t, insert(domain.ParticipantInProgress, false))
	assert.NoError(t, insert(domain.ParticipantCompleted, true))
}
