package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// ---- SPEC-065: the exercise of the lesson ----

// exerciseStore is what the repository double keeps of the rounds and of the results, in the order they were saved. reads counts the readings
// of the current round, to tell that the progress of the students never goes to the repository.
type exerciseStore struct {
	runs    []domain.LiveExerciseRun
	results []domain.LiveExerciseResult
	reads   int
	failEnd error
}

func (f *fakeRepo) CreateExerciseRun(_ context.Context, run *domain.LiveExerciseRun) error {
	for _, r := range f.exercise.runs {
		if r.SessionID == run.SessionID && r.Running() {
			return domain.ErrExerciseRunning
		}
	}
	if run.ID == uuid.Nil {
		run.ID = uuid.New()
	}
	f.exercise.runs = append(f.exercise.runs, *run)
	return nil
}

func (f *fakeRepo) FindExerciseRun(_ context.Context, id uuid.UUID) (domain.LiveExerciseRun, error) {
	for _, r := range f.exercise.runs {
		if r.ID == id {
			return r, nil
		}
	}
	return domain.LiveExerciseRun{}, domain.ErrNoExerciseRun
}

// CurrentExerciseRun is the reading of the real repository: the round that runs or, with none, the last one that ended.
func (f *fakeRepo) CurrentExerciseRun(_ context.Context, session uuid.UUID) (domain.LiveExerciseRun, error) {
	f.exercise.reads++
	var best *domain.LiveExerciseRun
	for i, r := range f.exercise.runs {
		if r.SessionID != session {
			continue
		}
		if best == nil || (r.Running() && !best.Running()) || (r.Running() == best.Running() && r.StartedAt.After(best.StartedAt)) {
			best = &f.exercise.runs[i]
		}
	}
	if best == nil {
		return domain.LiveExerciseRun{}, domain.ErrNoExerciseRun
	}
	return *best, nil
}

func (f *fakeRepo) EndExerciseRun(_ context.Context, id uuid.UUID, at time.Time, by string) (bool, error) {
	if f.exercise.failEnd != nil {
		return false, f.exercise.failEnd
	}
	for i := range f.exercise.runs {
		if f.exercise.runs[i].ID == id && f.exercise.runs[i].Running() {
			_ = f.exercise.runs[i].End(at, by)
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeRepo) SetExerciseResultVisible(_ context.Context, id uuid.UUID, visible bool) (bool, error) {
	for i := range f.exercise.runs {
		if f.exercise.runs[i].ID == id && !f.exercise.runs[i].Running() {
			f.exercise.runs[i].ResultVisible = visible
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeRepo) SaveExerciseResult(_ context.Context, res *domain.LiveExerciseResult) (domain.LiveExerciseResult, bool, error) {
	for _, r := range f.exercise.results {
		if r.RunID == res.RunID && r.StudentID == res.StudentID {
			return r, false, nil
		}
	}
	if res.ID == uuid.Nil {
		res.ID = uuid.New()
	}
	f.exercise.results = append(f.exercise.results, *res)
	return *res, true, nil
}

func (f *fakeRepo) FindExerciseResult(_ context.Context, run, student uuid.UUID) (domain.LiveExerciseResult, error) {
	for _, r := range f.exercise.results {
		if r.RunID == run && r.StudentID == student {
			return r, nil
		}
	}
	return domain.LiveExerciseResult{}, domain.ErrNoExerciseResult
}

// ListExerciseResults gives the results in the order they were saved, not in the order of the scoreboard: the service orders them.
func (f *fakeRepo) ListExerciseResults(_ context.Context, run uuid.UUID) ([]domain.ExerciseResultEntry, error) {
	var out []domain.ExerciseResultEntry
	for _, r := range f.exercise.results {
		if r.RunID == run {
			out = append(out, domain.ExerciseResultEntry{StudentID: r.StudentID, Name: f.studentNames[r.StudentID], CompletedAt: r.CompletedAt,
				ElapsedSeconds: r.ElapsedSeconds, Points: r.Points, Attempts: r.Attempts})
		}
	}
	return out, nil
}

func (f *fakeRepo) UserNames(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	for _, id := range ids {
		if name, ok := f.studentNames[id]; ok {
			out[id] = name
		}
	}
	return out, nil
}

// exerciseKey says which exercise of which block of which module.
type exerciseKey struct {
	module, block uuid.UUID
	index         int
}

type gradeCall struct {
	exerciseKey
	snapshot string
}

// fakeExercises is the content of the modules for the room: the exercises that have conditions, and the correction, which says "pass" for the
// state `"pass"`, "fail" for `"fail"` and that the state is not a machine for anything else.
type fakeExercises struct {
	specs map[exerciseKey]service.ExerciseSpec
	calls []gradeCall
	reads []exerciseKey
}

func (f *fakeExercises) Exercise(_ context.Context, module, block uuid.UUID, index int) (service.ExerciseSpec, error) {
	key := exerciseKey{module, block, index}
	f.reads = append(f.reads, key)
	spec, ok := f.specs[key]
	if !ok {
		return service.ExerciseSpec{}, domain.ErrExerciseUnavailable
	}
	return spec, nil
}

func (f *fakeExercises) Grade(_ context.Context, module, block uuid.UUID, index int, snapshot json.RawMessage) (bool, error) {
	f.calls = append(f.calls, gradeCall{exerciseKey{module, block, index}, string(snapshot)})
	switch string(snapshot) {
	case `"pass"`:
		return true, nil
	case `"fail"`:
		return false, nil
	}
	return false, domain.ErrInvalidExerciseState
}

// fakeTimers is the timer of the service in the hands of the test: it keeps what was scheduled and fires it when the test says so.
type fakeTimers struct{ timers []*fakeTimer }

type fakeTimer struct {
	d       time.Duration
	f       func()
	stopped bool
}

func (ft *fakeTimers) after(d time.Duration, f func()) func() {
	t := &fakeTimer{d: d, f: f}
	ft.timers = append(ft.timers, t)
	return func() { t.stopped = true }
}

// fire runs the timer as the clock would, unless it was stopped.
func (ft *fakeTimers) fire(i int) {
	if t := ft.timers[i]; !t.stopped {
		t.f()
	}
}

// running are the timers that were not stopped.
func (ft *fakeTimers) running() []*fakeTimer {
	var out []*fakeTimer
	for _, t := range ft.timers {
		if !t.stopped {
			out = append(out, t)
		}
	}
	return out
}

type exerciseEnd struct {
	session uuid.UUID
	state   service.ExerciseState
}

// exWorld is a room open in a module with two exercises (index 0 easy, index 1 hard), with Ana, Bruno and Carla admitted.
type exWorld struct {
	*world
	room                 domain.LiveClassroomSession
	module, block        uuid.UUID
	ana, bruno, carla    service.Actor
	fx                   *fakeExercises
	timers               *fakeTimers
	events               []exerciseEnd
	failures             []error
	order                []string
	started              time.Time
	easyIndex, hardIndex int
}

func exerciseRoom(t *testing.T) *exWorld {
	t.Helper()
	w := setup(t)
	x := &exWorld{world: w, module: uuid.New(), block: uuid.New(), fx: &fakeExercises{specs: map[exerciseKey]service.ExerciseSpec{}}, timers: &fakeTimers{},
		ana: w.student, easyIndex: 0, hardIndex: 1}
	w.repo.modules[x.module] = true
	room, _, err := w.svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "Aula", InitialModuleID: &x.module})
	require.NoError(t, err)
	x.room = room
	x.bruno, x.carla = w.newStudent("Bruno"), w.newStudent("Carla")
	w.admit(room.ID, x.ana.UserID, x.bruno.UserID, x.carla.UserID)
	x.fx.specs[exerciseKey{x.module, x.block, x.easyIndex}] = service.ExerciseSpec{Title: "Listar a pasta", Difficulty: domain.DifficultyEasy}
	x.fx.specs[exerciseKey{x.module, x.block, x.hardIndex}] = service.ExerciseSpec{Title: "Criar a pasta", Difficulty: domain.DifficultyHard}
	w.svc.WithExercises(x.fx).WithExerciseTimer(x.timers.after).
		WithExerciseEvents(func(session uuid.UUID, st service.ExerciseState) {
			x.events = append(x.events, exerciseEnd{session, st})
			x.order = append(x.order, "exercise")
		}, func(_ uuid.UUID, err error) { x.failures = append(x.failures, err) })
	w.svc.WithOnEnded(func(uuid.UUID) { x.order = append(x.order, "room") })
	x.started = w.now
	return x
}

func (x *exWorld) everybody() []uuid.UUID {
	return []uuid.UUID{x.ana.UserID, x.bruno.UserID, x.carla.UserID}
}

// startRound starts the exercise of the index for the minutes (nil is the default), with the three students online.
func (x *exWorld) startRound(t *testing.T, index int, minutes *int) service.ExerciseState {
	t.Helper()
	x.started = x.now
	st, err := x.svc.StartExercise(context.Background(), x.teacher, x.room.ID, service.ExerciseStartInput{BlockID: x.block, Index: index, Minutes: minutes, Online: x.everybody()})
	require.NoError(t, err)
	return st
}

func (x *exWorld) submit(who service.Actor, run uuid.UUID, snapshot string) (service.ExerciseSubmitResult, error) {
	return x.svc.SubmitExercise(context.Background(), who, x.class, service.ExerciseSubmitInput{RunID: run, Snapshot: json.RawMessage(snapshot)})
}

func (x *exWorld) mustSubmit(t *testing.T, who service.Actor, run uuid.UUID, snapshot string) service.ExerciseSubmitResult {
	t.Helper()
	res, err := x.submit(who, run, snapshot)
	require.NoError(t, err)
	return res
}

func minutes(n int) *int { return &n }

// Covers SPEC-065 CA-01 and section 3.1 (live:exercise:start): the teacher starts the exercise of a block of the module of the lesson; the round
// gets the title and the level of the exercise, the time (5 minutes when he does not say) from the moment of the server, and a timer that ends it
// at its end; the students who were online are in it.
func TestStartExercise_CreatesTheRound(t *testing.T) {
	x := exerciseRoom(t)
	st, err := x.svc.StartExercise(context.Background(), x.teacher, x.room.ID, service.ExerciseStartInput{BlockID: x.block, Index: x.hardIndex,
		Online: []uuid.UUID{x.ana.UserID, x.bruno.UserID, x.ana.UserID}})
	require.NoError(t, err)

	run := st.Run
	assert.NotEqual(t, uuid.Nil, run.ID)
	assert.Equal(t, x.room.ID, run.SessionID)
	assert.Equal(t, x.block, run.BlockID)
	assert.Equal(t, x.hardIndex, run.ExerciseIndex)
	assert.Equal(t, "Criar a pasta", run.Title)
	assert.Equal(t, domain.DifficultyHard, run.Difficulty)
	assert.Equal(t, 300, run.DurationSeconds, "5 minutes by default")
	assert.Equal(t, x.now, run.StartedAt)
	assert.Equal(t, x.now.Add(5*time.Minute), run.EndsAt)
	assert.True(t, run.Running())
	assert.False(t, run.ResultVisible)
	assert.Equal(t, x.now, st.Now, "the hour of the server, for the clients to correct their clocks")
	assert.Equal(t, 2, st.Participants, "who was online is in the round, once each")
	assert.Equal(t, []domain.LiveExerciseRun{run}, x.repo.exercise.runs, "what was returned is what was kept")
	assert.Equal(t, []exerciseKey{{x.module, x.block, x.hardIndex}}, x.fx.reads, "the exercise is read from the module of the lesson")
	require.Len(t, x.timers.running(), 1, "a timer for the end")
	assert.Equal(t, 5*time.Minute, x.timers.timers[0].d)
	assert.Empty(t, x.events, "the teacher who started it is answered, nobody else is told by the service")
}

// Covers SPEC-065 CA-01: the minutes the teacher chooses, from 1 to 60, are the time of the round and of its timer.
func TestStartExercise_ChosenMinutes(t *testing.T) {
	for _, n := range []int{1, 2, 60} {
		x := exerciseRoom(t)
		st := x.startRound(t, x.easyIndex, minutes(n))
		assert.Equal(t, n*60, st.Run.DurationSeconds, "%d minutes", n)
		assert.Equal(t, x.now.Add(time.Duration(n)*time.Minute), st.Run.EndsAt)
		assert.Equal(t, time.Duration(n)*time.Minute, x.timers.timers[0].d)
	}
}

// Covers SPEC-065 CA-01 and section 3.1: the start is refused, and nothing is kept or scheduled, for who is not the teacher of the class, with no
// module in the lesson, with a minutes that is not from 1 to 60, with a block that is not of the module or an exercise that does not exist or
// has no condition, with a round already running, and in a room that does not exist or ended.
func TestStartExercise_Refusals(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	start := func(who service.Actor, session uuid.UUID, in service.ExerciseStartInput) error {
		_, err := x.svc.StartExercise(ctx, who, session, in)
		return err
	}
	ok := service.ExerciseStartInput{BlockID: x.block, Index: x.easyIndex}
	nothing := func(msg string) {
		assert.Empty(t, x.repo.exercise.runs, msg)
		assert.Empty(t, x.timers.timers, msg)
	}

	for name, who := range map[string]service.Actor{"a student": x.ana, "another teacher": x.other} {
		assert.ErrorIs(t, start(who, x.room.ID, ok), domain.ErrForbidden, name)
	}
	nothing("who is not the teacher of the class")

	for _, n := range []int{0, -5, 61, 1000} {
		in := ok
		in.Minutes = minutes(n)
		assert.ErrorIs(t, start(x.teacher, x.room.ID, in), domain.ErrInvalidExerciseMinutes, "%d minutes", n)
	}
	nothing("minutes out of 1 to 60")

	otherBlock := ok
	otherBlock.BlockID = uuid.New()
	assert.ErrorIs(t, start(x.teacher, x.room.ID, otherBlock), domain.ErrExerciseUnavailable, "a block that is not of the module, or not of the type EXERCISES")
	missing := ok
	missing.Index = 7
	assert.ErrorIs(t, start(x.teacher, x.room.ID, missing), domain.ErrExerciseUnavailable, "an index that does not exist")
	negative := ok
	negative.Index = -1
	assert.ErrorIs(t, start(x.teacher, x.room.ID, negative), domain.ErrExerciseUnavailable, "a negative index")
	nothing("an exercise that is not there")

	x.fx.specs[exerciseKey{x.module, x.block, 3}] = service.ExerciseSpec{Title: "Sem nível", Difficulty: "EXPERT"}
	x.fx.specs[exerciseKey{x.module, x.block, 4}] = service.ExerciseSpec{Title: "  ", Difficulty: domain.DifficultyEasy}
	for _, index := range []int{3, 4} {
		in := ok
		in.Index = index
		assert.ErrorIs(t, start(x.teacher, x.room.ID, in), domain.ErrExerciseUnavailable, "a level or a title that is not valid: %d", index)
	}
	nothing("what the module gave was not valid")

	assert.ErrorIs(t, start(x.teacher, uuid.New(), ok), domain.ErrSessionNotFound, "a room that does not exist")
	nothing("a room that does not exist")

	st := x.startRound(t, x.easyIndex, nil)
	assert.ErrorIs(t, start(x.teacher, x.room.ID, service.ExerciseStartInput{BlockID: x.block, Index: x.hardIndex}), domain.ErrExerciseRunning)
	assert.Equal(t, []domain.LiveExerciseRun{st.Run}, x.repo.exercise.runs, "the round that runs stays alone")
	assert.Len(t, x.timers.timers, 1)

	_, err := x.svc.EndSession(ctx, x.teacher, x.class, x.room.ID)
	require.NoError(t, err)
	assert.ErrorIs(t, start(x.teacher, x.room.ID, ok), domain.ErrSessionNotFound, "a room that ended")
}

// Covers SPEC-065 CA-01: a room with no module chosen takes no round, and a service with no reader of the modules cannot start or grade one.
func TestStartExercise_NeedsAModuleAndTheContent(t *testing.T) {
	ctx := context.Background()
	w := setup(t)
	room := w.start(t) // no module
	w.svc.WithExercises(&fakeExercises{specs: map[exerciseKey]service.ExerciseSpec{}})
	_, err := w.svc.StartExercise(ctx, w.teacher, room.ID, service.ExerciseStartInput{BlockID: uuid.New()})
	assert.ErrorIs(t, err, domain.ErrModuleNotSelected)

	x := exerciseRoom(t)
	bare := service.New(x.repo, x.store, func() time.Time { return x.now })
	_, err = bare.StartExercise(ctx, x.teacher, x.room.ID, service.ExerciseStartInput{BlockID: x.block, Index: x.easyIndex})
	assert.ErrorIs(t, err, domain.ErrExerciseUnavailable, "no reader of the exercises of the modules")
	assert.Empty(t, x.repo.exercise.runs)
}

// Covers SPEC-065 CA-01: after the round ended, the teacher starts the next one; the students and the progress of the first do not carry over.
func TestStartExercise_NextRoundStartsClean(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	first := x.startRound(t, x.easyIndex, nil)
	_, err := x.svc.RecordExerciseProgress(ctx, x.room.ID, x.ana.UserID, service.ExerciseProgressInput{RunID: first.Run.ID, Met: 1, Total: 2, Last: "ls"})
	require.NoError(t, err)
	x.mustSubmit(t, x.bruno, first.Run.ID, `"fail"`)
	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)

	x.now = x.now.Add(time.Minute)
	second, err := x.svc.StartExercise(ctx, x.teacher, x.room.ID, service.ExerciseStartInput{BlockID: x.block, Index: x.hardIndex, Online: []uuid.UUID{x.carla.UserID}})
	require.NoError(t, err)
	assert.NotEqual(t, first.Run.ID, second.Run.ID)
	assert.Equal(t, 1, second.Participants, "only who is online now")
	got, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Len(t, got.Entries, 1)
	assert.Equal(t, x.carla.UserID, got.Entries[0].StudentID)
	assert.Zero(t, got.Entries[0].Met, "the progress of the first round is gone")
	res := x.mustSubmit(t, x.bruno, second.Run.ID, `"pass"`)
	assert.Equal(t, 1, res.Result.Attempts, "the attempts of the first round are not counted in the second")
}

// Covers SPEC-065 CA-03 and section 3.1 (live:exercise:end): the teacher ends the round that runs; it is saved as ended by the teacher, at the
// moment of the server, the timer is stopped, and the student who was being watched is told by the answer. With no round, with one that ended
// and for who is not the teacher, it is refused.
func TestEndExercise_ByTheTeacher(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	_, err := x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "no round yet")

	started := x.startRound(t, x.easyIndex, nil)
	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.ana.UserID)
	require.NoError(t, err)

	_, err = x.svc.EndExercise(ctx, x.ana, x.room.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a student does not end it")
	assert.True(t, x.repo.exercise.runs[0].Running())

	x.now = x.now.Add(90 * time.Second)
	st, err := x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	assert.Equal(t, started.Run.ID, st.Run.ID)
	require.NotNil(t, st.Run.EndedBy)
	assert.Equal(t, domain.EndedByTeacher, *st.Run.EndedBy)
	require.NotNil(t, st.Run.EndedAt)
	assert.Equal(t, x.now, *st.Run.EndedAt)
	assert.Equal(t, x.now, st.Now)
	require.NotNil(t, st.Unwatched, "the observation ends with the round")
	assert.Equal(t, x.ana.UserID, *st.Unwatched)
	assert.Equal(t, st.Run, x.repo.exercise.runs[0], "what was returned is what was kept")
	assert.Empty(t, x.timers.running(), "the timer was stopped")
	assert.Empty(t, x.events, "the teacher who ended it is answered; the service tells nobody by itself")

	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "a round that ended cannot be ended again")
	assert.Equal(t, domain.EndedByTeacher, *x.repo.exercise.runs[0].EndedBy)
}

// Covers SPEC-065 CA-03 and section 3.1 (Fim da rodada): at its end the server ends the round by itself, by the timer, at the moment of its end
// and not at the moment it noticed, and tells the room (the hook) with the student that was being watched; a second call of the timer, or the
// call of a timer for a round that the teacher already ended, does nothing.
func TestExercise_EndsByTheTimer(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, minutes(2))
	_, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.bruno.UserID)
	require.NoError(t, err)

	x.now = x.now.Add(2*time.Minute + 300*time.Millisecond) // the timer is a little late
	x.timers.fire(0)

	run := x.repo.exercise.runs[0]
	assert.False(t, run.Running())
	assert.Equal(t, domain.EndedByTimer, *run.EndedBy)
	assert.Equal(t, st.Run.EndsAt, *run.EndedAt, "it ended when the time was up")
	require.Len(t, x.events, 1)
	assert.Equal(t, x.room.ID, x.events[0].session)
	assert.Equal(t, run, x.events[0].state.Run)
	assert.Equal(t, x.now, x.events[0].state.Now)
	require.NotNil(t, x.events[0].state.Unwatched)
	assert.Equal(t, x.bruno.UserID, *x.events[0].state.Unwatched)
	assert.Empty(t, x.failures)

	x.timers.timers[0].f() // a second call, as if the timer had fired twice
	assert.Len(t, x.events, 1, "nobody is told twice")

	// the teacher ended a round first: the call of its timer finds the round ended
	y := exerciseRoom(t)
	y.startRound(t, y.easyIndex, nil)
	_, err = y.svc.EndExercise(ctx, y.teacher, y.room.ID)
	require.NoError(t, err)
	y.timers.timers[0].f()
	assert.Equal(t, domain.EndedByTeacher, *y.repo.exercise.runs[0].EndedBy, "the first end stays")
	assert.Empty(t, y.events)
}

// Covers SPEC-065 CA-03: when the timer cannot end the round, the failure is told, and the round is found over and ended on the next reading.
func TestExercise_TimerFailureIsTold(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, minutes(1))
	x.repo.exercise.failEnd = errors.New("database is down")
	x.now = x.now.Add(time.Minute)
	x.timers.fire(0)
	require.Len(t, x.failures, 1)
	assert.ErrorContains(t, x.failures[0], "database is down")
	assert.Empty(t, x.events)
	assert.True(t, x.repo.exercise.runs[0].Running())

	x.repo.exercise.failEnd = nil
	got, err := x.svc.ExerciseOf(ctx, x.room.ID, false)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.False(t, got.Run.Running(), "found over, it is ended by the reading")
	assert.Equal(t, domain.EndedByTimer, *got.Run.EndedBy)
	assert.Equal(t, got.Run.EndsAt, *got.Run.EndedAt)
	assert.Len(t, x.events, 1, "and the room is told")
}

// Covers SPEC-065 CA-03 and section 3.1 (Fim da rodada): a server that comes back finds the round where it was: one that is over is ended by the
// reading, as ended by the timer at its end, and the room is told; one that still has time gets a new timer for what is left.
func TestExercise_RestartFindsTheRound(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, minutes(5))

	restarted := func() (*service.Service, *fakeTimers, *[]exerciseEnd) {
		timers, events := &fakeTimers{}, &[]exerciseEnd{}
		svc := service.New(x.repo, x.store, func() time.Time { return x.now }).WithExercises(x.fx).WithExerciseTimer(timers.after).
			WithExerciseEvents(func(session uuid.UUID, state service.ExerciseState) {
				*events = append(*events, exerciseEnd{session, state})
			}, nil)
		return svc, timers, events
	}

	x.now = x.started.Add(2 * time.Minute)
	svc, timers, events := restarted()
	got, err := svc.ExerciseOf(ctx, x.room.ID, false)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.True(t, got.Run.Running())
	require.Len(t, timers.running(), 1, "a timer for the time that is left")
	assert.Equal(t, 3*time.Minute, timers.timers[0].d)
	_, err = svc.ExerciseOf(ctx, x.room.ID, false)
	require.NoError(t, err)
	assert.Len(t, timers.timers, 1, "one timer, however many readings")
	timers.fire(0)
	require.Len(t, *events, 1, "the timer of the restarted server ends it")
	assert.Equal(t, domain.EndedByTimer, *x.repo.exercise.runs[0].EndedBy)

	// the same, but the server was down past the end of the time
	y := exerciseRoom(t)
	st2 := y.startRound(t, y.easyIndex, minutes(1))
	y.now = y.started.Add(10 * time.Minute)
	svc2 := service.New(y.repo, y.store, func() time.Time { return y.now }).WithExercises(y.fx)
	var told []exerciseEnd
	svc2.WithExerciseEvents(func(session uuid.UUID, state service.ExerciseState) { told = append(told, exerciseEnd{session, state}) }, nil)
	late, err := svc2.ExerciseOf(ctx, y.room.ID, false)
	require.NoError(t, err)
	require.NotNil(t, late)
	assert.False(t, late.Run.Running())
	assert.Equal(t, domain.EndedByTimer, *late.Run.EndedBy)
	assert.Equal(t, st2.Run.EndsAt, *late.Run.EndedAt, "ended at the end of its time, not when it was found")
	assert.Equal(t, late.Run, y.repo.exercise.runs[0])
	require.Len(t, told, 1)
	assert.Equal(t, y.room.ID, told[0].session)
	assert.NotEqual(t, st.Run.ID, st2.Run.ID)
}

// Covers SPEC-065 CA-03 and section 3.1 (Fim da rodada): when the lesson ends the round that runs ends with it, by the lesson, before the room is
// closed, with its timer stopped and the room told; the ended rounds and their results stay. The safety net does the same.
func TestExercise_EndsWithTheLesson(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)
	x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	_, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.carla.UserID)
	require.NoError(t, err)

	x.now = x.now.Add(40 * time.Second)
	_, err = x.svc.EndSession(ctx, x.teacher, x.class, x.room.ID)
	require.NoError(t, err)

	run := x.repo.exercise.runs[0]
	assert.False(t, run.Running())
	assert.Equal(t, domain.EndedBySession, *run.EndedBy)
	assert.Equal(t, x.now, *run.EndedAt)
	assert.Equal(t, []string{"exercise", "room"}, x.order, "the room is told that the round ended before it is told that the lesson did")
	require.Len(t, x.events, 1)
	assert.Equal(t, run, x.events[0].state.Run)
	require.NotNil(t, x.events[0].state.Unwatched)
	assert.Equal(t, x.carla.UserID, *x.events[0].state.Unwatched)
	assert.Empty(t, x.timers.running())
	assert.Len(t, x.repo.exercise.results, 1, "the results stay")

	// the safety net: the teacher left the room long ago, while the round was still running
	z := exerciseRoom(t)
	z.startRound(t, z.easyIndex, minutes(60))
	left := z.repo.sessions[z.room.ID]
	left.UpdatedAt = z.now.Add(-domain.SafetyNet - time.Hour)
	z.repo.sessions[z.room.ID] = left
	n, err := z.svc.EndAbandoned(ctx, func(uuid.UUID) bool { return false })
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Equal(t, domain.EndedBySession, *z.repo.exercise.runs[0].EndedBy)
	assert.Equal(t, []string{"exercise", "room"}, z.order)
}

// Covers SPEC-065 CA-03: a lesson that cannot end its round does not end, so that nothing is left running in a closed room.
func TestExercise_LessonDoesNotEndWhenTheRoundCannot(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, nil)
	x.repo.exercise.failEnd = errors.New("database is down")
	_, err := x.svc.EndSession(ctx, x.teacher, x.class, x.room.ID)
	assert.ErrorContains(t, err, "database is down")
	assert.True(t, x.repo.sessions[x.room.ID].IsActive(), "the lesson is still open")
	assert.Empty(t, x.order)
}

// Covers SPEC-065 CA-10 and section 3.1 (live:exercise:reveal): the teacher shows the result only when the round has ended: with it running or
// with no round it is refused; once ended, showing gives the scoreboard, by points and then by time, with the names, hiding hides it, and a
// student cannot do either.
func TestRevealExercise(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	_, err := x.svc.RevealExercise(ctx, x.teacher, x.room.ID, true)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "no round")

	st := x.startRound(t, x.hardIndex, nil)
	_, err = x.svc.RevealExercise(ctx, x.teacher, x.room.ID, true)
	assert.ErrorIs(t, err, domain.ErrExerciseRunning, "the round runs")
	assert.False(t, x.repo.exercise.runs[0].ResultVisible)

	x.now = x.now.Add(60 * time.Second)
	x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`) // 30 + floor(30 × 240 ÷ 600) = 42
	x.now = x.started.Add(100 * time.Second)
	x.mustSubmit(t, x.bruno, st.Run.ID, `"pass"`) // 30 + floor(30 × 200 ÷ 600) = 40
	x.now = x.started.Add(200 * time.Second)
	x.mustSubmit(t, x.carla, st.Run.ID, `"pass"`) // 30 + floor(30 × 100 ÷ 600) = 35
	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)

	_, err = x.svc.RevealExercise(ctx, x.ana, x.room.ID, true)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	assert.False(t, x.repo.exercise.runs[0].ResultVisible)

	shown, err := x.svc.RevealExercise(ctx, x.teacher, x.room.ID, true)
	require.NoError(t, err)
	assert.True(t, shown.Run.ResultVisible)
	assert.True(t, x.repo.exercise.runs[0].ResultVisible, "it was kept")
	require.Len(t, shown.Results, 3)
	got := make([]string, len(shown.Results))
	for i, r := range shown.Results {
		got[i] = r.Name
	}
	assert.Equal(t, []string{"Ana", "Bruno", "Carla"}, got, "by points, from the highest")
	assert.Equal(t, 42, shown.Results[0].Points)
	assert.Equal(t, 60, shown.Results[0].ElapsedSeconds)
	assert.Equal(t, 3, shown.Participants)

	hidden, err := x.svc.RevealExercise(ctx, x.teacher, x.room.ID, false)
	require.NoError(t, err)
	assert.False(t, hidden.Run.ResultVisible)
	assert.False(t, x.repo.exercise.runs[0].ResultVisible)
}

// Covers SPEC-065 CA-07 and section 3.1 (live:exercise:watch): the teacher watches one student of the round at a time: a student that is in the
// round, none or a stranger refused, switching tells which one he stopped watching, null stops, and only the teacher of the class does it, while
// the round runs.
func TestWatchExercise(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	stray := uuid.New()

	w0, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, nil)
	require.NoError(t, err, "stopping when there is nothing to stop is not an error")
	assert.Nil(t, w0.Previous)
	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.ana.UserID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "no round to watch")

	x.startRound(t, x.easyIndex, nil)
	_, err = x.svc.WatchExercise(ctx, x.ana, x.room.ID, &x.bruno.UserID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a student does not watch another")
	_, err = x.svc.WatchExercise(ctx, x.other, x.room.ID, &x.bruno.UserID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &stray)
	assert.ErrorIs(t, err, domain.ErrNotInExerciseRun, "somebody who is not in the round")
	assert.False(t, x.svc.ExerciseScreenAllowed(x.room.ID, stray, x.repo.exercise.runs[0].ID))

	first, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.ana.UserID)
	require.NoError(t, err)
	assert.Nil(t, first.Previous)
	require.NotNil(t, first.Current)
	assert.Equal(t, x.ana.UserID, *first.Current)

	second, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.bruno.UserID)
	require.NoError(t, err)
	require.NotNil(t, second.Previous)
	assert.Equal(t, x.ana.UserID, *second.Previous, "switching: Ana is no longer watched")
	assert.Equal(t, x.bruno.UserID, *second.Current)

	again, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.bruno.UserID)
	require.NoError(t, err)
	assert.Equal(t, x.bruno.UserID, *again.Previous)
	assert.Equal(t, x.bruno.UserID, *again.Current, "the same one again")

	stop, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, nil)
	require.NoError(t, err)
	require.NotNil(t, stop.Previous)
	assert.Equal(t, x.bruno.UserID, *stop.Previous)
	assert.Nil(t, stop.Current)

	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.carla.UserID)
	require.NoError(t, err)
	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.carla.UserID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "the round ended")
	nobody, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, nil)
	require.NoError(t, err)
	assert.Nil(t, nobody.Previous, "the observation ended with the round")
}

// Covers SPEC-065 CA-07: the picture of a terminal is taken only from the student that the teacher watches, in the round that runs.
func TestExerciseScreenAllowed(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)
	run := st.Run.ID
	assert.False(t, x.svc.ExerciseScreenAllowed(x.room.ID, x.ana.UserID, run), "nobody is watched")

	_, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.ana.UserID)
	require.NoError(t, err)
	assert.True(t, x.svc.ExerciseScreenAllowed(x.room.ID, x.ana.UserID, run))
	assert.False(t, x.svc.ExerciseScreenAllowed(x.room.ID, x.bruno.UserID, run), "not the one that is watched")
	assert.False(t, x.svc.ExerciseScreenAllowed(x.room.ID, x.ana.UserID, uuid.New()), "not the round that runs")
	assert.False(t, x.svc.ExerciseScreenAllowed(uuid.New(), x.ana.UserID, run), "not this room")

	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.bruno.UserID)
	require.NoError(t, err)
	assert.False(t, x.svc.ExerciseScreenAllowed(x.room.ID, x.ana.UserID, run), "after the switch, Ana is not watched")
	assert.True(t, x.svc.ExerciseScreenAllowed(x.room.ID, x.bruno.UserID, run))

	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	assert.False(t, x.svc.ExerciseScreenAllowed(x.room.ID, x.bruno.UserID, run), "the observation ended with the round")
}

// Covers SPEC-065 CA-06 and section 3.1 (live:exercise:progress): a student reports how many conditions he met, and the last command; it is kept
// in memory only, for who is in the round, and never reaches the repository however many are sent.
func TestExerciseProgress_KeptInMemory(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, nil)
	reads := x.repo.exercise.reads

	x.now = x.now.Add(10 * time.Second)
	got, err := x.svc.RecordExerciseProgress(ctx, x.room.ID, x.ana.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 2, Total: 4, Last: "mkdir /a"})
	require.NoError(t, err)
	assert.Equal(t, st.Run.ID, got.RunID)
	assert.Equal(t, x.ana.UserID, got.StudentID)
	assert.Equal(t, 2, got.Met)
	assert.Equal(t, 4, got.Total)
	assert.Equal(t, "mkdir /a", got.Last)
	assert.Equal(t, x.now, got.At, "the moment of the server")

	for i := 0; i < 50; i++ {
		x.now = x.now.Add(2 * time.Second)
		_, err = x.svc.RecordExerciseProgress(ctx, x.room.ID, x.bruno.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 1, Total: 4, Last: "ls"})
		require.NoError(t, err)
	}
	assert.Equal(t, reads, x.repo.exercise.reads, "50 reports and not one reading of the repository")
	assert.Empty(t, x.repo.exercise.results, "and nothing was kept")

	panel, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	require.NotNil(t, panel)
	byName := map[string]service.ExerciseEntry{}
	for _, e := range panel.Entries {
		byName[e.Name] = e
	}
	require.Len(t, byName, 3)
	assert.Equal(t, 2, byName["Ana"].Met)
	assert.Equal(t, "mkdir /a", byName["Ana"].Last)
	require.NotNil(t, byName["Ana"].At)
	assert.Equal(t, got.At, *byName["Ana"].At)
	assert.Equal(t, 1, byName["Bruno"].Met)
	assert.Equal(t, "ls", byName["Bruno"].Last)
	assert.Zero(t, byName["Carla"].Met, "no report yet")
	assert.Nil(t, byName["Carla"].At)

	// a new server has none of it
	fresh := service.New(x.repo, x.store, func() time.Time { return x.now }).WithExercises(x.fx).WithExerciseTimer((&fakeTimers{}).after)
	after, err := fresh.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	require.NotNil(t, after)
	assert.Empty(t, after.Entries, "the progress was never kept")
}

// Covers SPEC-065 CA-14 and section 3.1 (live:exercise:progress): a progress that is not valid, of another round, or out of the round that runs
// has no effect: met above total, negative, a total above 100, a last command that is too long or has a control character, a runId that is not
// the one of the round, no round, and a round that ended.
func TestExerciseProgress_Refusals(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	record := func(in service.ExerciseProgressInput) error {
		_, err := x.svc.RecordExerciseProgress(ctx, x.room.ID, x.ana.UserID, in)
		return err
	}
	assert.ErrorIs(t, record(service.ExerciseProgressInput{RunID: uuid.New(), Met: 1, Total: 2}), domain.ErrNoExerciseRun, "no round yet")

	st := x.startRound(t, x.easyIndex, nil)
	id := st.Run.ID
	for _, in := range []service.ExerciseProgressInput{
		{RunID: id, Met: 5, Total: 4}, {RunID: id, Met: -1, Total: 4}, {RunID: id, Met: 0, Total: -1}, {RunID: id, Met: 1, Total: 101},
		{RunID: id, Met: 1, Total: 2, Last: "x\ty"}, {RunID: id, Met: 1, Total: 2, Last: "a\nb"},
	} {
		assert.ErrorIs(t, record(in), domain.ErrInvalidExerciseProgress, "%+v", in)
	}
	long := make([]rune, 201)
	for i := range long {
		long[i] = 'a'
	}
	assert.ErrorIs(t, record(service.ExerciseProgressInput{RunID: id, Met: 1, Total: 2, Last: string(long)}), domain.ErrInvalidExerciseProgress)
	assert.ErrorIs(t, record(service.ExerciseProgressInput{RunID: uuid.New(), Met: 1, Total: 2}), domain.ErrNoExerciseRun, "not the round that runs")
	panel, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	for _, e := range panel.Entries {
		assert.Zero(t, e.Met, "none of them was kept")
	}

	assert.NoError(t, record(service.ExerciseProgressInput{RunID: id, Met: 4, Total: 4, Last: string(long[:200])}), "200 characters, the most")
	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	assert.ErrorIs(t, record(service.ExerciseProgressInput{RunID: id, Met: 1, Total: 2}), domain.ErrExerciseEnded, "the round ended")
}

// Covers SPEC-065 CA-03: a progress that comes when the time is up, before the timer fired, ends the round and is refused.
func TestExerciseProgress_TimeIsUp(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, minutes(1))
	x.now = x.now.Add(time.Minute)
	_, err := x.svc.RecordExerciseProgress(ctx, x.room.ID, x.ana.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 1, Total: 2})
	assert.ErrorIs(t, err, domain.ErrExerciseEnded)
	assert.Equal(t, domain.EndedByTimer, *x.repo.exercise.runs[0].EndedBy)
	assert.Len(t, x.events, 1, "and the room is told")
}

// Covers SPEC-065 CA-04, CA-05, CA-11 and section 3.1 (Conferência): a student whose state meets the conditions concludes: the result is kept
// once, with the time in seconds, the points of the moment (the base of the level plus the bonus of speed) and the attempts; the condition is
// read from the module of the lesson, with the block and the exercise of the round, and never from what the client says.
func TestSubmitExercise_ApprovedKeepsTheResultOnce(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, nil)

	x.now = x.started.Add(95 * time.Second)
	res := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.True(t, res.Passed)
	assert.True(t, res.Created)
	require.NotNil(t, res.Result)
	assert.Equal(t, st.Run.ID, res.Result.RunID)
	assert.Equal(t, x.ana.UserID, res.Result.StudentID)
	assert.Equal(t, x.now, res.Result.CompletedAt)
	assert.Equal(t, 95, res.Result.ElapsedSeconds)
	assert.Equal(t, 40, res.Result.Points, "30 + floor(30 × 205 ÷ 600)")
	assert.Equal(t, 1, res.Result.Attempts)
	assert.Equal(t, "Ana", res.Name)
	assert.Equal(t, st.Run.ID, res.Run.ID)
	assert.Equal(t, []domain.LiveExerciseResult{*res.Result}, x.repo.exercise.results, "what was returned is what was kept")

	require.Len(t, x.fx.calls, 1)
	assert.Equal(t, gradeCall{exerciseKey{x.module, x.block, x.hardIndex}, `"pass"`}, x.fx.calls[0], "graded with the exercise of the round, in the module of the lesson")
}

// Covers SPEC-065 CA-05: the points at the first instant, in the middle, at the end of the time and in the 2 seconds that follow it, for each level.
func TestSubmitExercise_PointsAtTheExtremes(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, nil) // 5 minutes, hard: 30

	first := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`) // the very instant
	assert.Equal(t, 45, first.Result.Points)
	assert.Equal(t, 0, first.Result.ElapsedSeconds)

	x.now = x.started.Add(150 * time.Second)
	middle := x.mustSubmit(t, x.bruno, st.Run.ID, `"pass"`)
	assert.Equal(t, 37, middle.Result.Points)

	x.now = x.started.Add(5 * time.Minute)
	x.timers.fire(0)
	require.Len(t, x.events, 1)
	x.now = x.started.Add(5*time.Minute + time.Second) // one second after the end, a submission in transit
	last := x.mustSubmit(t, x.carla, st.Run.ID, `"pass"`)
	assert.Equal(t, 30, last.Result.Points, "after the time, the base")
	assert.Equal(t, 301, last.Result.ElapsedSeconds)

	// an easy exercise of the same time: 10 to 15
	y := exerciseRoom(t)
	easy := y.startRound(t, y.easyIndex, nil)
	assert.Equal(t, 15, y.mustSubmit(t, y.ana, easy.Run.ID, `"pass"`).Result.Points)
}

// Covers SPEC-065 CA-04: the state that does not meet the conditions is answered as not passed and keeps no result; every send counts as an
// attempt, and the attempts that came before are in the result of the one that passed.
func TestSubmitExercise_FailedAttemptsAreCounted(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)

	for i := 0; i < 2; i++ {
		x.now = x.now.Add(5 * time.Second)
		res := x.mustSubmit(t, x.ana, st.Run.ID, `"fail"`)
		assert.False(t, res.Passed)
		assert.False(t, res.Created)
		assert.Nil(t, res.Result)
	}
	assert.Empty(t, x.repo.exercise.results, "a failure keeps nothing")

	x.now = x.now.Add(5 * time.Second)
	res := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.True(t, res.Passed)
	assert.Equal(t, 3, res.Result.Attempts, "two that failed and the one that passed")

	other := x.mustSubmit(t, x.bruno, st.Run.ID, `"pass"`)
	assert.Equal(t, 1, other.Result.Attempts, "the attempts are each student's own")
}

// Covers SPEC-065 CA-04 and section 3.1 (Conferência): a student who sends again after he concluded gets the same result, whatever the state he
// sends, and nothing changes: not the points, not the time, not the attempts, and the correction does not even run again.
func TestSubmitExercise_RepeatedIsTheSameResult(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, nil)
	x.now = x.started.Add(95 * time.Second)
	first := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	graded := len(x.fx.calls)

	x.now = x.started.Add(200 * time.Second)
	for _, snapshot := range []string{`"pass"`, `"fail"`, `"garbage"`} {
		again := x.mustSubmit(t, x.ana, st.Run.ID, snapshot)
		assert.True(t, again.Passed, snapshot)
		assert.False(t, again.Created, "nothing was created: nobody is told again")
		require.NotNil(t, again.Result)
		assert.Equal(t, *first.Result, *again.Result, snapshot)
	}
	assert.Len(t, x.repo.exercise.results, 1)
	assert.Len(t, x.fx.calls, graded, "he already concluded: it is not graded again")
}

// Covers SPEC-065 CA-04 and section 3.1 (Erros): the state that is not a machine of the simulator is refused and is not an attempt.
func TestSubmitExercise_InvalidStateIsNotAnAttempt(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)
	_, err := x.submit(x.ana, st.Run.ID, `"garbage"`)
	assert.ErrorIs(t, err, domain.ErrInvalidExerciseState)
	assert.Empty(t, x.repo.exercise.results)
	res := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.Equal(t, 1, res.Result.Attempts, "the refused state was not counted")
}

// Covers SPEC-065 CA-03, CA-04 and section 3.1 (Conferência): while the round runs the answer is taken; after it ended by the timer it is taken
// for 2 seconds more (a submission in transit), with the base points, and not after; the same after the teacher ended it.
func TestSubmitExercise_ToleranceAfterTheEnd(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, minutes(2))
	end := x.started.Add(2 * time.Minute)
	x.now = end
	x.timers.fire(0)

	x.now = end.Add(2 * time.Second)
	last := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.Equal(t, 30, last.Result.Points, "the last instant of the grace: the base")
	assert.True(t, last.Result.CompletedAt.Equal(end.Add(2*time.Second)))

	x.now = end.Add(2*time.Second + time.Millisecond)
	_, err := x.submit(x.bruno, st.Run.ID, `"pass"`)
	assert.ErrorIs(t, err, domain.ErrExerciseEnded)
	x.now = end.Add(time.Hour)
	_, err = x.submit(x.carla, st.Run.ID, `"pass"`)
	assert.ErrorIs(t, err, domain.ErrExerciseEnded)
	assert.Len(t, x.repo.exercise.results, 1, "the ones after the grace kept nothing")

	// the teacher ended it early: the 2 seconds count from that moment
	y := exerciseRoom(t)
	run := y.startRound(t, y.easyIndex, nil)
	y.now = y.started.Add(time.Minute)
	_, err = y.svc.EndExercise(context.Background(), y.teacher, y.room.ID)
	require.NoError(t, err)
	y.now = y.started.Add(time.Minute + 1500*time.Millisecond)
	assert.True(t, y.mustSubmit(t, y.ana, run.Run.ID, `"pass"`).Passed)
	y.now = y.started.Add(time.Minute + 2100*time.Millisecond)
	_, err = y.submit(y.bruno, run.Run.ID, `"pass"`)
	assert.ErrorIs(t, err, domain.ErrExerciseEnded)
}

// Covers SPEC-065 CA-03: a state that arrives when the time is up and the timer has not fired is not lost: the round is ended by the timer at its
// end, and the submission is taken within the 2 seconds.
func TestSubmitExercise_TimeIsUpBeforeTheTimer(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, minutes(1))
	x.now = x.started.Add(time.Minute + time.Second)
	res := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.Equal(t, 10, res.Result.Points)
	assert.Equal(t, domain.EndedByTimer, *x.repo.exercise.runs[0].EndedBy)
	assert.Len(t, x.events, 1, "the room is told that the round ended")

	x.now = x.started.Add(time.Minute + 5*time.Second)
	_, err := x.submit(x.bruno, st.Run.ID, `"pass"`)
	assert.ErrorIs(t, err, domain.ErrExerciseEnded)
}

// Covers SPEC-065 CA-04, CA-14 and section 3.1 (Conferência): who may send the state: only a student that was admitted to the room of the class;
// a student who waits, who was removed, who is of no class of the room, the teacher, a round that is not the one of the room and a class with no
// lesson open are refused, and nothing is graded or kept.
func TestSubmitExercise_WhoMaySend(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)

	waiting := x.newStudent("Dora")
	_, err := x.svc.Connect(ctx, waiting, x.class)
	require.NoError(t, err)
	removed := x.newStudent("Eva")
	x.admit(x.room.ID, removed.UserID)
	_, err = x.svc.Remove(ctx, x.teacher, x.room.ID, removed.UserID)
	require.NoError(t, err)

	for name, who := range map[string]service.Actor{"waiting": waiting, "removed": removed} {
		_, err := x.submit(who, st.Run.ID, `"pass"`)
		assert.ErrorIs(t, err, domain.ErrNotAdmitted, name)
	}
	for name, who := range map[string]service.Actor{"outside the class": x.outside, "the teacher": x.teacher, "another teacher": x.other, "an admin": x.admin} {
		_, err := x.submit(who, st.Run.ID, `"pass"`)
		assert.ErrorIs(t, err, domain.ErrForbidden, name)
	}
	_, err = x.submit(x.ana, uuid.New(), `"pass"`)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "a round that is not the one of the room")
	assert.Empty(t, x.fx.calls, "nothing was graded")
	assert.Empty(t, x.repo.exercise.results, "and nothing was kept")

	_, err = x.svc.EndSession(ctx, x.teacher, x.class, x.room.ID)
	require.NoError(t, err)
	_, err = x.submit(x.ana, st.Run.ID, `"pass"`)
	assert.ErrorIs(t, err, domain.ErrNoActiveSession, "the lesson ended")
}

// Covers SPEC-065 CA-04: a round that is not the current one cannot be answered: the older round gets "no round", whatever its id; a room with
// no round has none.
func TestSubmitExercise_OnlyTheCurrentRound(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	_, err := x.submit(x.ana, uuid.New(), `"pass"`)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "no round yet")

	first := x.startRound(t, x.easyIndex, nil)
	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	x.now = x.now.Add(time.Minute)
	second := x.startRound(t, x.hardIndex, nil)
	_, err = x.submit(x.ana, first.Run.ID, `"pass"`)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun, "the first round is not the current one")
	assert.True(t, x.mustSubmit(t, x.ana, second.Run.ID, `"pass"`).Passed)
}

// Covers SPEC-065 CA-04: a service with no reader of the exercises of the modules cannot grade, and passes nobody.
func TestSubmitExercise_NeedsTheReaderOfTheModules(t *testing.T) {
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)
	bare := service.New(x.repo, x.store, func() time.Time { return x.now })
	_, err := bare.SubmitExercise(context.Background(), x.ana, x.class, service.ExerciseSubmitInput{RunID: st.Run.ID, Snapshot: json.RawMessage(`"pass"`)})
	assert.ErrorIs(t, err, domain.ErrExerciseUnavailable)
	assert.Empty(t, x.repo.exercise.results)
}

// Covers SPEC-065 CA-06, CA-12 and section 3.1 (instantâneo): the state of the round for who connects: none without a round; the round that runs,
// with who is in it, each one's progress and result (for the panel), the scoreboard by points and then by time, the same after it ended, and
// the students' reading without the entries of the others.
func TestExerciseOf_State(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	none, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	assert.Nil(t, none, "no round yet")

	st := x.startRound(t, x.hardIndex, nil)
	x.now = x.started.Add(30 * time.Second)
	_, err = x.svc.RecordExerciseProgress(ctx, x.room.ID, x.carla.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 1, Total: 4, Last: "ls"})
	require.NoError(t, err)
	progressAt := x.now
	x.now = x.started.Add(60 * time.Second)
	x.mustSubmit(t, x.ana, st.Run.ID, `"fail"`)
	x.mustSubmit(t, x.bruno, st.Run.ID, `"pass"`) // 42
	x.now = x.started.Add(95 * time.Second)
	x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`) // 40

	state, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	require.NotNil(t, state)
	assert.Equal(t, st.Run.ID, state.Run.ID)
	assert.True(t, state.Run.Running())
	assert.Equal(t, x.now, state.Now)
	assert.Equal(t, 3, state.Participants)
	require.Len(t, state.Results, 2)
	assert.Equal(t, []string{"Bruno", "Ana"}, []string{state.Results[0].Name, state.Results[1].Name}, "by points: 42 then 40")
	require.Len(t, state.Entries, 3)
	entries := map[string]service.ExerciseEntry{}
	for i, e := range state.Entries {
		entries[e.Name] = e
		assert.Equal(t, []string{"Ana", "Bruno", "Carla"}[i], e.Name, "the cards are in the order of the names")
	}
	require.NotNil(t, entries["Ana"].Result)
	assert.Equal(t, 40, entries["Ana"].Result.Points)
	assert.Equal(t, 95, entries["Ana"].Result.ElapsedSeconds)
	assert.Equal(t, 2, entries["Ana"].Attempts, "one that failed and the one that passed")
	assert.Equal(t, 1, entries["Bruno"].Attempts)
	assert.Nil(t, entries["Carla"].Result, "she did not conclude")
	assert.Equal(t, 1, entries["Carla"].Met)
	assert.Equal(t, 4, entries["Carla"].Total)
	assert.Equal(t, "ls", entries["Carla"].Last)
	require.NotNil(t, entries["Carla"].At)
	assert.Equal(t, progressAt, *entries["Carla"].At)

	light, err := x.svc.ExerciseOf(ctx, x.room.ID, false)
	require.NoError(t, err)
	assert.Empty(t, light.Entries, "the students' reading carries no entries")
	assert.Len(t, light.Results, 2)
	assert.Equal(t, 3, light.Participants)

	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	ended, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	require.NotNil(t, ended)
	assert.False(t, ended.Run.Running(), "after it ended, the last round is the one that is told")
	assert.Equal(t, st.Run.ID, ended.Run.ID)
	assert.Len(t, ended.Results, 2)
	assert.False(t, ended.Run.ResultVisible)

	// a server that was restarted keeps what was saved: the results, and not the progress
	fresh := service.New(x.repo, x.store, func() time.Time { return x.now }).WithExercises(x.fx)
	after, err := fresh.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	require.NotNil(t, after)
	assert.Len(t, after.Results, 2)
	assert.Equal(t, 2, after.Participants, "the ones who concluded are in the round, even if the memory of who was online was lost")
	got := make([]string, len(after.Entries))
	for i, e := range after.Entries {
		got[i] = e.Name
	}
	assert.Equal(t, []string{"Ana", "Bruno"}, got)
}

// Covers SPEC-065 CA-12: who joins the room while the round runs is in the round; with no round, or after it ended, nobody joins it.
func TestJoinExercise(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	x.svc.JoinExercise(x.room.ID, x.ana.UserID) // no round: nothing happens

	st, err := x.svc.StartExercise(ctx, x.teacher, x.room.ID, service.ExerciseStartInput{BlockID: x.block, Index: x.easyIndex, Online: []uuid.UUID{x.ana.UserID}})
	require.NoError(t, err)
	x.svc.JoinExercise(x.room.ID, x.bruno.UserID, x.ana.UserID, x.bruno.UserID)
	state, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	assert.Equal(t, 2, state.Participants, "Ana was there, Bruno came in, once each")
	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.bruno.UserID)
	assert.NoError(t, err, "who came in the middle can be watched")

	_, err = x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	x.svc.JoinExercise(x.room.ID, x.carla.UserID)
	state, err = x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	assert.Equal(t, 2, state.Participants, "after the end nobody joins")
	assert.Equal(t, st.Run.ID, state.Run.ID)
}

// Covers SPEC-065 section 6 (troca de módulo): the module of the lesson cannot be changed while a round runs; going to the same module and back
// to the slides are fine, and once the round ended the module may change.
func TestSwitchMode_RefusedWhileARoundRuns(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	other := uuid.New()
	x.repo.modules[other] = true

	require.NoError(t, x.svc.SwitchMode(ctx, x.teacher, x.room.ID, domain.ModeModule, &other), "no round: the module changes")
	require.NoError(t, x.svc.SwitchMode(ctx, x.teacher, x.room.ID, domain.ModeModule, &x.module))

	x.startRound(t, x.easyIndex, nil)
	assert.ErrorIs(t, x.svc.SwitchMode(ctx, x.teacher, x.room.ID, domain.ModeModule, &other), domain.ErrExerciseRunning)
	assert.Equal(t, x.module, *x.repo.sessions[x.room.ID].ActiveModuleID, "the module is the same")
	assert.NoError(t, x.svc.SwitchMode(ctx, x.teacher, x.room.ID, domain.ModeModule, &x.module), "the same module")
	assert.NoError(t, x.svc.SwitchMode(ctx, x.teacher, x.room.ID, domain.ModeSlides, nil), "back to the slides: the module stays")
	assert.Equal(t, x.module, *x.repo.sessions[x.room.ID].ActiveModuleID)

	_, err := x.svc.EndExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	assert.NoError(t, x.svc.SwitchMode(ctx, x.teacher, x.room.ID, domain.ModeModule, &other), "the round ended")
}

// Covers SPEC-065 CA-11: the order of the cards of the panel and of the scoreboard does not depend on the order the repository gives.
func TestExerciseOf_OrderIsTheServices(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)
	x.now = x.started.Add(10 * time.Second)
	for _, who := range []service.Actor{x.carla, x.bruno, x.ana} {
		x.mustSubmit(t, who, st.Run.ID, `"pass"`) // the same points and time for the three
	}
	state, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	ids := make([]string, len(state.Results))
	for i, r := range state.Results {
		ids[i] = r.StudentID.String()
	}
	assert.True(t, sort.StringsAreSorted(ids), "a tie of everything is told by the student, always the same order: %v", ids)
}
