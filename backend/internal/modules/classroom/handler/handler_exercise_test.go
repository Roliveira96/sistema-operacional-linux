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
			}
			for i := range results {
				if results[i].StudentID == id {
					e.Result, e.Attempts = &results[i], results[i].Attempts
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
	p := service.ExerciseProgress{RunID: in.RunID, StudentID: student, Met: in.Met, Total: in.Total, Last: last, At: d.at()}
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

// crowd is a room with three students (A with two tabs, B and C), the panel, the presentation window and one student who waits.
type crowd struct {
	w                 *world
	ana, bruno, carla uuid.UUID
	a, aTab, b, c, d  *websocket.Conn
	panel, presenter  *websocket.Conn
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
	cr.a, cr.aTab, cr.b, cr.c = w.dial(t, "student"), w.dial(t, "second"), w.dial(t, "stranger"), w.dial(t, "third")
	cr.panel, cr.presenter = w.dialView(t, "teacher", "panel"), w.dialView(t, "teacher2", "presenter")
	for _, conn := range []*websocket.Conn{cr.a, cr.aTab, cr.b, cr.c, cr.panel, cr.presenter} {
		readUntil(t, conn, "live:snapshot")
	}
	cr.d = w.dial(t, "waiting")
	readUntil(t, cr.d, "live:admission:state")
	return cr
}

func (cr *crowd) students() []*websocket.Conn { return []*websocket.Conn{cr.a, cr.aTab, cr.b, cr.c} }

// startData is the data of a start message for the block of the room, with the minutes when they are given.
func (cr *crowd) startData(index int, minutes ...int) string {
	data := `{"blockId":"` + cr.block.String() + `","index":` + strconv.Itoa(index)
	if len(minutes) > 0 {
		data += `,"minutes":` + strconv.Itoa(minutes[0])
	}
	return data + `}`
}

// start has the panel start the exercise and waits for the panel to be told; it returns what the panel was told.
func (cr *crowd) start(t *testing.T, minutes ...int) map[string]any {
	t.Helper()
	sendMsg(t, cr.panel, typeExStart, cr.startData(1, minutes...))
	return dataOf(t, readUntil(t, cr.panel, typeExStarted))
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
	sendMsg(t, cr.panel, typeExStart, cr.startData(1))
	started := dataOf(t, readUntil(t, cr.panel, typeExStarted))
	told := map[string]map[string]any{}
	for name, conn := range map[string]*websocket.Conn{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		told[name] = dataOf(t, readUntil(t, conn, typeExStarted))
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

	nothingMore(t, cr.presenter, typeExStarted)
	nothingMore(t, cr.d, typeExStarted)
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

	sendMsg(t, cr.presenter, typeExStart, cr.startData(1))
	sendMsg(t, cr.a, typeExStart, cr.startData(1))
	sendMsg(t, cr.d, typeExStart, cr.startData(1))
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
	for _, conn := range append(cr.students(), cr.panel, cr.presenter) {
		nothingMore(t, conn, typeExStarted)
	}
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
		sendMsg(t, cr.panel, typeExStart, data)
		atTheHandler++
	}
	require.NoError(t, cr.panel.WriteJSON(obj{"type": typeExStart}))
	atTheHandler++ // no data at all

	atTheService := 0
	for _, minutes := range []string{"0", "-1", "61", "1000"} {
		sendMsg(t, cr.panel, typeExStart, `{"blockId":"`+block+`","index":1,"minutes":`+minutes+`}`)
		atTheService++
	}
	eventually(t, func() bool { return rejectedCount(w) == atTheHandler+atTheService })
	for _, err := range []error{domain.ErrExerciseUnavailable, domain.ErrExerciseRunning, domain.ErrModuleNotSelected, domain.ErrSessionNotFound, domain.ErrForbidden} {
		w.svc.setExerciseError(err)
		sendMsg(t, cr.panel, typeExStart, cr.startData(1))
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
	for _, conn := range append(cr.students(), cr.panel, cr.presenter) {
		nothingMore(t, conn, typeExStarted)
	}

	// the first valid start is the first that tells anybody, and with a second one running it is refused again
	started := cr.start(t)
	assert.NotEmpty(t, started["runId"])
	sendMsg(t, cr.panel, typeExStart, cr.startData(1))
	eventually(t, func() bool { return rejectedCount(w) == atTheHandler+atTheService+1 })
	nothingMore(t, cr.b, typeExStarted)
}

// ---- end ----

// Covers SPEC-065 CA-03 and section 3.1 (live:exercise:end, live:exercise:ended): the teacher ends the round; the panel and the students are told
// who ended it and when, with the hour of the server; the presentation window and who waits are not; the student who was being watched is told
// that it stopped (on false) and nobody else; with no round, or from a student, nothing is sent.
func TestExercise_EndByTheTeacher(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)

	sendMsg(t, cr.panel, typeExEnd, `{}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
	nothingMore(t, cr.a, typeExEnded)

	started := cr.start(t)
	for _, conn := range cr.students() {
		readUntil(t, conn, typeExStarted)
	}
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+cr.bruno.String()+`"}`)
	assert.JSONEq(t, `{"on":true}`, string(readUntil(t, cr.b, typeExWatch).Data))

	sendMsg(t, cr.a, typeExEnd, `{}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExEnd)) == 1 })
	assert.Equal(t, []string{"not-controller"}, droppedFor(w, typeExEnd))

	w.svc.setExerciseNow(exerciseNow.Add(90 * time.Second))
	sendMsg(t, cr.panel, typeExEnd, `{}`)
	panel := dataOf(t, readUntil(t, cr.panel, typeExEnded))
	assert.Equal(t, []string{"by", "endedAt", "now", "runId"}, sortedKeys(panel))
	assert.Equal(t, started["runId"], panel["runId"])
	assert.Equal(t, "TEACHER", panel["by"])
	assert.Equal(t, "2026-10-14T19:01:30.000Z", panel["endedAt"])
	assert.Equal(t, "2026-10-14T19:01:30.000Z", panel["now"])
	for name, conn := range map[string]*websocket.Conn{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		assert.Equal(t, panel, dataOf(t, readUntil(t, conn, typeExEnded)), name)
	}
	assert.JSONEq(t, `{"on":false}`, string(readUntil(t, cr.b, typeExWatch).Data), "the observation ended with the round: Bruno is told")
	nothingMore(t, cr.a, typeExWatch)
	nothingMore(t, cr.c, typeExWatch)
	nothingMore(t, cr.presenter, typeExEnded, typeExWatch)
	nothingMore(t, cr.d, typeExEnded, typeExWatch)

	// the data may be empty, null or {}, and a second end has no round to end
	sendMsg(t, cr.panel, typeExEnd, `{}`)
	eventually(t, func() bool { return rejectedCount(w) == 2 })
}

// Covers SPEC-065 CA-03 and section 3.1 (Fim da rodada): when the time is up, the server ends the round by the timer with the room connected: the
// panel and every student are told "TIMER", at the end of its time; the watched student is told that it stopped; the presentation window and who
// waits are not; and what the students send after that is rejected.
func TestExercise_EndsByTheTimerWithTheRoomConnected(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	started := cr.start(t, 1)
	for _, conn := range cr.students() {
		readUntil(t, conn, typeExStarted)
	}
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+cr.ana.String()+`"}`)
	readUntil(t, cr.a, typeExWatch)
	readUntil(t, cr.aTab, typeExWatch)

	w.svc.fireTimer(w.session.ID)

	panel := dataOf(t, readUntil(t, cr.panel, typeExEnded))
	assert.Equal(t, started["runId"], panel["runId"])
	assert.Equal(t, "TIMER", panel["by"])
	assert.Equal(t, "2026-10-14T19:01:00.000Z", panel["endedAt"], "at the end of its time")
	for name, conn := range map[string]*websocket.Conn{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		assert.Equal(t, panel, dataOf(t, readUntil(t, conn, typeExEnded)), name)
	}
	assert.JSONEq(t, `{"on":false}`, string(readUntil(t, cr.a, typeExWatch).Data))
	assert.JSONEq(t, `{"on":false}`, string(readUntil(t, cr.aTab, typeExWatch).Data), "all the tabs of the watched student")
	nothingMore(t, cr.b, typeExWatch)
	nothingMore(t, cr.presenter, typeExEnded, typeExWatch)
	nothingMore(t, cr.d, typeExEnded)

	sendMsg(t, cr.b, typeExProgress, `{"runId":"`+started["runId"].(string)+`","met":1,"total":2}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
	nothingMore(t, cr.panel, typeExProgress)
}

// Covers SPEC-065 CA-03: a failure of the timer is logged, with "classroom exercise timer failed" and who it was for, and tells nobody.
func TestExercise_TimerFailureIsLogged(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	w.h.ExerciseFailed(w.session.ID, assert.AnError)
	entries := w.logs.FilterMessage("classroom exercise timer failed").All()
	require.Len(t, entries, 1)
	assert.Equal(t, w.session.ID.String(), entries[0].ContextMap()["room"])
	nothingMore(t, cr.panel, typeExEnded)
}

// ---- reveal ----

// Covers SPEC-065 CA-10 and section 3.1 (live:exercise:reveal, live:exercise:result): the teacher shows the result only when the round has ended: on
// a running round or with none it is refused; once ended, the panel and the students get the scoreboard (by points and then by time, with the names)
// and how many concluded of how many were in the round; hiding sends the result with no scoreboard; a student cannot do either.
func TestExercise_RevealOnlyWhenEnded(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	sendMsg(t, cr.panel, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })

	started := cr.start(t)
	for _, conn := range cr.students() {
		readUntil(t, conn, typeExStarted)
	}
	sendMsg(t, cr.panel, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return rejectedCount(w) == 2 })
	nothingMore(t, cr.a, typeExResult)

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
	sendMsg(t, cr.panel, typeExEnd, `{}`)
	readUntil(t, cr.panel, typeExEnded)

	sendMsg(t, cr.a, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExReveal)) == 1 })
	assert.Equal(t, []string{"not-controller"}, droppedFor(w, typeExReveal))
	sendMsg(t, cr.presenter, typeExReveal, `{"visible":true}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExReveal)) == 2 })
	assert.Equal(t, "wrong-view", droppedFor(w, typeExReveal)[1])

	sendMsg(t, cr.panel, typeExReveal, `{"visible":true}`)
	shown := dataOf(t, readUntil(t, cr.panel, typeExResult))
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
	for name, conn := range map[string]*websocket.Conn{"A": cr.a, "A tab": cr.aTab, "B": cr.b, "C": cr.c} {
		assert.Equal(t, shown, dataOf(t, readUntil(t, conn, typeExResult)), name)
	}
	nothingMore(t, cr.presenter, typeExResult)
	nothingMore(t, cr.d, typeExResult)

	sendMsg(t, cr.panel, typeExReveal, `{"visible":false}`)
	hidden := dataOf(t, readUntil(t, cr.panel, typeExResult))
	assert.Equal(t, []string{"completed", "participants", "runId", "visible"}, sortedKeys(hidden), "hidden: no scoreboard")
	assert.Equal(t, false, hidden["visible"])
	assert.EqualValues(t, 3, hidden["completed"])
	assert.Equal(t, hidden, dataOf(t, readUntil(t, cr.b, typeExResult)))

	for _, data := range []string{`{}`, `null`, `[]`, `{"visible":"yes"}`, `{"visible":1}`, `{"visible":null}`, `"visible"`} {
		before := rejectedCount(w)
		sendMsg(t, cr.panel, typeExReveal, data)
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

	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+ana+`"}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
	nothingMore(t, cr.a, typeExWatch)

	cr.start(t)
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+ana+`"}`)
	assert.JSONEq(t, `{"on":true}`, string(readUntil(t, cr.a, typeExWatch).Data))
	assert.JSONEq(t, `{"on":true}`, string(readUntil(t, cr.aTab, typeExWatch).Data), "every tab of the student")
	nothingMore(t, cr.b, typeExWatch)
	nothingMore(t, cr.c, typeExWatch)
	nothingMore(t, cr.presenter, typeExWatch)
	nothingMore(t, cr.d, typeExWatch)

	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+bruno+`"}`)
	assert.JSONEq(t, `{"on":false}`, string(readUntil(t, cr.a, typeExWatch).Data), "Ana is no longer watched")
	assert.JSONEq(t, `{"on":false}`, string(readUntil(t, cr.aTab, typeExWatch).Data))
	assert.JSONEq(t, `{"on":true}`, string(readUntil(t, cr.b, typeExWatch).Data))
	nothingMore(t, cr.c, typeExWatch)

	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+bruno+`"}`)
	assert.JSONEq(t, `{"on":true}`, string(readUntil(t, cr.b, typeExWatch).Data), "the same again: still on")
	nothingMore(t, cr.a, typeExWatch)

	sendMsg(t, cr.panel, typeExWatch, `{"studentId":null}`)
	assert.JSONEq(t, `{"on":false}`, string(readUntil(t, cr.b, typeExWatch).Data))
	nothingMore(t, cr.a, typeExWatch)
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":null}`)
	nothingMore(t, cr.b, typeExWatch)

	// refused: a student that is not in the round, the waiting one, bad data
	rejected := rejectedCount(w)
	for _, data := range []string{
		`{"studentId":"` + uuid.NewString() + `"}`, `{"studentId":"` + w.teacher.UserID.String() + `"}`, `{"studentId":"` + cr.waiting.UserID.String() + `"}`,
		`{}`, `null`, `[]`, `"x"`, `{"studentId":"not-a-uuid"}`, `{"studentId":""}`, `{"studentId":7}`, `{"studentId":true}`,
	} {
		sendMsg(t, cr.panel, typeExWatch, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	for _, conn := range []*websocket.Conn{cr.a, cr.b, cr.c, cr.presenter} {
		nothingMore(t, conn, typeExWatch)
	}

	sendMsg(t, cr.a, typeExWatch, `{"studentId":"`+ana+`"}`)
	sendMsg(t, cr.presenter, typeExWatch, `{"studentId":"`+ana+`"}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExWatch)) == 2 })
	assert.ElementsMatch(t, []string{"not-controller", "wrong-view"}, droppedFor(w, typeExWatch))
	nothingMore(t, cr.a, typeExWatch)
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
	sendMsg(t, cr.a, typeExScreen, screen("a"))
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 1 })
	assert.Equal(t, []string{"not-watched"}, droppedFor(w, typeExScreen))
	nothingMore(t, cr.panel, typeExScreen)

	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+cr.ana.String()+`"}`)
	readUntil(t, cr.a, typeExWatch)
	sendMsg(t, cr.a, typeExScreen, screen("a"))
	got := dataOf(t, readUntil(t, cr.panel, typeExScreen))
	assert.Equal(t, []string{"screen", "studentId"}, sortedKeys(got))
	assert.Equal(t, cr.ana.String(), got["studentId"])
	assert.JSONEq(t, `{"tag":"div","children":["$ ls a"]}`, mustJSON(got["screen"]), "the picture as it came, with no runId")
	for _, conn := range []*websocket.Conn{cr.b, cr.c, cr.aTab, cr.presenter, cr.d} {
		nothingMore(t, conn, typeExScreen)
	}

	// Ana's other tab is Ana too: her picture passes
	sendMsg(t, cr.aTab, typeExScreen, screen("tab"))
	assert.Equal(t, cr.ana.String(), dataOf(t, readUntil(t, cr.panel, typeExScreen))["studentId"])

	// B is not watched: dropped; the panel sees nothing
	sendMsg(t, cr.b, typeExScreen, screen("b"))
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 2 })
	nothingMore(t, cr.panel, typeExScreen)

	// a picture of the round that is not this one is dropped too
	sendMsg(t, cr.a, typeExScreen, `{"runId":"`+uuid.NewString()+`","screen":{"tag":"div"}}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 3 })
	nothingMore(t, cr.panel, typeExScreen)

	// the switch: Ana is dropped, Bruno passes
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+cr.bruno.String()+`"}`)
	readUntil(t, cr.b, typeExWatch)
	sendMsg(t, cr.a, typeExScreen, screen("a"))
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 4 })
	sendMsg(t, cr.b, typeExScreen, screen("b"))
	assert.Equal(t, cr.bruno.String(), dataOf(t, readUntil(t, cr.panel, typeExScreen))["studentId"])
	nothingMore(t, cr.a, typeExScreen)
	nothingMore(t, cr.c, typeExScreen)

	// stopping: nobody is watched any more
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":null}`)
	sendMsg(t, cr.b, typeExScreen, screen("b"))
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
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+cr.ana.String()+`"}`)
	readUntil(t, cr.a, typeExWatch)

	rejected := 0
	for _, data := range []string{
		`null`, `{}`, `[]`, `"x"`, `{"runId":"` + run + `"}`, `{"runId":"` + run + `","screen":null}`, `{"runId":"` + run + `","screen":"$ ls"}`,
		`{"runId":"` + run + `","screen":[1]}`, `{"runId":"` + run + `","screen":7}`, `{"screen":{"tag":"div"}}`,
		`{"runId":"nope","screen":{"tag":"div"}}`, `{"runId":null,"screen":{"tag":"div"}}`, `{"runId":7,"screen":{"tag":"div"}}`,
	} {
		sendMsg(t, cr.a, typeExScreen, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	nothingMore(t, cr.panel, typeExScreen)

	sendMsg(t, cr.panel, typeExScreen, `{"runId":"`+run+`","screen":{"tag":"div"}}`)
	sendMsg(t, cr.presenter, typeExScreen, `{"runId":"`+run+`","screen":{"tag":"div"}}`)
	sendMsg(t, cr.d, typeExScreen, `{"runId":"`+run+`","screen":{"tag":"div"}}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExScreen)) == 3 })
	assert.ElementsMatch(t, []string{"wrong-view", "wrong-view", "not-admitted"}, droppedFor(w, typeExScreen))

	pad := func(n int) string { return strings.Repeat("a", n) }
	big := `{"runId":"` + run + `","screen":{"tag":"div","children":["` + pad(256*1024) + `"]}}`
	sendMsg(t, cr.a, typeExScreen, big)
	rejected++
	eventually(t, func() bool { return rejectedCount(w) == rejected })
	assert.Equal(t, "too-large", w.logs.FilterMessage("classroom message rejected").All()[rejected-1].ContextMap()["reason"])
	nothingMore(t, cr.panel, typeExScreen)

	ok := `{"runId":"` + run + `","screen":{"tag":"div","children":["` + pad(200*1024) + `"]}}`
	sendMsg(t, cr.a, typeExScreen, ok)
	got := dataOf(t, readUntil(t, cr.panel, typeExScreen))
	assert.Equal(t, cr.ana.String(), got["studentId"], "a picture of 200 KiB passes")
}

// ---- progress ----

// Covers SPEC-065 CA-06, CA-14 and section 3.1 (live:exercise:progress): the progress of a student goes to the panel only, with the student and the
// moment of the server; no other student, no other tab of another student, the presentation window and who waits get it; the service kept it.
func TestExercise_ProgressGoesOnlyToThePanel(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	for _, conn := range cr.students() {
		readUntil(t, conn, typeExStarted)
	}

	sendMsg(t, cr.a, typeExProgress, `{"runId":"`+run+`","met":2,"total":4,"last":"mkdir /srv/x"}`)
	got := dataOf(t, readUntil(t, cr.panel, typeExProgress))
	assert.Equal(t, []string{"at", "last", "met", "runId", "studentId", "total"}, sortedKeys(got))
	assert.Equal(t, run, got["runId"])
	assert.Equal(t, cr.ana.String(), got["studentId"])
	assert.EqualValues(t, 2, got["met"])
	assert.EqualValues(t, 4, got["total"])
	assert.Equal(t, "mkdir /srv/x", got["last"])
	assert.Equal(t, "2026-10-14T19:00:00.000Z", got["at"], "the moment of the server")
	for _, conn := range []*websocket.Conn{cr.aTab, cr.b, cr.c, cr.presenter, cr.d} {
		nothingMore(t, conn, typeExProgress)
	}

	sendMsg(t, cr.b, typeExProgress, `{"runId":"`+run+`","met":0,"total":4}`)
	other := dataOf(t, readUntil(t, cr.panel, typeExProgress))
	assert.Equal(t, cr.bruno.String(), other["studentId"])
	assert.Equal(t, "", other["last"], "no last command: an empty text")
	nothingMore(t, cr.a, typeExProgress)
	nothingMore(t, cr.c, typeExProgress)
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
		sendMsg(t, cr.a, typeExProgress, data)
		rejected++
	}
	require.NoError(t, cr.a.WriteJSON(obj{"type": typeExProgress}))
	rejected++
	eventually(t, func() bool { return rejectedCount(w) == rejected })
	assert.Empty(t, w.svc.exerciseRecorded(), "none was kept")
	nothingMore(t, cr.panel, typeExProgress)

	// 200 characters and a total of 100 are the most
	sendMsg(t, cr.a, typeExProgress, with(`"met":100,"total":100,"last":"`+strings.Repeat("a", 200)+`"`))
	got := dataOf(t, readUntil(t, cr.panel, typeExProgress))
	assert.EqualValues(t, 100, got["met"])
	assert.Len(t, got["last"], 200)

	sendMsg(t, cr.panel, typeExProgress, with(`"met":1,"total":2`))
	sendMsg(t, cr.presenter, typeExProgress, with(`"met":1,"total":2`))
	sendMsg(t, cr.d, typeExProgress, with(`"met":1,"total":2`))
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
		sendMsg(t, cr.a, typeExProgress, `{"runId":"`+run+`","met":1,"total":2}`)
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

	sendMsg(t, cr.panel, typeExStart, `{"blockId":"`+cr.block.String()+`","index":1,"pad":"`+long+`"}`)
	sendMsg(t, cr.panel, typeExEnd, `{"pad":"`+long+`"}`)
	sendMsg(t, cr.panel, typeExReveal, `{"visible":true,"pad":"`+long+`"}`)
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":null,"pad":"`+long+`"}`)
	sendMsg(t, cr.a, typeExProgress, `{"runId":"`+run+`","met":1,"total":2,"pad":"`+long+`"}`)
	eventually(t, func() bool { return rejectedCount(w) == 5 })
	for _, entry := range w.logs.FilterMessage("classroom message rejected").All() {
		assert.Equal(t, "too-large", entry.ContextMap()["reason"])
	}
	assert.Len(t, w.svc.exerciseStarts(), 1, "only the first start, the valid one")
	assert.Empty(t, w.svc.exerciseRecorded())

	for _, typ := range []string{typeExStarted, typeExEnded, typeExResult, typeExDone} {
		sendMsg(t, cr.panel, typ, `{"runId":"`+run+`"}`)
		sendMsg(t, cr.a, typ, `{"runId":"`+run+`"}`)
	}
	eventually(t, func() bool { return len(droppedReasons(w)) == 8 })
	for _, r := range droppedReasons(w) {
		assert.True(t, strings.HasSuffix(r, ":unknown-type"), r)
	}
	nothingMore(t, cr.b, typeExStarted, typeExEnded, typeExResult, typeExDone)
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
	sendMsg(t, cr.b, typeExProgress, `{"runId":"`+run+`","met":1,"total":4,"last":"ls"}`)
	readUntil(t, cr.panel, typeExProgress)
	w.svc.setExerciseNow(exerciseNow.Add(95 * time.Second))
	code, body := w.call(t, "student", http.MethodPost, w.path("/exercise/submit"), obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code, body)

	base := []string{"blockId", "difficulty", "durationSeconds", "endedAt", "endedBy", "endsAt", "index", "now", "resultVisible", "runId", "startedAt", "status", "title"}
	withKeys := func(extra ...string) []string {
		keys := append(append([]string(nil), base...), extra...)
		sort.Strings(keys)
		return keys
	}

	// a student who connects in the middle of the round: Ana concluded, Bruno did not
	ana := exerciseOfSnapshot(t, snapshotOf(t, w.dial(t, "student")))
	assert.Equal(t, withKeys("myResult"), sortedKeys(ana))
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
	assert.Equal(t, withKeys("myResult"), sortedKeys(bruno), "no progress and no result of the others")
	assert.Nil(t, bruno["myResult"], "Bruno did not conclude")

	panelWindow := w.dialView(t, "teacher", "panel") // it takes the control from the panel of the room: the commands below are its own
	panel := exerciseOfSnapshot(t, snapshotOf(t, panelWindow))
	assert.Equal(t, withKeys("progress"), sortedKeys(panel))
	list := panel["progress"].([]any)
	require.Len(t, list, 3, "the three students of the round")
	rows := map[string]map[string]any{}
	for _, row := range list {
		entry := row.(map[string]any)
		assert.Equal(t, []string{"at", "attempts", "completedAt", "elapsedSeconds", "last", "met", "name", "points", "studentId", "total"}, sortedKeys(entry))
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
	assert.Equal(t, withKeys("myResult"), sortedKeys(ended), "ended and hidden: no scoreboard")
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
	d := w.dial(t, "waiting")
	assert.Equal(t, "WAITING", statusOf(t, readUntil(t, d, "live:admission:state")))
	nothingMore(t, d, "live:snapshot", typeExStarted)
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
}

// Covers SPEC-065 CA-12 and section 3.1: a student who joins or comes back during the round is in it (the service is told), and the student whom
// the teacher is watching is told, when he comes back, that he is watched, so that he sends the picture again; one who is not watched is told
// nothing.
func TestExercise_JoiningStudentIsInTheRound(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.start(t)
	sendMsg(t, cr.panel, typeExWatch, `{"studentId":"`+cr.bruno.String()+`"}`)
	readUntil(t, cr.b, typeExWatch)

	_ = cr.b.Close()
	waitUntilOffline(t, cr.panel, cr.bruno)
	back := w.dial(t, "stranger")
	snap := exerciseOfSnapshot(t, snapshotOf(t, back))
	assert.Equal(t, "RUNNING", snap["status"])
	assert.JSONEq(t, `{"on":true}`, string(readUntil(t, back, typeExWatch).Data), "he is still watched")
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

	late := w.dial(t, "student") // Ana, in a third tab: she is not watched
	readUntil(t, late, "live:snapshot")
	nothingMore(t, late, typeExWatch)
}

// waitUntilOffline reads the presence that the panel gets until the student is no longer among the ones who are online.
func waitUntilOffline(t *testing.T, panel *websocket.Conn, student uuid.UUID) {
	t.Helper()
	for i := 0; i < 20; i++ {
		var d struct {
			OnlineStudents []string `json:"onlineStudents"`
		}
		require.NoError(t, json.Unmarshal(readUntil(t, panel, "live:presence").Data, &d))
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
	for _, conn := range cr.students() {
		readUntil(t, conn, typeExStarted)
	}

	code, body := w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, map[string]any{"passed": false}, body, "it does not say what is missing, and says nothing else")
	nothingMore(t, cr.panel, typeExDone)

	clock.advance(3 * time.Second)
	w.svc.setExerciseNow(exerciseNow.Add(95 * time.Second))
	code, body = w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []string{"completedAt", "elapsedSeconds", "passed", "points"}, sortedKeys(body))
	assert.Equal(t, true, body["passed"])
	assert.Equal(t, "2026-10-14T19:01:35.000Z", body["completedAt"])
	assert.EqualValues(t, 95, body["elapsedSeconds"])
	assert.EqualValues(t, 40, body["points"])

	done := dataOf(t, readUntil(t, cr.panel, typeExDone))
	assert.Equal(t, []string{"attempts", "completedAt", "elapsedSeconds", "name", "points", "runId", "studentId"}, sortedKeys(done))
	assert.Equal(t, run, done["runId"])
	assert.Equal(t, cr.ana.String(), done["studentId"])
	assert.Equal(t, "Ana", done["name"])
	assert.Equal(t, "2026-10-14T19:01:35.000Z", done["completedAt"])
	assert.EqualValues(t, 95, done["elapsedSeconds"])
	assert.EqualValues(t, 40, done["points"])
	assert.EqualValues(t, 2, done["attempts"], "the one that failed and the one that passed")
	for _, conn := range []*websocket.Conn{cr.a, cr.aTab, cr.b, cr.c, cr.presenter, cr.d} {
		nothingMore(t, conn, typeExDone)
	}

	clock.advance(3 * time.Second)
	code, again := w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, body, again, "the same result")
	nothingMore(t, cr.panel, typeExDone)
	clock.advance(3 * time.Second)
	code, again = w.submit(t, "student", obj{"runId": run, "snapshot": "fail"})
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, body, again, "whatever state he sends after he concluded")
}

// Covers SPEC-065 CA-04, CA-10 and section 3.1: a student who concludes in the 2 seconds after the end, with the result already shown, tells the
// panel and the room again: the scoreboard that is shown must have him.
func TestExerciseSubmit_LateResultUpdatesTheShownScoreboard(t *testing.T) {
	w, _ := setupExercise(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	w.svc.setExerciseNow(exerciseNow.Add(60 * time.Second))
	sendMsg(t, cr.panel, typeExEnd, `{}`)
	readUntil(t, cr.panel, typeExEnded)
	sendMsg(t, cr.panel, typeExReveal, `{"visible":true}`)
	first := dataOf(t, readUntil(t, cr.panel, typeExResult))
	assert.EqualValues(t, 0, first["completed"])
	assert.Len(t, first["scoreboard"], 0)

	w.svc.setExerciseNow(exerciseNow.Add(61 * time.Second))
	code, body := w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code, body)
	readUntil(t, cr.panel, typeExDone)
	for name, conn := range map[string]*websocket.Conn{"panel": cr.panel, "A": cr.a, "B": cr.b} {
		updated := dataOf(t, readUntil(t, conn, typeExResult))
		assert.EqualValues(t, 1, updated["completed"], name)
		board := updated["scoreboard"].([]any)
		require.Len(t, board, 1, name)
		assert.Equal(t, "Ana", board[0].(map[string]any)["name"], name)
	}
	nothingMore(t, cr.presenter, typeExResult)
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
	code, _ = w.call(t, "nobody", http.MethodPost, w.path("/exercise/submit"), obj{"runId": run, "snapshot": "pass"})
	assert.Equal(t, http.StatusUnauthorized, code)
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
