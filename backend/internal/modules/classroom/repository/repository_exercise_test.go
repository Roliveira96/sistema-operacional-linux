package repository_test

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

// startRun saves a running round of the room, with the level and the minutes the test chose.
func (e env) startRun(t *testing.T, s domain.LiveClassroomSession, difficulty string, minutes int, at time.Time) domain.LiveExerciseRun {
	t.Helper()
	run := domain.StartExerciseRun(s.ID, uuid.New(), 1, "Criar a pasta", difficulty, minutes, at)
	require.NoError(t, e.repo.CreateExerciseRun(e.ctx, &run))
	return run
}

// endRun ends the round and reads it back.
func (e env) endRun(t *testing.T, run domain.LiveExerciseRun, at time.Time, by string) domain.LiveExerciseRun {
	t.Helper()
	changed, err := e.repo.EndExerciseRun(e.ctx, run.ID, at, by)
	require.NoError(t, err)
	require.True(t, changed)
	got, err := e.repo.FindExerciseRun(e.ctx, run.ID)
	require.NoError(t, err)
	return got
}

// result saves the result of a student in a round.
func (e env) result(t *testing.T, run domain.LiveExerciseRun, student uuid.UUID, elapsed, points, attempts int) domain.LiveExerciseResult {
	t.Helper()
	r := domain.LiveExerciseResult{RunID: run.ID, StudentID: student, CompletedAt: run.StartedAt.Add(time.Duration(elapsed) * time.Second),
		ElapsedSeconds: elapsed, Points: points, Attempts: attempts}
	saved, created, err := e.repo.SaveExerciseResult(e.ctx, &r)
	require.NoError(t, err)
	require.True(t, created)
	return saved
}

// Covers SPEC-065 CA-01 and section 3.2 (repository): a round is saved with the room, the block, the exercise, its title and level, the time and
// the moments, and read back as it went in; the id is a UUIDv7 made by the server; the result starts hidden.
func TestExerciseRun_SavedAndRead(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	block := uuid.New()
	run := domain.StartExerciseRun(s.ID, block, 2, "Mudar a permissão", domain.DifficultyHard, 7, e.now)
	require.NoError(t, e.repo.CreateExerciseRun(e.ctx, &run))
	assert.Equal(t, 7, int(run.ID.Version()), "the id is a UUIDv7 made by the server")

	got, err := e.repo.FindExerciseRun(e.ctx, run.ID)
	require.NoError(t, err)
	assert.Equal(t, run.ID, got.ID)
	assert.Equal(t, s.ID, got.SessionID)
	assert.Equal(t, block, got.BlockID)
	assert.Equal(t, 2, got.ExerciseIndex)
	assert.Equal(t, "Mudar a permissão", got.Title)
	assert.Equal(t, domain.DifficultyHard, got.Difficulty)
	assert.Equal(t, 420, got.DurationSeconds)
	assert.True(t, got.StartedAt.Equal(e.now))
	assert.True(t, got.EndsAt.Equal(e.now.Add(7*time.Minute)))
	assert.True(t, got.Running())
	assert.Nil(t, got.EndedAt)
	assert.Nil(t, got.EndedBy)
	assert.False(t, got.ResultVisible)

	_, err = e.repo.FindExerciseRun(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun)
}

// Covers SPEC-065 CA-01 and section 3.2: a room has at most one round running, kept by the database: a second one fails, another room has its
// own, and ending the first frees the room for the next.
func TestExerciseRun_OnlyOneRunningPerRoom(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	first := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)

	second := domain.StartExerciseRun(s.ID, uuid.New(), 0, "Outro", domain.DifficultyEasy, 5, e.now.Add(time.Second))
	assert.ErrorIs(t, e.repo.CreateExerciseRun(e.ctx, &second), domain.ErrExerciseRunning)

	other := e.newClass(t, "SO99X")
	otherRoom := e.session(other.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &otherRoom))
	third := domain.StartExerciseRun(otherRoom.ID, uuid.New(), 0, "De outra sala", domain.DifficultyEasy, 5, e.now)
	assert.NoError(t, e.repo.CreateExerciseRun(e.ctx, &third), "another room has its own round")

	e.endRun(t, first, e.now.Add(time.Minute), domain.EndedByTeacher)
	assert.NoError(t, e.repo.CreateExerciseRun(e.ctx, &second), "an ended round frees the room")
	fourth := domain.StartExerciseRun(s.ID, uuid.New(), 0, "Mais um", domain.DifficultyEasy, 5, e.now.Add(2*time.Minute))
	assert.ErrorIs(t, e.repo.CreateExerciseRun(e.ctx, &fourth), domain.ErrExerciseRunning, "and the new one holds it again")
}

// Covers SPEC-065 CA-03 and section 3.2: a round is ended with the reason (timer, teacher or lesson) and the moment; ending an ended one changes
// nothing and says so, so that only who ended it tells the room.
func TestExerciseRun_EndKeepsTheReason(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	for i, by := range []string{domain.EndedByTimer, domain.EndedByTeacher, domain.EndedBySession} {
		run := e.startRun(t, s, domain.DifficultyMedium, 5, e.now.Add(time.Duration(i)*time.Hour))
		at := run.StartedAt.Add(90 * time.Second)
		got := e.endRun(t, run, at, by)
		assert.False(t, got.Running(), by)
		require.NotNil(t, got.EndedAt)
		assert.True(t, got.EndedAt.Equal(at), by)
		require.NotNil(t, got.EndedBy)
		assert.Equal(t, by, *got.EndedBy)

		changed, err := e.repo.EndExerciseRun(e.ctx, run.ID, at.Add(time.Minute), domain.EndedByTimer)
		require.NoError(t, err)
		assert.False(t, changed, "already ended: nothing changed")
		again, err := e.repo.FindExerciseRun(e.ctx, run.ID)
		require.NoError(t, err)
		assert.True(t, again.EndedAt.Equal(at), "the first end stays")
		assert.Equal(t, by, *again.EndedBy)
	}

	changed, err := e.repo.EndExerciseRun(e.ctx, uuid.New(), e.now, domain.EndedByTeacher)
	require.NoError(t, err)
	assert.False(t, changed, "no such round")
}

// Covers SPEC-065 section 3.1 (instantâneo): the round of the room is the one running or, if there is none, the last one that ended; a room with
// no round has none.
func TestExerciseRun_CurrentIsTheRunningOrTheLastEnded(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	_, err := e.repo.CurrentExerciseRun(e.ctx, s.ID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "no round yet")

	older := e.startRun(t, s, domain.DifficultyEasy, 5, e.now.Add(-3*time.Hour))
	e.endRun(t, older, older.StartedAt.Add(time.Minute), domain.EndedByTimer)
	newer := e.startRun(t, s, domain.DifficultyHard, 5, e.now.Add(-time.Hour))
	e.endRun(t, newer, newer.StartedAt.Add(time.Minute), domain.EndedByTeacher)
	current, err := e.repo.CurrentExerciseRun(e.ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, newer.ID, current.ID, "the last one that ended")
	assert.False(t, current.Running())

	running := e.startRun(t, s, domain.DifficultyMedium, 5, e.now)
	current, err = e.repo.CurrentExerciseRun(e.ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, running.ID, current.ID, "the one that runs")
	assert.True(t, current.Running())

	other := e.newClass(t, "SO99X")
	otherRoom := e.session(other.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &otherRoom))
	_, err = e.repo.CurrentExerciseRun(e.ctx, otherRoom.ID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "the rounds of another room are not this room's")
}

// Covers SPEC-065 CA-10 and section 3.2: the result is shown and hidden only on a round that ended; on a running one nothing changes.
func TestExerciseRun_ResultVisibility(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)

	changed, err := e.repo.SetExerciseResultVisible(e.ctx, run.ID, true)
	require.NoError(t, err)
	assert.False(t, changed, "a running round shows no result")
	got, err := e.repo.FindExerciseRun(e.ctx, run.ID)
	require.NoError(t, err)
	assert.False(t, got.ResultVisible)

	e.endRun(t, run, e.now.Add(time.Minute), domain.EndedByTeacher)
	changed, err = e.repo.SetExerciseResultVisible(e.ctx, run.ID, true)
	require.NoError(t, err)
	assert.True(t, changed)
	got, err = e.repo.FindExerciseRun(e.ctx, run.ID)
	require.NoError(t, err)
	assert.True(t, got.ResultVisible)

	changed, err = e.repo.SetExerciseResultVisible(e.ctx, run.ID, false)
	require.NoError(t, err)
	assert.True(t, changed)
	got, err = e.repo.FindExerciseRun(e.ctx, run.ID)
	require.NoError(t, err)
	assert.False(t, got.ResultVisible)

	changed, err = e.repo.SetExerciseResultVisible(e.ctx, uuid.New(), true)
	require.NoError(t, err)
	assert.False(t, changed, "no such round")
}

// Covers SPEC-065 CA-04, CA-11 and section 3.2: the result of a student is saved once per round: the second one does not change the first, and
// what comes back is the one that was kept, with a flag that says it was not created; another student, or another round, has his own.
func TestExerciseResult_OneByStudentAndRun(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyMedium, 5, e.now)
	ana, bruno := e.student.ID, e.newStudent(t, "1000002", "Bruno").ID

	first := e.result(t, run, ana, 95, 28, 3)
	assert.Equal(t, 7, int(first.ID.Version()), "the id is a UUIDv7 made by the server")
	assert.Equal(t, run.ID, first.RunID)
	assert.Equal(t, ana, first.StudentID)
	assert.Equal(t, 95, first.ElapsedSeconds)
	assert.Equal(t, 28, first.Points)
	assert.Equal(t, 3, first.Attempts)
	assert.True(t, first.CompletedAt.Equal(run.StartedAt.Add(95*time.Second)))

	again := domain.LiveExerciseResult{RunID: run.ID, StudentID: ana, CompletedAt: run.StartedAt.Add(200 * time.Second), ElapsedSeconds: 200, Points: 20, Attempts: 9}
	kept, created, err := e.repo.SaveExerciseResult(e.ctx, &again)
	require.NoError(t, err)
	assert.False(t, created, "the student already has his result")
	assert.Equal(t, first.ID, kept.ID)
	assert.Equal(t, 95, kept.ElapsedSeconds, "what comes back is what was kept")
	assert.Equal(t, 28, kept.Points)
	assert.Equal(t, 3, kept.Attempts)

	found, err := e.repo.FindExerciseResult(e.ctx, run.ID, ana)
	require.NoError(t, err)
	assert.Equal(t, first.ID, found.ID)
	assert.Equal(t, 28, found.Points, "nothing changed")

	e.result(t, run, bruno, 120, 25, 1) // another student of the same round
	e.endRun(t, run, e.now.Add(6*time.Minute), domain.EndedByTimer)
	next := e.startRun(t, s, domain.DifficultyEasy, 5, e.now.Add(10*time.Minute))
	e.result(t, next, ana, 30, 12, 1) // the same student, in another round

	_, err = e.repo.FindExerciseResult(e.ctx, next.ID, bruno)
	assert.ErrorIs(t, err, domain.ErrNoExerciseResult, "Bruno has none in the new round")
	_, err = e.repo.FindExerciseResult(e.ctx, uuid.New(), ana)
	assert.ErrorIs(t, err, domain.ErrNoExerciseResult)
}

// Covers SPEC-065 CA-10, CA-11 and section 3.2: the results of a round are read with the name of each student, and only the ones of that round.
func TestExerciseResults_ListedWithNames(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyHard, 5, e.now)
	bruno := e.newStudent(t, "1000002", "Bruno")
	e.result(t, run, e.student.ID, 95, 40, 2)
	e.result(t, run, bruno.ID, 30, 41, 1)
	e.endRun(t, run, e.now.Add(6*time.Minute), domain.EndedByTimer)
	next := e.startRun(t, s, domain.DifficultyEasy, 5, e.now.Add(time.Hour))
	e.result(t, next, e.student.ID, 10, 14, 1)

	list, err := e.repo.ListExerciseResults(e.ctx, run.ID)
	require.NoError(t, err)
	require.Len(t, list, 2)
	byName := map[string]domain.ExerciseResultEntry{list[0].Name: list[0], list[1].Name: list[1]}
	require.Contains(t, byName, "Ana")
	require.Contains(t, byName, "Bruno")
	ana := byName["Ana"]
	assert.Equal(t, e.student.ID, ana.StudentID)
	assert.Equal(t, 95, ana.ElapsedSeconds)
	assert.Equal(t, 40, ana.Points)
	assert.Equal(t, 2, ana.Attempts)
	assert.True(t, ana.CompletedAt.Equal(run.StartedAt.Add(95*time.Second)))

	none, err := e.repo.ListExerciseResults(e.ctx, uuid.New())
	require.NoError(t, err)
	assert.Empty(t, none)
}

// Covers SPEC-065 section 3.2: the names of the students, by id, for the cards of a round; an id that is nobody is left out; no ids is no query.
func TestUserNames(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	names, err := e.repo.UserNames(e.ctx, []uuid.UUID{e.student.ID, bruno.ID, uuid.New()})
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]string{e.student.ID: "Ana", bruno.ID: "Bruno"}, names)

	names, err = e.repo.UserNames(e.ctx, nil)
	require.NoError(t, err)
	assert.Empty(t, names)
}

// Covers SPEC-065 CA-11: the repository gives the sum of the points of each student in the rounds of the rooms of a class (the base of the
// gamification): the points of every round add up, another class's rounds do not, and a student with no result is not in the list. The list
// comes from the most points to the fewest.
func TestExercisePointsByStudent(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	carla := e.newStudent(t, "1000003", "Carla")
	s := e.openRoom(t)
	first := e.startRun(t, s, domain.DifficultyHard, 5, e.now.Add(-3*time.Hour))
	e.result(t, first, e.student.ID, 60, 40, 1)
	e.result(t, first, bruno.ID, 100, 35, 2)
	e.endRun(t, first, first.StartedAt.Add(6*time.Minute), domain.EndedByTimer)
	second := e.startRun(t, s, domain.DifficultyEasy, 5, e.now.Add(-2*time.Hour))
	e.result(t, second, e.student.ID, 30, 14, 1)
	e.endRun(t, second, second.StartedAt.Add(6*time.Minute), domain.EndedByTimer)
	// the room ended; another room of the same class has a round too
	got, err := e.repo.FindSession(e.ctx, s.ID)
	require.NoError(t, err)
	got.End(e.now.Add(-time.Hour))
	require.NoError(t, e.repo.SaveSession(e.ctx, &got))
	again := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &again))
	third := e.startRun(t, again, domain.DifficultyMedium, 5, e.now)
	e.result(t, third, bruno.ID, 20, 26, 1)

	// a round of another class, with a student of this one
	other := e.newClass(t, "SO99X", e.student.ID)
	otherRoom := e.session(other.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &otherRoom))
	foreign := e.startRun(t, otherRoom, domain.DifficultyHard, 5, e.now)
	e.result(t, foreign, e.student.ID, 5, 44, 1)
	e.result(t, foreign, carla.ID, 5, 44, 1)

	list, err := e.repo.ExercisePointsByStudent(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, list, 2, "Carla did nothing in this class")
	assert.Equal(t, bruno.ID, list[0].StudentID)
	assert.Equal(t, 61, list[0].Points, "35 + 26")
	assert.Equal(t, 2, list[0].Rounds)
	assert.Equal(t, e.student.ID, list[1].StudentID)
	assert.Equal(t, 54, list[1].Points, "40 + 14, and not the 44 of the other class")
	assert.Equal(t, 2, list[1].Rounds)

	theirs, err := e.repo.ExercisePointsByStudent(e.ctx, other.ID)
	require.NoError(t, err)
	require.Len(t, theirs, 2)
	assert.Equal(t, 44, theirs[0].Points)

	empty, err := e.repo.ExercisePointsByStudent(e.ctx, uuid.New())
	require.NoError(t, err)
	assert.Empty(t, empty)
}

// Covers SPEC-065 section 3.2 and CA-17: the database holds the rules of the two tables: the time from 60 to 3600 seconds, the level, the reason
// to end, a moment and a reason that come together, no result shown while the round runs, points that are not negative, at least one attempt,
// and the room, the student and the round exist.
func TestExercise_TheDatabaseHoldsTheRules(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	insertRun := func(mutate func(r *domain.LiveExerciseRun)) error {
		other := e.newClass(t, "X"+strings.ReplaceAll(uuid.NewString()[:6], "-", ""))
		room := e.session(other.ID, e.now)
		require.NoError(t, e.repo.CreateSession(e.ctx, &room))
		run := domain.StartExerciseRun(room.ID, uuid.New(), 0, "x", domain.DifficultyEasy, 5, e.now)
		mutate(&run)
		return e.db.Conn(e.ctx).Create(&run).Error
	}
	set := func(seconds int) func(*domain.LiveExerciseRun) {
		return func(r *domain.LiveExerciseRun) { r.DurationSeconds = seconds }
	}
	assert.NoError(t, insertRun(set(60)), "one minute")
	assert.NoError(t, insertRun(set(3600)), "one hour")
	assert.Error(t, insertRun(set(59)))
	assert.Error(t, insertRun(set(3601)))
	assert.Error(t, insertRun(set(0)))
	assert.Error(t, insertRun(func(r *domain.LiveExerciseRun) { r.Difficulty = "EXPERT" }))
	assert.Error(t, insertRun(func(r *domain.LiveExerciseRun) { r.Difficulty = "" }))
	assert.Error(t, insertRun(func(r *domain.LiveExerciseRun) { r.ExerciseIndex = -1 }))
	assert.Error(t, insertRun(func(r *domain.LiveExerciseRun) { r.Title = "" }), "a title is kept")
	assert.Error(t, insertRun(func(r *domain.LiveExerciseRun) { r.SessionID = uuid.New() }), "the room exists")

	ended := func(by *string, at *time.Time) func(*domain.LiveExerciseRun) {
		return func(r *domain.LiveExerciseRun) { r.EndedBy, r.EndedAt = by, at }
	}
	at, timer, teacher, session, nobody := e.now.Add(time.Minute), domain.EndedByTimer, domain.EndedByTeacher, domain.EndedBySession, "NOBODY"
	assert.NoError(t, insertRun(ended(&timer, &at)))
	assert.NoError(t, insertRun(ended(&teacher, &at)))
	assert.NoError(t, insertRun(ended(&session, &at)))
	assert.Error(t, insertRun(ended(&nobody, &at)), "the reason is one of the three")
	assert.Error(t, insertRun(ended(nil, &at)), "a moment with no reason")
	assert.Error(t, insertRun(ended(&timer, nil)), "a reason with no moment")
	assert.Error(t, insertRun(func(r *domain.LiveExerciseRun) { r.ResultVisible = true }), "no result is shown while the round runs")
	assert.NoError(t, insertRun(func(r *domain.LiveExerciseRun) { r.EndedBy, r.EndedAt, r.ResultVisible = &timer, &at, true }), "an ended round may show it")

	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	save := func(runID, student uuid.UUID, elapsed, points, attempts int) error {
		r := domain.LiveExerciseResult{RunID: runID, StudentID: student, CompletedAt: e.now, ElapsedSeconds: elapsed, Points: points, Attempts: attempts}
		return e.db.Conn(e.ctx).Create(&r).Error
	}
	bruno := e.newStudent(t, "1000002", "Bruno")
	assert.NoError(t, save(run.ID, e.student.ID, 0, 0, 1), "zero seconds, zero points, one attempt")
	assert.Error(t, save(run.ID, bruno.ID, -1, 10, 1), "elapsed time is not negative")
	assert.Error(t, save(run.ID, bruno.ID, 10, -1, 1), "points are not negative")
	assert.Error(t, save(run.ID, bruno.ID, 10, 10, 0), "at least one attempt")
	assert.Error(t, save(uuid.New(), bruno.ID, 10, 10, 1), "the round exists")
	assert.Error(t, save(run.ID, uuid.New(), 10, 10, 1), "the student exists")
	assert.Error(t, save(run.ID, e.student.ID, 10, 10, 1), "one result per student and round")
	assert.NoError(t, save(run.ID, bruno.ID, 10, 10, 1))
}

func exerciseTables(t *testing.T, e env) (columns map[string][]string, indexes map[string][]string) {
	t.Helper()
	columns, indexes = map[string][]string{}, map[string][]string{}
	for _, table := range []string{"live_exercise_runs", "live_exercise_results"} {
		var cols, idx []string
		require.NoError(t, e.db.Conn(e.ctx).Raw(
			"SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY column_name", table).
			Scan(&cols).Error)
		require.NoError(t, e.db.Conn(e.ctx).Raw(
			"SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?", table).Scan(&idx).Error)
		columns[table], indexes[table] = cols, idx
	}
	return columns, indexes
}

// Covers SPEC-065 CA-17 and section 3.2: the migration 00035 creates the two tables, with the unique partial index of the round that runs and
// the unique one of the result of a student; going down takes both away and leaves the rest of the classroom; going up again brings them back,
// ready to use.
func TestMigration00035_CreatesTheTablesAndTakesThemBack(t *testing.T) {
	e := newEnv(t) // every migration was applied by the helper
	up, down := migrationParts(t, "00035_")

	columns, indexes := exerciseTables(t, e)
	assert.ElementsMatch(t, []string{"block_id", "created_at", "deleted_at", "difficulty", "duration_seconds", "ended_at", "ended_by", "ends_at", "exercise_index", "id",
		"result_visible", "session_id", "started_at", "title", "updated_at"}, columns["live_exercise_runs"])
	assert.ElementsMatch(t, []string{"attempts", "completed_at", "created_at", "deleted_at", "elapsed_seconds", "id", "points", "run_id", "student_id", "updated_at"},
		columns["live_exercise_results"])
	hasIndex := func(table, part string) bool {
		for _, def := range indexes[table] {
			if strings.Contains(def, "UNIQUE") && strings.Contains(def, part) {
				return true
			}
		}
		return false
	}
	assert.True(t, hasIndex("live_exercise_runs", "(session_id)") && hasIndex("live_exercise_runs", "ended_at IS NULL"), "a unique partial index on the round that runs: %v", indexes)
	assert.True(t, hasIndex("live_exercise_results", "(run_id, student_id)"), "a unique index on the run and the student: %v", indexes)

	s := e.openRoom(t)
	run := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	e.result(t, run, e.student.ID, 10, 14, 1)

	runMigration(t, e, down)
	columns, _ = exerciseTables(t, e)
	assert.Empty(t, columns["live_exercise_runs"], "the Down took the rounds away")
	assert.Empty(t, columns["live_exercise_results"], "and the results")
	found, err := e.repo.FindSession(e.ctx, s.ID)
	require.NoError(t, err, "and left the room")
	assert.Equal(t, s.ID, found.ID)
	_, err = e.repo.ListChatMessages(e.ctx, s.ID, nil, 10)
	assert.NoError(t, err, "and the rest of the classroom")

	runMigration(t, e, up)
	columns, _ = exerciseTables(t, e)
	assert.Len(t, columns["live_exercise_runs"], 15)
	assert.Len(t, columns["live_exercise_results"], 10)
	_, err = e.repo.CurrentExerciseRun(e.ctx, s.ID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "the tables come back empty")
	again := e.startRun(t, s, domain.DifficultyEasy, 5, e.now)
	e.result(t, again, e.student.ID, 10, 14, 1)
}
