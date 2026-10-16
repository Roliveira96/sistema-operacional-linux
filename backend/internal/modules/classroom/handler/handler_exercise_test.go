package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// ---- SPEC-065: the exercise of the lesson ----

var exerciseNow = time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)

// exerciseDouble is the exercise of the lesson in the service double. It answers as the real service does for what the handler can see: one
// round at a time, the students that are in it, the one the teacher watches, the progress, the results and the scripted state of the student
// ("pass", "fail" and anything else is not a machine). What the handler asked is kept, to tell what it passed on.
type exerciseDouble struct {
	run          *domain.LiveExerciseRun
	participants map[uuid.UUID]bool
	progress     map[uuid.UUID]service.ExerciseProgress
	attempts     map[uuid.UUID]int
	watching     *uuid.UUID
	results      []domain.ExerciseResultEntry
	names        map[uuid.UUID]string
	now          time.Time

	err       error // every start, end, reveal and watch answers with it when set
	submitErr error // every submission answers with it when set

	starts   []service.ExerciseStartInput
	actors   []service.Actor
	joins    []uuid.UUID
	submits  []service.ExerciseSubmitInput
	recorded []service.ExerciseProgress
	onEnded  func(uuid.UUID, service.ExerciseState)

	// SPEC-071: the student taken over now, who had a takeover in the round, whether the student was online at each takeover, and whether the
	// timer releases the takeover
	takeover       *uuid.UUID
	takenOver      map[uuid.UUID]bool
	takeoverOnline []bool
	releaseOnTimer bool
}

func (d *exerciseDouble) at() time.Time {
	if d.now.IsZero() {
		return exerciseNow
	}
	return d.now
}

func (d *exerciseDouble) running() bool { return d.run != nil && d.run.Running() }

// state is the state of the round as the service gives it.
func (d *exerciseDouble) state(withProgress bool) *service.ExerciseState {
	if d.run == nil {
		return nil
	}
	results := append([]domain.ExerciseResultEntry(nil), d.results...)
	domain.SortScoreboard(results)
	crowd := map[uuid.UUID]bool{}
	for id := range d.participants {
		crowd[id] = true
	}
	for _, r := range results {
		crowd[r.StudentID] = true
	}
	st := &service.ExerciseState{Run: *d.run, Now: d.at(), Results: results, Participants: len(crowd)}
	if withProgress {
		for id := range crowd {
			e := service.ExerciseEntry{StudentID: id, Name: d.names[id], Attempts: d.attempts[id]}
			if p, ok := d.progress[id]; ok {
				at := p.At
				e.Met, e.Total, e.Last, e.At = p.Met, p.Total, p.Last, &at
				e.Commands, e.LastCommandAt = p.Commands, p.LastCommandAt
			}
			e.Status = domain.ParticipantInProgress
			if d.takeover != nil && *d.takeover == id {
				e.TakeoverOn, e.TakenOver = true, true
			}
			e.TakenOver = e.TakenOver || d.takenOver[id]
			for i := range results {
				if results[i].StudentID == id {
					e.Result, e.Attempts, e.Status = &results[i], results[i].Attempts, domain.ParticipantCompleted
				}
			}
			st.Entries = append(st.Entries, e)
		}
		sort.Slice(st.Entries, func(i, j int) bool { return st.Entries[i].Name < st.Entries[j].Name })
	}
	return st
}

func (f *fakeService) StartExercise(_ context.Context, a service.Actor, session uuid.UUID, in service.ExerciseStartInput) (service.ExerciseState, error) {
	f.record("exercise:start")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	d.starts, d.actors = append(d.starts, in), append(d.actors, a)
	if d.err != nil {
		return service.ExerciseState{}, d.err
	}
	if d.running() {
		return service.ExerciseState{}, domain.ErrExerciseRunning
	}
	minutes, err := domain.ExerciseMinutes(in.Minutes)
	if err != nil {
		return service.ExerciseState{}, err
	}
	run := domain.StartExerciseRun(session, in.BlockID, in.Index, "Criar a pasta", domain.DifficultyHard, minutes, d.at())
	run.ID = uuid.New()
	d.run, d.watching, d.results = &run, nil, nil
	d.participants, d.progress, d.attempts = map[uuid.UUID]bool{}, map[uuid.UUID]service.ExerciseProgress{}, map[uuid.UUID]int{}
	for _, id := range in.Online {
		d.participants[id] = true
	}
	return service.ExerciseState{Run: run, Now: d.at(), Participants: len(d.participants)}, nil
}

func (f *fakeService) EndExercise(_ context.Context, _ service.Actor, _ uuid.UUID) (service.ExerciseState, error) {
	f.record("exercise:end")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.err != nil {
		return service.ExerciseState{}, d.err
	}
	if !d.running() {
		return service.ExerciseState{}, domain.ErrNoExerciseRun
	}
	_ = d.run.End(d.at(), domain.EndedByTeacher)
	st := *d.state(false)
	st.Unwatched, d.watching = d.watching, nil
	return st, nil
}

func (f *fakeService) RevealExercise(_ context.Context, _ service.Actor, _ uuid.UUID, visible bool) (service.ExerciseState, error) {
	f.record("exercise:reveal")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.err != nil {
		return service.ExerciseState{}, d.err
	}
	if d.run == nil {
		return service.ExerciseState{}, domain.ErrNoExerciseRun
	}
	if err := d.run.ShowResult(visible); err != nil {
		return service.ExerciseState{}, err
	}
	return *d.state(false), nil
}

func (f *fakeService) WatchExercise(_ context.Context, _ service.Actor, _ uuid.UUID, student *uuid.UUID) (service.ExerciseWatch, error) {
	f.record("exercise:watch")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.err != nil {
		return service.ExerciseWatch{}, d.err
	}
	previous := d.watching
	if student == nil {
		d.watching = nil
		return service.ExerciseWatch{Previous: previous}, nil
	}
	if !d.running() {
		return service.ExerciseWatch{}, domain.ErrNoExerciseRun
	}
	if !d.participants[*student] {
		return service.ExerciseWatch{}, domain.ErrNotInExerciseRun
	}
	id := *student
	d.watching = &id
	return service.ExerciseWatch{Previous: previous, Current: &id}, nil
}

func (f *fakeService) ExerciseScreenAllowed(_, student, runID uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	return d.running() && d.run.ID == runID && d.watching != nil && *d.watching == student
}

func (f *fakeService) ExerciseWatching(_, student uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	return d.running() && d.watching != nil && *d.watching == student
}

func (f *fakeService) JoinExercise(_ uuid.UUID, students ...uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	d.joins = append(d.joins, students...)
	if d.running() {
		for _, id := range students {
			d.participants[id] = true
		}
	}
}

func (f *fakeService) RecordExerciseProgress(_ context.Context, _, student uuid.UUID, in service.ExerciseProgressInput) (service.ExerciseProgress, error) {
	f.record("exercise:progress")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.run == nil || d.run.ID != in.RunID {
		return service.ExerciseProgress{}, domain.ErrNoExerciseRun
	}
	if !d.run.Running() {
		return service.ExerciseProgress{}, domain.ErrExerciseEnded
	}
	if !domain.ValidExerciseProgress(in.Met, in.Total) {
		return service.ExerciseProgress{}, domain.ErrInvalidExerciseProgress
	}
	last, err := domain.NormalizeExerciseLast(in.Last)
	if err != nil {
		return service.ExerciseProgress{}, err
	}
	at := d.at()
	p := service.ExerciseProgress{RunID: in.RunID, StudentID: student, Met: in.Met, Total: in.Total, Last: last, At: at, Commands: in.Commands, LastCommandAt: &at}
	d.participants[student], d.progress[student] = true, p
	d.recorded = append(d.recorded, p)
	return p, nil
}

func (f *fakeService) ExerciseOf(_ context.Context, _ uuid.UUID, withProgress bool) (*service.ExerciseState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.exercise.state(withProgress), nil
}

func (f *fakeService) SubmitExercise(_ context.Context, a service.Actor, _ uuid.UUID, in service.ExerciseSubmitInput) (service.ExerciseSubmitResult, error) {
	f.record("exercise:submit")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	d.submits = append(d.submits, in)
	if a.Role != authn.RoleStudent {
		return service.ExerciseSubmitResult{}, domain.ErrForbidden
	}
	if d.submitErr != nil {
		return service.ExerciseSubmitResult{}, d.submitErr
	}
	if d.run == nil || d.run.ID != in.RunID {
		return service.ExerciseSubmitResult{}, domain.ErrNoExerciseRun
	}
	for i := range d.results {
		if d.results[i].StudentID == a.UserID {
			kept := domain.LiveExerciseResult{RunID: d.run.ID, StudentID: a.UserID, CompletedAt: d.results[i].CompletedAt,
				ElapsedSeconds: d.results[i].ElapsedSeconds, Points: d.results[i].Points, Attempts: d.results[i].Attempts}
			return service.ExerciseSubmitResult{Passed: true, Result: &kept, Run: *d.run}, nil
		}
	}
	switch string(in.Snapshot) {
	case `"fail"`:
		d.attempts[a.UserID]++
		return service.ExerciseSubmitResult{Run: *d.run}, nil
	case `"pass"`:
		d.attempts[a.UserID]++
		now := d.at()
		res := domain.LiveExerciseResult{RunID: d.run.ID, StudentID: a.UserID, CompletedAt: now, ElapsedSeconds: d.run.ElapsedAt(now), Points: d.run.PointsAt(now), Attempts: d.attempts[a.UserID]}
		d.results = append(d.results, domain.ExerciseResultEntry{StudentID: a.UserID, Name: d.names[a.UserID], CompletedAt: now, ElapsedSeconds: res.ElapsedSeconds, Points: res.Points, Attempts: res.Attempts})
		d.participants[a.UserID] = true
		return service.ExerciseSubmitResult{Passed: true, Result: &res, Created: true, Run: *d.run, Name: d.names[a.UserID]}, nil
	}
	return service.ExerciseSubmitResult{}, domain.ErrInvalidExerciseState
}

// fireTimer is the timer of the service going off: the round ends by the timer at its end and the handler is told, as the service does through
// its hook.
func (f *fakeService) fireTimer(session uuid.UUID) {
	f.mu.Lock()
	d := &f.exercise
	if !d.running() {
		f.mu.Unlock()
		return
	}
	_ = d.run.End(d.run.EndsAt, domain.EndedByTimer)
	st := *d.state(false)
	st.Unwatched, d.watching = d.watching, nil
	if d.releaseOnTimer {
		st.Released = d.release()
	}
	hook := d.onEnded
	f.mu.Unlock()
	if hook != nil {
		hook(session, st)
	}
}

func (f *fakeService) setExerciseError(err error) {
	f.mu.Lock()
	f.exercise.err = err
	f.mu.Unlock()
}

func (f *fakeService) setExerciseNow(at time.Time) {
	f.mu.Lock()
	f.exercise.now = at
	f.mu.Unlock()
}

func (f *fakeService) exerciseStarts() []service.ExerciseStartInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]service.ExerciseStartInput(nil), f.exercise.starts...)
}

func (f *fakeService) exerciseRecorded() []service.ExerciseProgress {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]service.ExerciseProgress(nil), f.exercise.recorded...)
}

// ---- the room of the tests ----

const (
	typeExStart    = "live:exercise:start"
	typeExEnd      = "live:exercise:end"
	typeExReveal   = "live:exercise:reveal"
	typeExWatch    = "live:exercise:watch"
	typeExProgress = "live:exercise:progress"
	typeExScreen   = "live:exercise:screen"
	typeExStarted  = "live:exercise:started"
	typeExEnded    = "live:exercise:ended"
	typeExResult   = "live:exercise:result"
	typeExDone     = "live:exercise:done"
)

// tap reads everything that a connection receives, in the background, so that a test can wait for a message and, later, tell that no other came.
// A read that times out ends a connection for good, so a connection that a test goes on using is never read with a deadline.
type tap struct {
	conn *websocket.Conn
	mu   sync.Mutex
	msgs []message
	took map[string]int // how many of each type the test took already
}

func newTap(conn *websocket.Conn) *tap {
	p := &tap{conn: conn, took: map[string]int{}}
	go func() {
		for {
			var m message
			if err := conn.ReadJSON(&m); err != nil {
				return
			}
			p.mu.Lock()
			p.msgs = append(p.msgs, m)
			p.mu.Unlock()
		}
	}()
	return p
}

func (p *tap) send(t *testing.T, typ, data string) {
	t.Helper()
	sendMsg(t, p.conn, typ, data)
}

// next waits for the first message of the type that the test did not take yet, and takes it.
func (p *tap) next(t *testing.T, typ string) message {
	t.Helper()
	var got message
	require.Eventually(t, func() bool {
		p.mu.Lock()
		defer p.mu.Unlock()
		seen := 0
		for _, m := range p.msgs {
			if m.Type != typ {
				continue
			}
			if seen == p.took[typ] {
				got, p.took[typ] = m, p.took[typ]+1
				return true
			}
			seen++
		}
		return false
	}, 2*time.Second, 5*time.Millisecond, "message not received: %s", typ)
	return got
}

func (p *tap) nextData(t *testing.T, typ string) map[string]any {
	t.Helper()
	return dataOf(t, p.next(t, typ))
}

// pending are the types of the messages that came and that the test did not take, among the types.
func (p *tap) pending(types ...string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	count := map[string]int{}
	var out []string
	for _, m := range p.msgs {
		for _, typ := range types {
			if m.Type == typ {
				if count[typ]++; count[typ] > p.took[typ] {
					out = append(out, typ)
				}
			}
		}
	}
	return out
}

// quiet tells that nobody got a message of the types that the test did not take: it waits a moment for what is in flight, and looks.
func quiet(t *testing.T, types []string, taps ...*tap) {
	t.Helper()
	time.Sleep(150 * time.Millisecond)
	for i, p := range taps {
		assert.Empty(t, p.pending(types...), "connection %d got a message that it should not have", i)
	}
}

// crowd is a room with three students (A with two tabs, B and C), the panel, the presentation window and one student who waits.
type crowd struct {
	w                 *world
	ana, bruno, carla uuid.UUID
	a, aTab, b, c, d  *tap
	panel, presenter  *tap
	block             uuid.UUID
	waiting           authn.Principal
}

func newCrowd(t *testing.T, w *world) *crowd {
	t.Helper()
	third := w.newPerson("third")
	waiting := w.newPerson("waiting")
	w.svc.states = map[uuid.UUID]string{waiting.UserID: domain.AdmissionWaiting}
	cr := &crowd{w: w, ana: w.student.UserID, bruno: w.stranger.UserID, carla: third.UserID, waiting: waiting, block: uuid.New()}
	w.svc.exercise.names = map[uuid.UUID]string{cr.ana: "Ana", cr.bruno: "Bruno", cr.carla: "Carla"}
	w.svc.exercise.onEnded = w.h.ExerciseEnded
	cr.a, cr.aTab, cr.b, cr.c = newTap(w.dial(t, "student")), newTap(w.dial(t, "second")), newTap(w.dial(t, "stranger")), newTap(w.dial(t, "third"))
	cr.panel, cr.presenter = newTap(w.dialView(t, "teacher", "panel")), newTap(w.dialView(t, "teacher2", "presenter"))
	for _, p := range []*tap{cr.a, cr.aTab, cr.b, cr.c, cr.panel, cr.presenter} {
		p.next(t, "live:snapshot")
	}
	cr.d = newTap(w.dial(t, "waiting"))
	cr.d.next(t, "live:admission:state")
	return cr
}

func (cr *crowd) students() []*tap { return []*tap{cr.a, cr.aTab, cr.b, cr.c} }

// everyone is every connection of the room, the panel and the waiting one included.
func (cr *crowd) everyone() []*tap {
	return []*tap{cr.a, cr.aTab, cr.b, cr.c, cr.d, cr.panel, cr.presenter}
}

// startData is the data of a start message for the block of the room, with the minutes when they are given.
func (cr *crowd) startData(index int, minutes ...int) string {
	data := `{"blockId":"` + cr.block.String() + `","index":` + strconv.Itoa(index)
	if len(minutes) > 0 {
		data += `,"minutes":` + strconv.Itoa(minutes[0])
	}
	return data + `}`
}

// start has the panel start the exercise and takes the message of the panel and the ones of the students; it returns what the panel was told.
func (cr *crowd) start(t *testing.T, minutes ...int) map[string]any {
	t.Helper()
	cr.panel.send(t, typeExStart, cr.startData(1, minutes...))
	started := cr.panel.nextData(t, typeExStarted)
	for _, s := range cr.students() {
		s.next(t, typeExStarted)
	}
	return started
}

func dataOf(t *testing.T, m message) map[string]any {
	t.Helper()
	var out map[string]any
	require.NoError(t, json.Unmarshal(m.Data, &out))
	return out
}

func sortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func droppedFor(w *world, prefix string) []string {
	var out []string
	for _, r := range droppedReasons(w) {
		if strings.HasPrefix(r, prefix+":") {
			out = append(out, strings.TrimPrefix(r, prefix+":"))
		}
	}
	return out
}

func rejectedCount(w *world) int { return w.logs.FilterMessage("classroom message rejected").Len() }

// ---- start ----

// Covers SPEC-065 CA-01, CA-14 and section 3.1 (live:exercise:start, live:exercise:started): the panel starts the exercise; the panel and every
// admitted student (all the tabs of each) are told within 300 ms, with the round (the id, the block, the exercise, the title, the level, the
// time, the start, the end and the hour of the server); the presentation window and who waits are never told; the service got the block, the
// index, the minutes and who is online (the students that are admitted, once each).
func TestExercise_StartTellsThePanelAndTheStudents(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)

	sent := time.Now()
	cr.panel.send(t, typeExStart, cr.startData(1))
	started := cr.panel.nextData(t, typeExStarted)
	told := map[string]map[string]any{}
	for name, p := range map[string]*tap{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		told[name] = p.nextData(t, typeExStarted)
	}
	assert.Less(t, time.Since(sent), 300*time.Millisecond, "the panel and the students are told in up to 300 ms")

	assert.Equal(t, []string{"blockId", "difficulty", "durationSeconds", "endsAt", "index", "now", "runId", "startedAt", "title"}, sortedKeys(started))
	_, err := uuid.Parse(started["runId"].(string))
	assert.NoError(t, err, "the id comes from the server")
	assert.Equal(t, cr.block.String(), started["blockId"])
	assert.EqualValues(t, 1, started["index"])
	assert.Equal(t, "Criar a pasta", started["title"])
	assert.Equal(t, "HARD", started["difficulty"])
	assert.EqualValues(t, 300, started["durationSeconds"], "5 minutes by default")
	assert.Equal(t, "2026-10-14T19:00:00.000Z", started["startedAt"])
	assert.Equal(t, "2026-10-14T19:05:00.000Z", started["endsAt"])
	assert.Equal(t, "2026-10-14T19:00:00.000Z", started["now"], "the hour of the server, for the clients to correct their clocks")
	for name, got := range told {
		assert.Equal(t, started, got, name+" gets what the panel gets")
	}

	quiet(t, []string{typeExStarted}, cr.everyone()...) // nobody got it twice, and the presentation window and the waiting one got none
	require.Len(t, w.svc.exerciseStarts(), 1)
	in := w.svc.exerciseStarts()[0]
	assert.Equal(t, cr.block, in.BlockID)
	assert.Equal(t, 1, in.Index)
	assert.Nil(t, in.Minutes, "no minutes: the service puts the default")
	online := []string{cr.ana.String(), cr.bruno.String(), cr.carla.String()}
	sort.Strings(online)
	got := make([]string, len(in.Online))
	for i, id := range in.Online {
		got[i] = id.String()
	}
	sort.Strings(got)
	assert.Equal(t, online, got, "who is online: the three students once each, not the waiting one, not the teacher")
	assert.Equal(t, w.teacher.UserID, w.svc.exercise.actors[0].UserID)
	assert.Equal(t, authn.RoleTeacher, w.svc.exercise.actors[0].Role)
}

// Covers SPEC-065 CA-01 and section 3.1 (live:exercise:start): the minutes the teacher chooses are the time of the round.
func TestExercise_StartWithMinutes(t *testing.T) {
	for _, tc := range []struct {
		minutes int
		seconds int
		endsAt  string
	}{{1, 60, "2026-10-14T19:01:00.000Z"}, {2, 120, "2026-10-14T19:02:00.000Z"}, {60, 3600, "2026-10-14T20:00:00.000Z"}} {
		w := setup(t)
		cr := newCrowd(t, w)
		started := cr.start(t, tc.minutes)
		assert.EqualValues(t, tc.seconds, started["durationSeconds"], "%d minutes", tc.minutes)
		assert.Equal(t, tc.endsAt, started["endsAt"])
		require.NotNil(t, w.svc.exerciseStarts()[0].Minutes)
		assert.Equal(t, tc.minutes, *w.svc.exerciseStarts()[0].Minutes)
	}
}

// Covers SPEC-065 CA-01, CA-14 and section 3.1: only the panel window of the teacher starts a round: the presentation window, a student, one who
// waits and a panel window that another replaced are dropped, with the log "classroom message dropped", and the service is not asked.
func TestExercise_StartIsOnlyThePanels(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)

	cr.presenter.send(t, typeExStart, cr.startData(1))
	cr.a.send(t, typeExStart, cr.startData(1))
	cr.d.send(t, typeExStart, cr.startData(1))
	oldPanel := w.dialView(t, "teacher2", "panel")
	readUntil(t, oldPanel, "live:snapshot")
	replacing := w.dialView(t, "teacher", "panel")
	readUntil(t, replacing, "live:snapshot")
	readUntil(t, oldPanel, "live:control:revoked")
	sendMsg(t, oldPanel, typeExStart, cr.startData(1))

	eventually(t, func() bool { return len(droppedFor(w, typeExStart)) == 4 })
	assert.ElementsMatch(t, []string{"wrong-view", "not-controller", "not-admitted", "not-controller"}, droppedFor(w, typeExStart))
	assert.Empty(t, w.svc.exerciseStarts(), "not one reached the service")
	assert.Zero(t, rejectedCount(w))
	quiet(t, []string{typeExStarted}, cr.everyone()...)
}

// Covers SPEC-065 CA-01, CA-14 and section 3.1: a start that is not valid or that the service refuses starts nothing and tells nobody, with the
// log "classroom message rejected": data that is missing, not an object, a block that is not an id, an index that is not a whole number, minutes
// that are not a whole number from 1 to 60; and a refusal of the service (a round already running, an exercise that is not there, no module).
func TestExercise_StartRejections(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	block := cr.block.String()

	atTheHandler := 0
	for _, data := range []string{
		`{}`, `null`, `[]`, `"start"`, `7`, `{"blockId":"` + block + `"}`, `{"index":1}`,
		`{"blockId":"not-a-uuid","index":1}`, `{"blockId":"","index":1}`, `{"blockId":7,"index":1}`, `{"blockId":null,"index":1}`,
		`{"blockId":"` + block + `","index":"1"}`, `{"blockId":"` + block + `","index":1.5}`, `{"blockId":"` + block + `","index":null}`,
		`{"blockId":"` + block + `","index":true}`,
		`{"blockId":"` + block + `","index":1,"minutes":"5"}`, `{"blockId":"` + block + `","index":1,"minutes":1.5}`,
		`{"blockId":"` + block + `","index":1,"minutes":true}`,
	} {
		cr.panel.send(t, typeExStart, data)
		atTheHandler++
	}
	require.NoError(t, cr.panel.conn.WriteJSON(obj{"type": typeExStart}))
	atTheHandler++ // no data at all

	atTheService := 0
	for _, minutes := range []string{"0", "-1", "61", "1000"} {
		cr.panel.send(t, typeExStart, `{"blockId":"`+block+`","index":1,"minutes":`+minutes+`}`)
		atTheService++
	}
	eventually(t, func() bool { return rejectedCount(w) == atTheHandler+atTheService })
	for _, err := range []error{domain.ErrExerciseUnavailable, domain.ErrExerciseRunning, domain.ErrModuleNotSelected, domain.ErrSessionNotFound, domain.ErrForbidden} {
		w.svc.setExerciseError(err)
		cr.panel.send(t, typeExStart, cr.startData(1))
		atTheService++
		eventually(t, func() bool { return rejectedCount(w) == atTheHandler+atTheService }) // one at a time: the error is the one that was set
	}
	w.svc.setExerciseError(nil)

	assert.Len(t, w.svc.exerciseStarts(), atTheService, "the others were rejected before they reached the service")
	assert.Empty(t, droppedFor(w, typeExStart), "these are rejections, not drops")
	for _, entry := range w.logs.FilterMessage("classroom message rejected").All() {
		assert.Equal(t, typeExStart, entry.ContextMap()["type"])
		assert.Equal(t, w.teacher.UserID.String(), entry.ContextMap()["userId"])
	}
	quiet(t, []string{typeExStarted}, cr.everyone()...)

	// the first valid start is the first that tells anybody, and with a second one running it is refused again
	started := cr.start(t)
	assert.NotEmpty(t, started["runId"])
	cr.panel.send(t, typeExStart, cr.startData(1))
	eventually(t, func() bool { return rejectedCount(w) == atTheHandler+atTheService+1 })
	quiet(t, []string{typeExStarted}, cr.everyone()...)
}

// ---- end ----

// Covers SPEC-065 CA-03 and section 3.1 (live:exercise:end, live:exercise:ended): the teacher ends the round; the panel and the students are told
// who ended it and when, with the hour of the server; the presentation window and who waits are not; the student who was being watched is told
// that it stopped (on false) and nobody else; with no round, or from a student, nothing is sent.
func TestExercise_EndByTheTeacher(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)

	cr.panel.send(t, typeExEnd, `{}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
	quiet(t, []string{typeExEnded}, cr.everyone()...)

	started := cr.start(t)
	cr.panel.send(t, typeExWatch, `{"studentId":"`+cr.bruno.String()+`"}`)
	assert.JSONEq(t, `{"on":true}`, string(cr.b.next(t, typeExWatch).Data))

	cr.a.send(t, typeExEnd, `{}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExEnd)) == 1 })
	assert.Equal(t, []string{"not-controller"}, droppedFor(w, typeExEnd))

	w.svc.setExerciseNow(exerciseNow.Add(90 * time.Second))
	cr.panel.send(t, typeExEnd, `{}`)
	panel := cr.panel.nextData(t, typeExEnded)
	assert.Equal(t, []string{"by", "endedAt", "now", "runId"}, sortedKeys(panel))
	assert.Equal(t, started["runId"], panel["runId"])
	assert.Equal(t, "TEACHER", panel["by"])
	assert.Equal(t, "2026-10-14T19:01:30.000Z", panel["endedAt"])
	assert.Equal(t, "2026-10-14T19:01:30.000Z", panel["now"])
	for name, p := range map[string]*tap{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		assert.Equal(t, panel, p.nextData(t, typeExEnded), name)
	}
	assert.JSONEq(t, `{"on":false}`, string(cr.b.next(t, typeExWatch).Data), "the observation ended with the round: Bruno is told")
	quiet(t, []string{typeExEnded, typeExWatch}, cr.everyone()...) // nobody else, and nobody twice

	// a second end has no round to end
	cr.panel.send(t, typeExEnd, `{}`)
	eventually(t, func() bool { return rejectedCount(w) == 2 })
}

// Covers SPEC-065 CA-03 and section 3.1 (Fim da rodada): when the time is up, the server ends the round by the timer with the room connected: the
// panel and every student are told "TIMER", at the end of its time; the watched student is told that it stopped; the presentation window and who
// waits are not; and what the students send after that is rejected.
func TestExercise_EndsByTheTimerWithTheRoomConnected(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	started := cr.start(t, 1)
	cr.panel.send(t, typeExWatch, `{"studentId":"`+cr.ana.String()+`"}`)
	cr.a.next(t, typeExWatch)
	cr.aTab.next(t, typeExWatch)

	w.svc.fireTimer(w.session.ID)

	panel := cr.panel.nextData(t, typeExEnded)
	assert.Equal(t, started["runId"], panel["runId"])
	assert.Equal(t, "TIMER", panel["by"])
	assert.Equal(t, "2026-10-14T19:01:00.000Z", panel["endedAt"], "at the end of its time")
	for name, p := range map[string]*tap{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		assert.Equal(t, panel, p.nextData(t, typeExEnded), name)
	}
	assert.JSONEq(t, `{"on":false}`, string(cr.a.next(t, typeExWatch).Data))
	assert.JSONEq(t, `{"on":false}`, string(cr.aTab.next(t, typeExWatch).Data), "all the tabs of the watched student")
	quiet(t, []string{typeExEnded, typeExWatch}, cr.everyone()...)

	cr.b.send(t, typeExProgress, `{"runId":"`+started["runId"].(string)+`","met":1,"total":2}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
	quiet(t, []string{typeExProgress}, cr.panel)
}

// Covers SPEC-065 CA-03: a failure of the timer is logged, with "classroom exercise timer failed" and who it was for, and tells nobody.
func TestExercise_TimerFailureIsLogged(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	w.h.ExerciseFailed(w.session.ID, assert.AnError)
	entries := w.logs.FilterMessage("classroom exercise timer failed").All()
	require.Len(t, entries, 1)
	assert.Equal(t, w.session.ID.String(), entries[0].ContextMap()["room"])
	quiet(t, []string{typeExEnded}, cr.everyone()...)
}

// ---- reveal ----

// Covers SPEC-065 CA-10 and section 3.1 (live:exercise:reveal, live:exercise:result): the teacher shows the result only when the round has ended: on
// a running round or with none it is refused; once ended, the panel and the students get the scoreboard (by points and then by time, with the names)
// and how many concluded of how many were in the round; hiding sends the result with no scoreboard; a student cannot do either.
func TestExercise_RevealOnlyWhenEnded(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.panel.send(t, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })

	started := cr.start(t)
	cr.panel.send(t, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return rejectedCount(w) == 2 })
	quiet(t, []string{typeExResult}, cr.everyone()...)

	run := started["runId"].(string)
	submit := func(token string, at time.Duration) {
		w.svc.setExerciseNow(exerciseNow.Add(at))
		code, body := w.call(t, token, http.MethodPost, w.path("/exercise/submit"), obj{"runId": run, "snapshot": "pass"})
		require.Equal(t, http.StatusOK, code, body)
	}
	// each student has his own limiter key, so no 429
	submit("stranger", 60*time.Second) // 30 + floor(30 × 240 ÷ 600) = 42
	submit("student", 95*time.Second)  // 30 + floor(30 × 205 ÷ 600) = 40
	submit("third", 200*time.Second)   // 30 + floor(30 × 100 ÷ 600) = 35
	w.svc.setExerciseNow(exerciseNow.Add(210 * time.Second))
	cr.panel.send(t, typeExEnd, `{}`)
	cr.panel.next(t, typeExEnded)

	cr.a.send(t, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExReveal)) == 1 })
	assert.Equal(t, []string{"not-controller"}, droppedFor(w, typeExReveal))
	cr.presenter.send(t, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExReveal)) == 2 })
	assert.Equal(t, "wrong-view", droppedFor(w, typeExReveal)[1])

	cr.panel.send(t, typeExReveal, `{"visible":true}`)
	shown := cr.panel.nextData(t, typeExResult)
	assert.Equal(t, []string{"completed", "participants", "runId", "scoreboard", "visible"}, sortedKeys(shown))
	assert.Equal(t, run, shown["runId"])
	assert.Equal(t, true, shown["visible"])
	assert.EqualValues(t, 3, shown["completed"])
	assert.EqualValues(t, 3, shown["participants"])
	board := shown["scoreboard"].([]any)
	require.Len(t, board, 3)
	names := make([]string, len(board))
	for i, row := range board {
		entry := row.(map[string]any)
		names[i] = entry["name"].(string)
		assert.Equal(t, []string{"elapsedSeconds", "name", "points", "studentId"}, sortedKeys(entry))
	}
	assert.Equal(t, []string{"Bruno", "Ana", "Carla"}, names, "by points, from the highest: 42, 40, 35")
	first := board[0].(map[string]any)
	assert.Equal(t, cr.bruno.String(), first["studentId"])
	assert.EqualValues(t, 60, first["elapsedSeconds"])
	assert.EqualValues(t, 42, first["points"])
	for name, p := range map[string]*tap{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		assert.Equal(t, shown, p.nextData(t, typeExResult), name)
	}
	quiet(t, []string{typeExResult}, cr.everyone()...)

	cr.panel.send(t, typeExReveal, `{"visible":false}`)
	hidden := cr.panel.nextData(t, typeExResult)
	assert.Equal(t, []string{"completed", "participants", "runId", "visible"}, sortedKeys(hidden), "hidden: no scoreboard")
	assert.Equal(t, false, hidden["visible"])
	assert.EqualValues(t, 3, hidden["completed"])
	assert.Equal(t, hidden, cr.b.nextData(t, typeExResult))

	for _, data := range []string{`{}`, `null`, `[]`, `{"visible":"yes"}`, `{"visible":1}`, `{"visible":null}`, `"visible"`} {
		before := rejectedCount(w)
		cr.panel.send(t, typeExReveal, data)
		eventually(t, func() bool { return rejectedCount(w) == before+1 })
	}
}

// ---- watch ----

// Covers SPEC-065 CA-07 and section 3.1 (live:exercise:watch): the panel watches one student at a time: only that student is told (all his tabs),
// with on true; switching tells the first one on false and the second on true; null stops; a student that is not in the round, a round that is not
// running, and bad data are refused; a student and the presentation window are dropped; nobody else is told anything.
func TestExercise_WatchOneStudentAtATime(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	ana, bruno := cr.ana.String(), cr.bruno.String()
	on, off := `{"on":true}`, `{"on":false}`

	cr.panel.send(t, typeExWatch, `{"studentId":"`+ana+`"}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
	quiet(t, []string{typeExWatch}, cr.everyone()...)

	cr.start(t)
	cr.panel.send(t, typeExWatch, `{"studentId":"`+ana+`"}`)
	assert.JSONEq(t, on, string(cr.a.next(t, typeExWatch).Data))
	assert.JSONEq(t, on, string(cr.aTab.next(t, typeExWatch).Data), "every tab of the student")
	quiet(t, []string{typeExWatch}, cr.everyone()...)

	cr.panel.send(t, typeExWatch, `{"studentId":"`+bruno+`"}`)
	assert.JSONEq(t, off, string(cr.a.next(t, typeExWatch).Data), "Ana is no longer watched")
	assert.JSONEq(t, off, string(cr.aTab.next(t, typeExWatch).Data))
	assert.JSONEq(t, on, string(cr.b.next(t, typeExWatch).Data))
	quiet(t, []string{typeExWatch}, cr.everyone()...)

	cr.panel.send(t, typeExWatch, `{"studentId":"`+bruno+`"}`)
	assert.JSONEq(t, on, string(cr.b.next(t, typeExWatch).Data), "the same again: still on")
	quiet(t, []string{typeExWatch}, cr.everyone()...)

	cr.panel.send(t, typeExWatch, `{"studentId":null}`)
	assert.JSONEq(t, off, string(cr.b.next(t, typeExWatch).Data))
	cr.panel.send(t, typeExWatch, `{"studentId":null}`)
	quiet(t, []string{typeExWatch}, cr.everyone()...)

	// refused: a student that is not in the round, the waiting one, bad data
	rejected := rejectedCount(w)
	for _, data := range []string{
		`{"studentId":"` + uuid.NewString() + `"}`, `{"studentId":"` + w.teacher.UserID.String() + `"}`, `{"studentId":"` + cr.waiting.UserID.String() + `"}`,
		`{}`, `null`, `[]`, `"x"`, `{"studentId":"not-a-uuid"}`, `{"studentId":""}`, `{"studentId":7}`, `{"studentId":true}`,
	} {
		cr.panel.send(t, typeExWatch, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	cr.a.send(t, typeExWatch, `{"studentId":"`+ana+`"}`)
	cr.presenter.send(t, typeExWatch, `{"studentId":"`+ana+`"}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExWatch)) == 2 })
	assert.ElementsMatch(t, []string{"not-controller", "wrong-view"}, droppedFor(w, typeExWatch))
	quiet(t, []string{typeExWatch}, cr.everyone()...)
}

// Covers SPEC-065 CA-07 and section 3.1 (live:exercise:screen): the picture of a terminal goes to the panel only, and only from the student the
// teacher watches: the picture of anybody else is dropped ("classroom message dropped"), and the other students, the presentation window and
// who waits never see one. After a switch, the one who was watched is dropped and the new one passes. B never gets what A sends.
func TestExercise_ScreenOnlyOfTheWatchedStudent(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	started := cr.start(t)
	run := started["runId"].(string)
	screen := func(student string) string {
		return `{"runId":"` + run + `","screen":{"tag":"div","children":["$ ls ` + student + `"]}}`
	}

	// nobody is watched: every picture is dropped
	cr.a.send(t, typeExScreen, screen("a"))
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 1 })
	assert.Equal(t, []string{"not-watched"}, droppedFor(w, typeExScreen))
	quiet(t, []string{typeExScreen}, cr.everyone()...)

	cr.panel.send(t, typeExWatch, `{"studentId":"`+cr.ana.String()+`"}`)
	cr.a.next(t, typeExWatch)
	cr.a.send(t, typeExScreen, screen("a"))
	got := cr.panel.nextData(t, typeExScreen)
	assert.Equal(t, []string{"screen", "studentId"}, sortedKeys(got))
	assert.Equal(t, cr.ana.String(), got["studentId"])
	assert.JSONEq(t, `{"tag":"div","children":["$ ls a"]}`, mustJSON(got["screen"]), "the picture as it came, with no runId")
	quiet(t, []string{typeExScreen}, cr.a, cr.aTab, cr.b, cr.c, cr.d, cr.presenter, cr.panel)

	// Ana's other tab is Ana too: her picture passes
	cr.aTab.send(t, typeExScreen, screen("tab"))
	assert.Equal(t, cr.ana.String(), cr.panel.nextData(t, typeExScreen)["studentId"])

	// B is not watched: dropped; the panel sees nothing
	cr.b.send(t, typeExScreen, screen("b"))
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 2 })
	quiet(t, []string{typeExScreen}, cr.panel)

	// a picture of the round that is not this one is dropped too
	cr.a.send(t, typeExScreen, `{"runId":"`+uuid.NewString()+`","screen":{"tag":"div"}}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 3 })
	quiet(t, []string{typeExScreen}, cr.panel)

	// the switch: Ana is dropped, Bruno passes
	cr.panel.send(t, typeExWatch, `{"studentId":"`+cr.bruno.String()+`"}`)
	cr.b.next(t, typeExWatch)
	cr.a.send(t, typeExScreen, screen("a"))
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 4 })
	cr.b.send(t, typeExScreen, screen("b"))
	assert.Equal(t, cr.bruno.String(), cr.panel.nextData(t, typeExScreen)["studentId"])
	quiet(t, []string{typeExScreen}, cr.everyone()...)

	// stopping: nobody is watched any more
	cr.panel.send(t, typeExWatch, `{"studentId":null}`)
	cr.b.next(t, typeExWatch)
	cr.b.send(t, typeExScreen, screen("b"))
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 5 })
	assert.Zero(t, rejectedCount(w), "all of these were drops, not rejections")
}

// Covers SPEC-065 CA-14 and section 3.1 (live:exercise:screen): what is not a valid picture is rejected: data that is not an object, a picture
// that is not an object, a runId that is not an id; the teacher's windows and who waits are dropped; a frame over 256 KiB is rejected by the hub
// and one under it passes.
func TestExercise_ScreenRejections(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	cr.panel.send(t, typeExWatch, `{"studentId":"`+cr.ana.String()+`"}`)
	cr.a.next(t, typeExWatch)

	rejected := 0
	for _, data := range []string{
		`null`, `{}`, `[]`, `"x"`, `{"runId":"` + run + `"}`, `{"runId":"` + run + `","screen":null}`, `{"runId":"` + run + `","screen":"$ ls"}`,
		`{"runId":"` + run + `","screen":[1]}`, `{"runId":"` + run + `","screen":7}`, `{"screen":{"tag":"div"}}`,
		`{"runId":"nope","screen":{"tag":"div"}}`, `{"runId":null,"screen":{"tag":"div"}}`, `{"runId":7,"screen":{"tag":"div"}}`,
	} {
		cr.a.send(t, typeExScreen, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	quiet(t, []string{typeExScreen}, cr.panel)

	cr.panel.send(t, typeExScreen, `{"runId":"`+run+`","screen":{"tag":"div"}}`)
	cr.presenter.send(t, typeExScreen, `{"runId":"`+run+`","screen":{"tag":"div"}}`)
	cr.d.send(t, typeExScreen, `{"runId":"`+run+`","screen":{"tag":"div"}}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 3 })
	assert.ElementsMatch(t, []string{"wrong-view", "wrong-view", "not-admitted"}, droppedFor(w, typeExScreen))

	pad := func(n int) string { return strings.Repeat("a", n) }
	big := `{"runId":"` + run + `","screen":{"tag":"div","children":["` + pad(256*1024) + `"]}}`
	cr.a.send(t, typeExScreen, big)
	rejected++
	eventually(t, func() bool { return rejectedCount(w) == rejected })
	assert.Equal(t, "too-large", w.logs.FilterMessage("classroom message rejected").All()[rejected-1].ContextMap()["reason"])
	quiet(t, []string{typeExScreen}, cr.panel)

	ok := `{"runId":"` + run + `","screen":{"tag":"div","children":["` + pad(200*1024) + `"]}}`
	cr.a.send(t, typeExScreen, ok)
	got := cr.panel.nextData(t, typeExScreen)
	assert.Equal(t, cr.ana.String(), got["studentId"], "a picture of 200 KiB passes")
}

// ---- progress ----

// Covers SPEC-065 CA-06, CA-14 and section 3.1 (live:exercise:progress): the progress of a student goes to the panel only, with the student and the
// moment of the server; no other student, no other tab of another student, the presentation window and who waits get it; the service kept it.
func TestExercise_ProgressGoesOnlyToThePanel(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)

	cr.a.send(t, typeExProgress, `{"runId":"`+run+`","met":2,"total":4,"last":"mkdir /srv/x"}`)
	got := cr.panel.nextData(t, typeExProgress)
	assert.Equal(t, []string{"at", "commands", "last", "lastCommandAt", "met", "runId", "studentId", "total"}, sortedKeys(got)) // SPEC-071 adds the commands
	assert.Equal(t, run, got["runId"])
	assert.Equal(t, cr.ana.String(), got["studentId"])
	assert.EqualValues(t, 2, got["met"])
	assert.EqualValues(t, 4, got["total"])
	assert.Equal(t, "mkdir /srv/x", got["last"])
	assert.Equal(t, "2026-10-14T19:00:00.000Z", got["at"], "the moment of the server")
	quiet(t, []string{typeExProgress}, cr.everyone()...)

	cr.b.send(t, typeExProgress, `{"runId":"`+run+`","met":0,"total":4}`)
	other := cr.panel.nextData(t, typeExProgress)
	assert.Equal(t, cr.bruno.String(), other["studentId"])
	assert.Equal(t, "", other["last"], "no last command: an empty text")
	quiet(t, []string{typeExProgress}, cr.everyone()...)
	assert.Len(t, w.svc.exerciseRecorded(), 2)
	assert.Equal(t, "mkdir /srv/x", w.svc.exerciseRecorded()[0].Last)
}

// Covers SPEC-065 CA-14 and section 3.1 (live:exercise:progress): a progress that is not valid sends nothing and is rejected: met above total, negative,
// a total above 100, a last command over 200 characters or with a control character, a runId that is not an id or not the round that runs, missing
// fields and fields of the wrong type. The panel, the presentation window and who waits are dropped.
func TestExercise_ProgressRejections(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	with := func(fields string) string { return `{"runId":"` + run + `",` + fields + `}` }

	rejected := 0
	for _, data := range []string{
		with(`"met":5,"total":4`), with(`"met":-1,"total":4`), with(`"met":0,"total":-1`), with(`"met":1,"total":101`), with(`"met":101,"total":101`),
		with(`"met":1,"total":2,"last":"` + strings.Repeat("a", 201) + `"`), with(`"met":1,"total":2,"last":"a\tb"`), with(`"met":1,"total":2,"last":"a\nb"`),
		with(`"met":1,"total":2,"last":"a\u0000b"`), with(`"met":1,"total":2,"last":7`), with(`"met":1,"total":2,"last":["ls"]`),
		with(`"met":"1","total":2`), with(`"met":1.5,"total":2`), with(`"met":1`), with(`"total":2`), with(`"met":null,"total":2`), `{"runId":"` + run + `"}`,
		`{"met":1,"total":2}`, `{"runId":"nope","met":1,"total":2}`, `{"runId":null,"met":1,"total":2}`, `{"runId":7,"met":1,"total":2}`,
		`{"runId":"` + uuid.NewString() + `","met":1,"total":2}`, `null`, `[]`, `"x"`, `{}`,
	} {
		cr.a.send(t, typeExProgress, data)
		rejected++
	}
	require.NoError(t, cr.a.conn.WriteJSON(obj{"type": typeExProgress}))
	rejected++
	eventually(t, func() bool { return rejectedCount(w) == rejected })
	assert.Empty(t, w.svc.exerciseRecorded(), "none was kept")
	quiet(t, []string{typeExProgress}, cr.panel)

	// 200 characters and a total of 100 are the most
	cr.a.send(t, typeExProgress, with(`"met":100,"total":100,"last":"`+strings.Repeat("a", 200)+`"`))
	got := cr.panel.nextData(t, typeExProgress)
	assert.EqualValues(t, 100, got["met"])
	assert.Len(t, got["last"], 200)

	cr.panel.send(t, typeExProgress, with(`"met":1,"total":2`))
	cr.presenter.send(t, typeExProgress, with(`"met":1,"total":2`))
	cr.d.send(t, typeExProgress, with(`"met":1,"total":2`))
	eventually(t, func() bool { return len(droppedFor(w, typeExProgress)) == 3 })
	assert.ElementsMatch(t, []string{"wrong-view", "wrong-view", "not-admitted"}, droppedFor(w, typeExProgress))
	assert.Len(t, w.svc.exerciseRecorded(), 1, "only the valid one")
}

// Covers SPEC-065 CA-14: the progress counts against the rate limit of its sender.
func TestExercise_ProgressIsLimitedByRate(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)

	const burst = 80
	for i := 0; i < burst; i++ {
		cr.a.send(t, typeExProgress, `{"runId":"`+run+`","met":1,"total":2}`)
	}
	limited := func() int { return len(droppedFor(w, typeExProgress)) }
	eventually(t, func() bool { return len(w.svc.exerciseRecorded())+limited() == burst })
	assert.Positive(t, limited(), "some of the burst was dropped")
	assert.Positive(t, len(w.svc.exerciseRecorded()), "and the first ones were not")
	for _, reason := range droppedFor(w, typeExProgress) {
		assert.Equal(t, "rate-limit", reason)
	}
}

// ---- rules of the hub ----

// Covers SPEC-065 CA-14 and section 3.1: each message has its limit: the teacher's messages and the progress are small (1 KiB) and one over it is
// rejected as too large; the messages that only the server sends are unknown to the hub and are dropped when a client sends them.
func TestExercise_RulesOfTheHub(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	long := strings.Repeat("a", 1100)

	cr.panel.send(t, typeExStart, `{"blockId":"`+cr.block.String()+`","index":1,"pad":"`+long+`"}`)
	cr.panel.send(t, typeExEnd, `{"pad":"`+long+`"}`)
	cr.panel.send(t, typeExReveal, `{"visible":true,"pad":"`+long+`"}`)
	cr.panel.send(t, typeExWatch, `{"studentId":null,"pad":"`+long+`"}`)
	cr.a.send(t, typeExProgress, `{"runId":"`+run+`","met":1,"total":2,"pad":"`+long+`"}`)
	eventually(t, func() bool { return rejectedCount(w) == 5 })
	for _, entry := range w.logs.FilterMessage("classroom message rejected").All() {
		assert.Equal(t, "too-large", entry.ContextMap()["reason"])
	}
	assert.Len(t, w.svc.exerciseStarts(), 1, "only the first start, the valid one")
	assert.Empty(t, w.svc.exerciseRecorded())

	for _, typ := range []string{typeExStarted, typeExEnded, typeExResult, typeExDone} {
		cr.panel.send(t, typ, `{"runId":"`+run+`"}`)
		cr.a.send(t, typ, `{"runId":"`+run+`"}`)
	}
	eventually(t, func() bool { return len(droppedReasons(w)) == 8 })
	for _, r := range droppedReasons(w) {
		assert.True(t, strings.HasSuffix(r, ":unknown-type"), r)
	}
	quiet(t, []string{typeExStarted, typeExEnded, typeExResult, typeExDone, typeExProgress, typeExWatch}, cr.everyone()...)
}

// ---- snapshot ----

func exerciseOfSnapshot(t *testing.T, snap map[string]any) map[string]any {
	t.Helper()
	require.Contains(t, snap, "exercise")
	ex, ok := snap["exercise"].(map[string]any)
	require.True(t, ok, "exercise is an object")
	return ex
}

// Covers SPEC-065 CA-12 and section 3.1 (instantâneo): with no round the panel and the students get "exercise": null and the presentation window
// has no such key.
func TestExercise_SnapshotWithNoRound(t *testing.T) {
	w := setup(t)
	panel := snapshotOf(t, w.dialView(t, "teacher", "panel"))
	assert.Contains(t, panel, "exercise")
	assert.Nil(t, panel["exercise"])
	student := snapshotOf(t, w.dial(t, "student"))
	assert.Contains(t, student, "exercise")
	assert.Nil(t, student["exercise"])
	presenter := snapshotOf(t, w.dialView(t, "teacher2", "presenter"))
	assert.NotContains(t, presenter, "exercise", "the presentation window gets nothing of the exercise")
}

// Covers SPEC-065 CA-06, CA-12 and section 3.1 (instantâneo): the snapshot has the round for each role: the student gets the round, his own result
// (myResult, null while he did not conclude) and nothing of the others; the panel gets the round and the progress of each student of the round; the
// presentation window gets no exercise; who waits gets only his admission state. The round that ended is told with who ended it, and with the result
// shown everybody gets the scoreboard.
func TestExercise_SnapshotByRole(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	started := cr.start(t)
	run := started["runId"].(string)
	cr.b.send(t, typeExProgress, `{"runId":"`+run+`","met":1,"total":4,"last":"ls"}`)
	cr.panel.next(t, typeExProgress)
	w.svc.setExerciseNow(exerciseNow.Add(95 * time.Second))
	code, body := w.call(t, "student", http.MethodPost, w.path("/exercise/submit"), obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code, body)

	// SPEC-071 adds the close and the pause
	base := []string{"blockId", "closedAt", "difficulty", "durationSeconds", "endedAt", "endedBy", "endsAt", "index", "now", "pausedSeconds", "resultVisible", "runId", "startedAt", "status", "title"}
	withKeys := func(extra ...string) []string {
		keys := append(append([]string(nil), base...), extra...)
		sort.Strings(keys)
		return keys
	}

	// a student who connects in the middle of the round: Ana concluded, Bruno did not
	ana := exerciseOfSnapshot(t, snapshotOf(t, w.dial(t, "student")))
	assert.Equal(t, withKeys("myResult", "takenOver"), sortedKeys(ana))
	assert.Equal(t, run, ana["runId"])
	assert.Equal(t, cr.block.String(), ana["blockId"])
	assert.Equal(t, "RUNNING", ana["status"])
	assert.Equal(t, "Criar a pasta", ana["title"])
	assert.Equal(t, "HARD", ana["difficulty"])
	assert.EqualValues(t, 300, ana["durationSeconds"])
	assert.Equal(t, "2026-10-14T19:00:00.000Z", ana["startedAt"])
	assert.Equal(t, "2026-10-14T19:05:00.000Z", ana["endsAt"])
	assert.Equal(t, "2026-10-14T19:01:35.000Z", ana["now"], "the hour of the server: the clock is corrected with it, and the time that is left comes from endsAt")
	assert.Nil(t, ana["endedBy"])
	assert.Nil(t, ana["endedAt"])
	assert.Equal(t, false, ana["resultVisible"])
	mine := ana["myResult"].(map[string]any)
	assert.Equal(t, []string{"completedAt", "elapsedSeconds", "points"}, sortedKeys(mine))
	assert.Equal(t, "2026-10-14T19:01:35.000Z", mine["completedAt"])
	assert.EqualValues(t, 95, mine["elapsedSeconds"])
	assert.EqualValues(t, 40, mine["points"])

	bruno := exerciseOfSnapshot(t, snapshotOf(t, w.dial(t, "stranger")))
	assert.Equal(t, withKeys("myResult", "takenOver"), sortedKeys(bruno), "no progress and no result of the others")
	assert.Nil(t, bruno["myResult"], "Bruno did not conclude")

	panelWindow := w.dialView(t, "teacher", "panel") // it takes the control from the panel of the room: the commands below are its own
	panel := exerciseOfSnapshot(t, snapshotOf(t, panelWindow))
	assert.Equal(t, withKeys("progress"), sortedKeys(panel))
	list := panel["progress"].([]any)
	require.Len(t, list, 3, "the three students of the round")
	rows := map[string]map[string]any{}
	for _, row := range list {
		entry := row.(map[string]any)
		assert.Equal(t, []string{"at", "attempts", "commands", "completedAt", "elapsedSeconds", "helpRequested", "last", "lastCommandAt", "met", "name", "points", "status", "studentId",
			"takenOver", "takeoverOn", "total"}, sortedKeys(entry)) // SPEC-071 adds the commands, the status, the help and the takeover
		rows[entry["name"].(string)] = entry
	}
	assert.Equal(t, "2026-10-14T19:00:00.000Z", rows["Bruno"]["at"])
	assert.Equal(t, "ls", rows["Bruno"]["last"])
	assert.EqualValues(t, 1, rows["Bruno"]["met"])
	assert.EqualValues(t, 4, rows["Bruno"]["total"])
	assert.Nil(t, rows["Bruno"]["completedAt"])
	assert.Nil(t, rows["Bruno"]["points"])
	assert.Equal(t, cr.ana.String(), rows["Ana"]["studentId"])
	assert.Equal(t, "2026-10-14T19:01:35.000Z", rows["Ana"]["completedAt"])
	assert.EqualValues(t, 95, rows["Ana"]["elapsedSeconds"])
	assert.EqualValues(t, 40, rows["Ana"]["points"])
	assert.EqualValues(t, 1, rows["Ana"]["attempts"])
	assert.Nil(t, rows["Carla"]["at"], "Carla sent no progress")
	assert.EqualValues(t, 0, rows["Carla"]["met"])
	assert.Equal(t, "", rows["Carla"]["last"])

	presenter := snapshotOf(t, w.dialView(t, "teacher2", "presenter"))
	assert.NotContains(t, presenter, "exercise")

	w.svc.setExerciseNow(exerciseNow.Add(2 * time.Minute))
	sendMsg(t, panelWindow, typeExEnd, `{}`)
	readUntil(t, panelWindow, typeExEnded)
	ended := exerciseOfSnapshot(t, snapshotOf(t, w.dial(t, "second")))
	assert.Equal(t, withKeys("myResult", "takenOver"), sortedKeys(ended), "ended and hidden: no scoreboard")
	assert.Equal(t, "ENDED", ended["status"])
	assert.Equal(t, "TEACHER", ended["endedBy"])
	assert.Equal(t, "2026-10-14T19:02:00.000Z", ended["endedAt"])
	assert.Equal(t, "2026-10-14T19:01:35.000Z", ended["myResult"].(map[string]any)["completedAt"], "the result of the student, always")

	sendMsg(t, panelWindow, typeExReveal, `{"visible":true}`)
	readUntil(t, panelWindow, typeExResult)
	for name, snap := range map[string]map[string]any{
		"student": snapshotOf(t, w.dial(t, "student")), "other student": snapshotOf(t, w.dial(t, "stranger")), "panel": snapshotOf(t, w.dialView(t, "teacher", "panel")),
	} {
		ex := exerciseOfSnapshot(t, snap)
		assert.True(t, ex["resultVisible"].(bool), name)
		result := ex["result"].(map[string]any)
		assert.Equal(t, []string{"completed", "participants", "runId", "scoreboard", "visible"}, sortedKeys(result), name)
		assert.EqualValues(t, 1, result["completed"], name)
		assert.EqualValues(t, 3, result["participants"], name)
		board := result["scoreboard"].([]any)
		require.Len(t, board, 1, name)
		assert.Equal(t, "Ana", board[0].(map[string]any)["name"], name)
	}
	assert.NotContains(t, snapshotOf(t, w.dialView(t, "teacher2", "presenter")), "exercise", "the presentation window never gets it")

	// who waits gets the admission state and no snapshot
	d := newTap(w.dial(t, "waiting"))
	assert.Equal(t, "WAITING", statusOf(t, d.next(t, "live:admission:state")))
	quiet(t, []string{"live:snapshot", typeExStarted}, d)
}

// Covers SPEC-065 CA-12 and section 3.1: a student admitted in the middle of a round gets the round in the snapshot of his admission, with his own
// result, and nothing of the others.
func TestExercise_AdmittedStudentGetsTheRound(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	w.svc.exercise.names = map[uuid.UUID]string{w.student.UserID: "Ana"}
	w.svc.exercise.onEnded = w.h.ExerciseEnded
	block := uuid.New()
	sendMsg(t, teacher, typeExStart, `{"blockId":"`+block.String()+`","index":0}`)
	started := dataOf(t, readUntil(t, teacher, typeExStarted))

	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")
	sendMsg(t, teacher, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	snap := snapshotOf(t, student)
	ex := exerciseOfSnapshot(t, snap)
	assert.Equal(t, started["runId"], ex["runId"])
	assert.Equal(t, "RUNNING", ex["status"])
	assert.Contains(t, ex, "myResult")
	assert.NotContains(t, ex, "progress")
	eventually(t, func() bool {
		w.svc.mu.Lock()
		defer w.svc.mu.Unlock()
		return len(w.svc.exercise.joins) == 1 && w.svc.exercise.joins[0] == w.student.UserID
	})
}

// waitUntilOffline takes the presence that the panel gets until the student is no longer among the ones who are online.
func waitUntilOffline(t *testing.T, panel *tap, student uuid.UUID) {
	t.Helper()
	for i := 0; i < 20; i++ {
		var d struct {
			OnlineStudents []string `json:"onlineStudents"`
		}
		require.NoError(t, json.Unmarshal(panel.next(t, "live:presence").Data, &d))
		if !contains(d.OnlineStudents, student.String()) {
			return
		}
	}
	require.FailNow(t, "the student is still online", student.String())
}

func contains(list []string, item string) bool {
	for _, s := range list {
		if s == item {
			return true
		}
	}
	return false
}

// Covers SPEC-065 CA-12 and section 3.1: a student who joins or comes back during the round is in it (the service is told), and the student whom
// the teacher is watching is told, when he comes back, that he is watched, so that he sends the picture again; one who is not watched is told
// nothing.
func TestExercise_JoiningStudentIsInTheRound(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.start(t)
	cr.panel.send(t, typeExWatch, `{"studentId":"`+cr.bruno.String()+`"}`)
	cr.b.next(t, typeExWatch)

	_ = cr.b.conn.Close()
	waitUntilOffline(t, cr.panel, cr.bruno)
	back := newTap(w.dial(t, "stranger"))
	snap := exerciseOfSnapshot(t, snapshotOf2(t, back))
	assert.Equal(t, "RUNNING", snap["status"])
	assert.JSONEq(t, `{"on":true}`, string(back.next(t, typeExWatch).Data), "he is still watched")
	eventually(t, func() bool {
		w.svc.mu.Lock()
		defer w.svc.mu.Unlock()
		for _, id := range w.svc.exercise.joins {
			if id == cr.bruno {
				return true
			}
		}
		return false
	})

	late := newTap(w.dial(t, "student")) // Ana, in a third tab: she is not watched
	late.next(t, "live:snapshot")
	quiet(t, []string{typeExWatch}, late)
}

// snapshotOf2 is the snapshot that a tapped connection got.
func snapshotOf2(t *testing.T, p *tap) map[string]any {
	t.Helper()
	var snap map[string]any
	require.NoError(t, json.Unmarshal(p.next(t, "live:snapshot").Data, &snap))
	return snap
}

// Covers SPEC-065 section 3.1 (instantâneo): GET /classes/:id/live/active does not change: no exercise.
func TestExercise_ActiveRouteIsTheSame(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.start(t)
	for _, token := range []string{"teacher", "student"} {
		code, body := w.call(t, token, http.MethodGet, w.path("/active"), nil)
		require.Equal(t, http.StatusOK, code)
		assert.NotContains(t, body, "exercise", token)
		assert.Contains(t, body, "onlineCount", token)
	}
}

// ---- the route of the conferência ----

// exerciseClock is the clock of the limiter of the route, in the hands of the test.
type exerciseClock struct {
	mu sync.Mutex
	at time.Time
}

func (c *exerciseClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *exerciseClock) advance(d time.Duration) {
	c.mu.Lock()
	c.at = c.at.Add(d)
	c.mu.Unlock()
}

// setupExercise is setup with the limiter of the route on a clock that the test moves.
func setupExercise(t *testing.T) (*world, *exerciseClock) {
	t.Helper()
	clock := &exerciseClock{at: exerciseNow}
	core, logs := observer.New(zap.WarnLevel)
	w := &world{svc: &fakeService{}, logs: logs, class: uuid.New()}
	w.teacher = authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher}
	w.student = authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}
	w.stranger = authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}
	val := validator{people: map[string]authn.Principal{"teacher": w.teacher, "student": w.student, "second": w.student, "teacher2": {UserID: w.teacher.UserID, Role: authn.RoleTeacher}, "stranger": w.stranger}}
	w.session = domain.LiveClassroomSession{Model: database.Model{ID: uuid.New()}, ClassID: w.class, TeacherID: w.teacher.UserID, Title: "Aula",
		DisplayMode: domain.ModeSlides, CurrentSlide: 2, Status: domain.StatusActive, StartedAt: exerciseNow}
	w.svc.session = w.session
	w.svc.stage = service.StageView{Zoom: 1}
	w.svc.active = service.Active{Found: true, Session: w.session}
	w.people = val.people
	limiter := ratelimit.NewWithClock(1, 2*time.Second, clock.now)
	w.h = handler.New(w.svc, val, zap.New(core), handler.Options{SubmitLimiter: limiter})
	w.srv = httptest.NewServer(server.NewEngine(zap.NewNop(), nil, w.h))
	t.Cleanup(w.srv.Close)
	return w, clock
}

func (w *world) submit(t *testing.T, token string, body any) (int, map[string]any) {
	t.Helper()
	return w.call(t, token, http.MethodPost, w.path("/exercise/submit"), body)
}

// Covers SPEC-065 CA-04, CA-11 and section 3.1 (Conferência): a student whose state meets the conditions gets {passed, completedAt, elapsedSeconds,
// points}, and only then the panel is told "done" with his name, time, points and attempts; the other students and the presentation window are not;
// a student who sends again, 2 seconds later, gets the same result and nobody is told again; a state that does not pass gets {passed:false} and
// nothing else, and tells the panel nothing.
func TestExerciseSubmit_ApprovedTellsThePanelOnce(t *testing.T) {
	w, clock := setupExercise(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)

	code, body := w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, map[string]any{"passed": false}, body, "it does not say what is missing, and says nothing else")
	quiet(t, []string{typeExDone}, cr.everyone()...)

	clock.advance(3 * time.Second)
	w.svc.setExerciseNow(exerciseNow.Add(95 * time.Second))
	code, body = w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []string{"completedAt", "elapsedSeconds", "passed", "points"}, sortedKeys(body))
	assert.Equal(t, true, body["passed"])
	assert.Equal(t, "2026-10-14T19:01:35.000Z", body["completedAt"])
	assert.EqualValues(t, 95, body["elapsedSeconds"])
	assert.EqualValues(t, 40, body["points"])

	done := cr.panel.nextData(t, typeExDone)
	assert.Equal(t, []string{"attempts", "completedAt", "elapsedSeconds", "name", "points", "runId", "studentId"}, sortedKeys(done))
	assert.Equal(t, run, done["runId"])
	assert.Equal(t, cr.ana.String(), done["studentId"])
	assert.Equal(t, "Ana", done["name"])
	assert.Equal(t, "2026-10-14T19:01:35.000Z", done["completedAt"])
	assert.EqualValues(t, 95, done["elapsedSeconds"])
	assert.EqualValues(t, 40, done["points"])
	assert.EqualValues(t, 2, done["attempts"], "the one that failed and the one that passed")
	quiet(t, []string{typeExDone}, cr.everyone()...) // only the panel got it, once

	clock.advance(3 * time.Second)
	code, again := w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, body, again, "the same result")
	clock.advance(3 * time.Second)
	code, again = w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, body, again, "whatever state he sends after he concluded")
	quiet(t, []string{typeExDone}, cr.everyone()...) // nobody was told again
}

// Covers SPEC-065 CA-04, CA-10 and section 3.1: a student who concludes in the 2 seconds after the end, with the result already shown, tells the
// panel and the room again: the scoreboard that is shown must have him.
func TestExerciseSubmit_LateResultUpdatesTheShownScoreboard(t *testing.T) {
	w, _ := setupExercise(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	w.svc.setExerciseNow(exerciseNow.Add(60 * time.Second))
	cr.panel.send(t, typeExEnd, `{}`)
	cr.panel.next(t, typeExEnded)
	cr.panel.send(t, typeExReveal, `{"visible":true}`)
	first := cr.panel.nextData(t, typeExResult)
	assert.EqualValues(t, 0, first["completed"])
	assert.Len(t, first["scoreboard"], 0)
	for _, p := range cr.students() {
		assert.Equal(t, first, p.nextData(t, typeExResult))
	}

	w.svc.setExerciseNow(exerciseNow.Add(61 * time.Second))
	code, body := w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code, body)
	cr.panel.next(t, typeExDone)
	for name, p := range map[string]*tap{"panel": cr.panel, "A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		updated := p.nextData(t, typeExResult)
		assert.EqualValues(t, 1, updated["completed"], name)
		board := updated["scoreboard"].([]any)
		require.Len(t, board, 1, name)
		assert.Equal(t, "Ana", board[0].(map[string]any)["name"], name)
	}
	quiet(t, []string{typeExResult}, cr.everyone()...)
}

// Covers SPEC-065 CA-04, CA-14 and section 3.1 (Erros): the status of each refusal: 404 with no round (or a round that is not the current one),
// 409 for a round that ended and an exercise that is not available, 400 for a state that is not a machine, 403 for who is not a student admitted to
// the room, 401 with no session, 404 for a class that does not exist.
func TestExerciseSubmit_Statuses(t *testing.T) {
	w, clock := setupExercise(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	next := func() { clock.advance(3 * time.Second) } // the limiter takes one a student in 2 seconds

	code, body := w.submit(t, "student", obj{"runId": uuid.NewString(), "snapshot": "pass"})
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "exercise-run-not-found", body["type"], "a round that is not the one of the room")
	next()
	code, body = w.submit(t, "student", obj{"runId": run, "snapshot": "garbage"})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "validation-error", body["type"])
	next()
	for _, tc := range []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrExerciseEnded, http.StatusConflict, "exercise-ended"},
		{domain.ErrExerciseUnavailable, http.StatusConflict, "exercise-unavailable"},
		{domain.ErrNoExerciseRun, http.StatusNotFound, "exercise-run-not-found"},
		{domain.ErrNotAdmitted, http.StatusForbidden, "forbidden"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrNoActiveSession, http.StatusNotFound, "no-active-session"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrInvalidExerciseState, http.StatusBadRequest, "validation-error"},
		{domain.ErrExerciseRunning, http.StatusConflict, "exercise-running"},
		{assert.AnError, http.StatusInternalServerError, "internal-error"},
	} {
		w.svc.mu.Lock()
		w.svc.exercise.submitErr = tc.err
		w.svc.mu.Unlock()
		code, body = w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
		assert.Equal(t, tc.status, code, "%v", tc.err)
		assert.Equal(t, tc.typ, body["type"], "%v", tc.err)
		next()
	}
	w.svc.mu.Lock()
	w.svc.exercise.submitErr = nil
	w.svc.mu.Unlock()

	code, body = w.submit(t, "teacher", obj{"runId": run, "snapshot": "pass"})
	assert.Equal(t, http.StatusForbidden, code, "the teacher does not send")
	assert.Equal(t, "forbidden", body["type"])
	req, err := http.NewRequest(http.MethodPost, w.srv.URL+w.path("/exercise/submit"), strings.NewReader(`{"runId":"`+run+`","snapshot":"pass"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := w.srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode, "no session, no access")
	code, body = w.call(t, "student", http.MethodPost, "/api/v1/classes/not-a-uuid/live/exercise/submit", obj{"runId": run, "snapshot": "pass"})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-uuid", body["type"])
}

// Covers SPEC-065 CA-14 and section 3.1 (Conferência): what is not a valid body is 400 before the service is asked: not JSON, no runId, a runId that
// is not an id, no state, a null state.
func TestExerciseSubmit_BadBodies(t *testing.T) {
	w, clock := setupExercise(t)
	run := uuid.NewString()
	for name, body := range map[string]any{
		"not json":                "{broken",
		"empty":                   "",
		"no run":                  obj{"snapshot": "pass"},
		"a run that is not an id": obj{"runId": "nope", "snapshot": "pass"},
		"a null run":              obj{"runId": nil, "snapshot": "pass"},
		"no state":                obj{"runId": run},
		"a null state":            obj{"runId": run, "snapshot": nil},
		"a list":                  "[]",
	} {
		clock.advance(3 * time.Second)
		code, got := w.submit(t, "student", body)
		assert.Equal(t, http.StatusBadRequest, code, name)
		assert.NotEmpty(t, got["type"], name)
	}
	assert.Zero(t, w.svc.called("exercise:submit"), "the service was not asked")
}

// Covers SPEC-065 CA-14 and section 3.1 (Conferência): the state is up to 2 MB: one of 2 MB is taken and goes to the service; one over it is 413, and
// the service is not asked.
func TestExerciseSubmit_Limit2MB(t *testing.T) {
	w, clock := setupExercise(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	body := func(size int) string { // a JSON string of exactly `size` bytes with the quotes
		return `{"runId":"` + run + `","snapshot":"` + strings.Repeat("a", size-2) + `"}`
	}

	clock.advance(3 * time.Second)
	code, got := w.submit(t, "student", body(domain.MaxExerciseStateBytes))
	assert.Equal(t, http.StatusBadRequest, code, "2 MB is taken: it reached the service, which says it is not a machine")
	assert.Equal(t, "validation-error", got["type"])
	assert.Equal(t, 1, w.svc.called("exercise:submit"))

	clock.advance(3 * time.Second)
	code, got = w.submit(t, "student", body(domain.MaxExerciseStateBytes+1))
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)
	assert.Equal(t, "file-too-large", got["type"])
	clock.advance(3 * time.Second)
	code, got = w.submit(t, "student", body(domain.MaxExerciseStateBytes+100000))
	assert.Equal(t, http.StatusRequestEntityTooLarge, code, "and a body that is far over is stopped while it is read")
	assert.Equal(t, "file-too-large", got["type"])
	assert.Equal(t, 1, w.svc.called("exercise:submit"), "the service was not asked about the large ones")
}

// Covers SPEC-065 CA-14 and section 3.1 (Conferência): one submission each 2 seconds for each student: the second one in the window is 429 with the
// time to wait, the service is not asked, another student is not held back by it, and after 2 seconds the first may send again.
func TestExerciseSubmit_OnePerTwoSecondsPerStudent(t *testing.T) {
	w, clock := setupExercise(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)

	code, _ := w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusOK, code)
	code, body := w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusTooManyRequests, code)
	assert.Equal(t, "rate-limited", body["type"])
	assert.GreaterOrEqual(t, body["retryAfterSeconds"], float64(1), "the time to wait")
	assert.Equal(t, 1, w.svc.called("exercise:submit"), "the service was not asked the second time")

	code, _ = w.submit(t, "stranger", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusOK, code, "another student has his own")

	clock.advance(1900 * time.Millisecond)
	code, _ = w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusTooManyRequests, code, "still inside the 2 seconds")
	clock.advance(200 * time.Millisecond)
	code, _ = w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusOK, code, "2 seconds later")

	code, _ = w.submit(t, "teacher", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusForbidden, code)
	code, _ = w.submit(t, "teacher", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusForbidden, code, "the teacher is refused before the limiter, so he is never limited")
}
