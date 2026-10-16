package repository_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// ---- SPEC-065: the exercise of the lesson, from the websocket to the database ----

// The room of these tests is the real one: the repository on PostgreSQL, the service with its timer, the handler and the hub with their sockets.
// Only what belongs to other modules is a double: the content of the module (which exercise has which conditions) and the clock of the timer, which
// the test fires when it wants the time to be up.

type e2eValidator map[string]authn.Principal

func (v e2eValidator) Authenticate(_ context.Context, token string) (authn.Principal, error) {
	p, ok := v[token]
	if !ok {
		return authn.Principal{}, io.ErrUnexpectedEOF
	}
	return p, nil
}

type noStorage struct{}

func (noStorage) PutObject(context.Context, string, io.Reader, int64, string) error { return nil }
func (noStorage) GetObject(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(nil)), nil
}
func (noStorage) PresignedGetURL(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

// e2eExercises has one exercise, the first of one block of one module, graded by the state "pass" or "fail".
type e2eExercises struct{ module, block uuid.UUID }

func (f e2eExercises) Exercise(_ context.Context, module, block uuid.UUID, index int) (service.ExerciseSpec, error) {
	if module != f.module || block != f.block || index != 0 {
		return service.ExerciseSpec{}, domain.ErrExerciseUnavailable
	}
	return service.ExerciseSpec{Title: "Criar a pasta", Difficulty: domain.DifficultyHard}, nil
}

func (f e2eExercises) Grade(_ context.Context, _, _ uuid.UUID, _ int, snapshot json.RawMessage) (bool, error) {
	switch string(snapshot) {
	case `"pass"`:
		return true, nil
	case `"fail"`:
		return false, nil
	}
	return false, domain.ErrInvalidExerciseState
}

// e2eTimers keeps what the service scheduled and fires it when the test says the time is up.
type e2eTimers struct {
	mu     sync.Mutex
	timers []*e2eTimer
}

type e2eTimer struct {
	d       time.Duration
	f       func()
	stopped bool
}

func (ts *e2eTimers) after(d time.Duration, f func()) func() {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t := &e2eTimer{d: d, f: f}
	ts.timers = append(ts.timers, t)
	return func() {
		ts.mu.Lock()
		t.stopped = true
		ts.mu.Unlock()
	}
}

// fireLast runs the last timer that was scheduled, unless it was stopped; it reports whether it ran.
func (ts *e2eTimers) fireLast() bool {
	ts.mu.Lock()
	t := ts.timers[len(ts.timers)-1]
	stopped := t.stopped
	ts.mu.Unlock()
	if stopped {
		return false
	}
	t.f()
	return true
}

func (ts *e2eTimers) count() int {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return len(ts.timers)
}

type e2eClock struct {
	mu sync.Mutex
	at time.Time
}

func (c *e2eClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *e2eClock) advance(d time.Duration) {
	c.mu.Lock()
	c.at = c.at.Add(d)
	c.mu.Unlock()
}

type e2eMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// e2eConn is a websocket of the room that reads what it receives.
type e2eConn struct {
	t    *testing.T
	conn *websocket.Conn
}

func (c e2eConn) send(typ string, data any) {
	c.t.Helper()
	require.NoError(c.t, c.conn.WriteJSON(map[string]any{"type": typ, "data": data}))
}

// read waits for the next message of the type, skipping the others (the presence, the queue), and decodes its data.
func (c e2eConn) read(typ string) map[string]any {
	c.t.Helper()
	for i := 0; i < 40; i++ {
		require.NoError(c.t, c.conn.SetReadDeadline(time.Now().Add(3*time.Second)))
		var m e2eMessage
		require.NoError(c.t, c.conn.ReadJSON(&m), "waiting for %s", typ)
		if m.Type == typ {
			var out map[string]any
			require.NoError(c.t, json.Unmarshal(m.Data, &out))
			return out
		}
	}
	require.FailNow(c.t, "message not received", typ)
	return nil
}

// readAll reads until the connection is closed by the room, and returns the types in order.
func (c e2eConn) readAll() []string {
	c.t.Helper()
	var types []string
	for i := 0; i < 100; i++ {
		require.NoError(c.t, c.conn.SetReadDeadline(time.Now().Add(3*time.Second)))
		var m e2eMessage
		if err := c.conn.ReadJSON(&m); err != nil {
			return types
		}
		types = append(types, m.Type)
	}
	return types
}

// Covers SPEC-065 CA-01, CA-03, CA-04, CA-06, CA-07, CA-10, CA-11 and CA-12, all together, with the real service, handler, hub and database: the
// teacher opens the room and lets the students in, starts the exercise, the student reports his progress and is watched, concludes through the
// route, the panel is told and the result is kept in the database; the timer ends the round with the room connected; the teacher shows the
// result; a student who comes back finds the round ended and the scoreboard; a new round ends with the lesson, and the room is told before it is
// closed.
func TestLiveExercise_EndToEnd(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	bruno := e.newStudent(t, "1000002", "Bruno")
	class := e.newClass(t, "SO55E", e.student.ID, bruno.ID)
	module, block := uuid.New(), uuid.New()
	require.NoError(t, e.db.Conn(ctx).Exec(`INSERT INTO course_modules (id, teacher_id, title, description, visibility, status, created_at, updated_at)
        VALUES (?, ?, 'Linux', 'd', 'PUBLIC', 'ACTIVE', NOW(), NOW())`, module, e.teacher.ID).Error)

	people := e2eValidator{
		"teacher": {UserID: e.teacher.ID, Role: authn.RoleTeacher},
		"ana":     {UserID: e.student.ID, Role: authn.RoleStudent},
		"bruno":   {UserID: bruno.ID, Role: authn.RoleStudent},
	}
	timers := &e2eTimers{}
	clock := &e2eClock{at: time.Now().UTC()}
	svc := service.New(e.repo, noStorage{}, time.Now).WithExercises(e2eExercises{module, block}).WithExerciseTimer(timers.after)
	h := handler.New(svc, people, zap.NewNop(), handler.Options{SubmitLimiter: ratelimit.NewWithClock(1, 2*time.Second, clock.now)})
	svc.WithExerciseEvents(h.ExerciseEnded, h.ExerciseFailed).WithOnEnded(h.CloseRoom)
	srv := httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h))
	t.Cleanup(srv.Close)

	api := "/api/v1/classes/" + class.ID.String() + "/live"
	call := func(token, method, path string, body any) (int, map[string]any) {
		raw, _ := json.Marshal(body)
		req, err := http.NewRequest(method, srv.URL+api+path, bytes.NewReader(raw))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: token})
		res, err := srv.Client().Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		out := map[string]any{}
		_ = json.Unmarshal(data, &out)
		return res.StatusCode, out
	}
	dial := func(token, view string) e2eConn {
		url := "ws" + strings.TrimPrefix(srv.URL, "http") + api + "/ws"
		if view != "" {
			url += "?view=" + view
		}
		c, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Cookie": []string{authn.CookieName + "=" + token}})
		require.NoError(t, err)
		t.Cleanup(func() { _ = c.Close() })
		return e2eConn{t, c}
	}

	// the teacher opens the room in the module and the students come in after he lets them
	code, session := call("teacher", http.MethodPost, "/start", map[string]any{"title": "Aula", "initialModuleId": module})
	require.Equal(t, http.StatusCreated, code, session)
	room := uuid.MustParse(session["id"].(string))
	panel := dial("teacher", "panel")
	panel.read("live:snapshot")
	ana, br := dial("ana", ""), dial("bruno", "")
	ana.read("live:admission:state")
	br.read("live:admission:state")
	panel.send("live:admission:accept-all", map[string]any{})
	ana.read("live:snapshot")
	br.read("live:snapshot")

	// CA-01: the start, with the minutes; the panel and the students are told; the round is in the database
	panel.send("live:exercise:start", map[string]any{"blockId": block, "index": 0, "minutes": 1})
	started := panel.read("live:exercise:started")
	assert.Equal(t, "Criar a pasta", started["title"])
	assert.Equal(t, "HARD", started["difficulty"])
	assert.EqualValues(t, 60, started["durationSeconds"])
	assert.Equal(t, started, ana.read("live:exercise:started"))
	assert.Equal(t, started, br.read("live:exercise:started"))
	run := started["runId"].(string)
	current, err := e.repo.CurrentExerciseRun(ctx, room)
	require.NoError(t, err)
	assert.Equal(t, run, current.ID.String())
	assert.True(t, current.Running())
	assert.Equal(t, block, current.BlockID)
	require.Equal(t, 1, timers.count(), "the service armed the timer of the round")

	// CA-06 and CA-07: the progress goes to the panel, the teacher watches Ana and her picture reaches the panel
	ana.send("live:exercise:progress", map[string]any{"runId": run, "met": 1, "total": 2, "last": "mkdir /srv/x"})
	progress := panel.read("live:exercise:progress")
	assert.Equal(t, e.student.ID.String(), progress["studentId"])
	assert.Equal(t, "mkdir /srv/x", progress["last"])
	panel.send("live:exercise:watch", map[string]any{"studentId": e.student.ID})
	assert.Equal(t, true, ana.read("live:exercise:watch")["on"])
	ana.send("live:exercise:screen", map[string]any{"runId": run, "screen": map[string]any{"tag": "div", "children": []string{"$ mkdir /srv/x"}}})
	assert.Equal(t, e.student.ID.String(), panel.read("live:exercise:screen")["studentId"])

	// CA-04, CA-05, CA-11: the state that does not pass, and the one that does; the result is kept once, with what the route and the panel were told
	code, body := call("ana", http.MethodPost, "/exercise/submit", map[string]any{"runId": run, "snapshot": "fail"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, map[string]any{"passed": false}, body)
	clock.advance(3 * time.Second)
	code, body = call("ana", http.MethodPost, "/exercise/submit", map[string]any{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code, body)
	assert.Equal(t, true, body["passed"])
	points := body["points"].(float64)
	assert.GreaterOrEqual(t, points, 30.0, "at least the base of a hard exercise")
	assert.LessOrEqual(t, points, 45.0, "at most the base and the whole bonus")
	done := panel.read("live:exercise:done")
	assert.Equal(t, "Ana", done["name"])
	assert.EqualValues(t, points, done["points"])
	assert.EqualValues(t, 2, done["attempts"], "the state that failed and the one that passed")
	kept, err := e.repo.FindExerciseResult(ctx, current.ID, e.student.ID)
	require.NoError(t, err)
	assert.EqualValues(t, points, kept.Points)
	assert.EqualValues(t, body["elapsedSeconds"], kept.ElapsedSeconds)
	assert.Equal(t, 2, kept.Attempts)
	clock.advance(3 * time.Second)
	code, again := call("ana", http.MethodPost, "/exercise/submit", map[string]any{"runId": run, "snapshot": "pass"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, body, again, "a second submission is the same result")
	results, err := e.repo.ListExerciseResults(ctx, current.ID)
	require.NoError(t, err)
	assert.Len(t, results, 1, "and still one row")

	// CA-03: the time is up with the room connected: the timer ends the round, and the room is told, and the watched student too
	require.True(t, timers.fireLast())
	ended := panel.read("live:exercise:ended")
	assert.Equal(t, "TIMER", ended["by"])
	assert.Equal(t, started["endsAt"], ended["endedAt"], "at the end of its time")
	assert.Equal(t, ended, ana.read("live:exercise:ended"))
	assert.Equal(t, ended, br.read("live:exercise:ended"))
	assert.Equal(t, false, ana.read("live:exercise:watch")["on"], "the observation ended with the round")
	current, err = e.repo.FindExerciseRun(ctx, current.ID)
	require.NoError(t, err)
	require.NotNil(t, current.EndedBy)
	assert.Equal(t, domain.EndedByTimer, *current.EndedBy)

	// CA-10: the result is shown by the teacher, and the students get the scoreboard
	panel.send("live:exercise:reveal", map[string]any{"visible": true})
	shown := panel.read("live:exercise:result")
	assert.Equal(t, true, shown["visible"])
	assert.EqualValues(t, 1, shown["completed"])
	assert.EqualValues(t, 2, shown["participants"], "Ana and Bruno were online during the round")
	assert.Equal(t, shown, br.read("live:exercise:result"))
	board := shown["scoreboard"].([]any)
	require.Len(t, board, 1)
	assert.Equal(t, "Ana", board[0].(map[string]any)["name"])
	current, err = e.repo.FindExerciseRun(ctx, current.ID)
	require.NoError(t, err)
	assert.True(t, current.ResultVisible)

	// CA-12: Bruno comes back and finds the round ended, his result empty and the scoreboard shown
	back := dial("bruno", "")
	snap := back.read("live:snapshot")
	ex := snap["exercise"].(map[string]any)
	assert.Equal(t, "ENDED", ex["status"])
	assert.Equal(t, "TIMER", ex["endedBy"])
	assert.Equal(t, true, ex["resultVisible"])
	assert.Nil(t, ex["myResult"])
	assert.Len(t, ex["result"].(map[string]any)["scoreboard"], 1)

	// a server that comes back finds a round that is still running and arms its timer again (SPEC-065 section 3.1, Fim da rodada)
	panel.send("live:exercise:start", map[string]any{"blockId": block, "index": 0, "minutes": 2})
	second := panel.read("live:exercise:started")
	assert.NotEqual(t, run, second["runId"])
	timers2 := &e2eTimers{}
	restarted := service.New(e.repo, noStorage{}, time.Now).WithExercises(e2eExercises{module, block}).WithExerciseTimer(timers2.after)
	state, err := restarted.ExerciseOf(ctx, room, false)
	require.NoError(t, err)
	require.NotNil(t, state)
	assert.True(t, state.Run.Running())
	require.Equal(t, 1, timers2.count(), "the server that came back armed the timer of the round")
	assert.Greater(t, timers2.timers[0].d, time.Minute)
	assert.LessOrEqual(t, timers2.timers[0].d, 2*time.Minute)

	// CA-03: the lesson ends with the round running: the room is told that the round ended by the lesson before it is told that the lesson ended
	_ = back.conn.Close()
	br2 := dial("bruno", "")
	br2.read("live:snapshot")
	code, _ = call("teacher", http.MethodPost, "/sessions/"+room.String()+"/end", nil)
	require.Equal(t, http.StatusOK, code)
	types := br2.readAll()
	iEnded, iRoom := indexOf(types, "live:exercise:ended"), indexOf(types, "live:ended")
	require.GreaterOrEqual(t, iEnded, 0, "the round ended message came: %v", types)
	require.GreaterOrEqual(t, iRoom, 0, "and the room ended message too: %v", types)
	assert.Less(t, iEnded, iRoom, "in this order")
	latest, err := e.repo.CurrentExerciseRun(ctx, room)
	require.NoError(t, err)
	assert.Equal(t, second["runId"], latest.ID.String())
	require.NotNil(t, latest.EndedBy)
	assert.Equal(t, domain.EndedBySession, *latest.EndedBy)
}

func indexOf(list []string, item string) int {
	for i, s := range list {
		if s == item {
			return i
		}
	}
	return -1
}

// Covers SPEC-065 CA-04 and CA-11: the same student concluding many times at once keeps one result: the unique index of the database holds, and
// everybody gets that one result.
func TestLiveExercise_SimultaneousSubmissionsKeepOneResult(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	module, block := uuid.New(), uuid.New()
	require.NoError(t, e.db.Conn(ctx).Exec(`INSERT INTO course_modules (id, teacher_id, title, description, visibility, status, created_at, updated_at)
        VALUES (?, ?, 'Linux', 'd', 'PUBLIC', 'ACTIVE', NOW(), NOW())`, module, e.teacher.ID).Error)
	svc := service.New(e.repo, noStorage{}, time.Now).WithExercises(e2eExercises{module, block})
	teacher := service.Actor{UserID: e.teacher.ID, Role: authn.RoleTeacher}
	student := service.Actor{UserID: e.student.ID, Role: authn.RoleStudent}
	room, _, err := svc.StartSession(ctx, teacher, e.class.ID, service.StartInput{Title: "Aula", InitialModuleID: &module})
	require.NoError(t, err)
	_, err = e.repo.UpsertAdmission(ctx, room.ID, e.student.ID, domain.AdmissionAdmitted, time.Now(), &e.teacher.ID)
	require.NoError(t, err)
	st, err := svc.StartExercise(ctx, teacher, room.ID, service.ExerciseStartInput{BlockID: block, Index: 0, Online: []uuid.UUID{e.student.ID}})
	require.NoError(t, err)

	const sends = 8
	var wg sync.WaitGroup
	results := make([]service.ExerciseSubmitResult, sends)
	errs := make([]error, sends)
	for i := 0; i < sends; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = svc.SubmitExercise(ctx, student, e.class.ID, service.ExerciseSubmitInput{RunID: st.Run.ID, Snapshot: json.RawMessage(`"pass"`)})
		}()
	}
	wg.Wait()

	created := 0
	var id uuid.UUID
	for i := range results {
		require.NoError(t, errs[i])
		require.True(t, results[i].Passed)
		if results[i].Created {
			created++
		}
		if id == uuid.Nil {
			id = results[i].Result.ID
		}
		assert.Equal(t, id, results[i].Result.ID, "everybody gets the one that was kept")
	}
	assert.Equal(t, 1, created, "only one of them made the result")
	list, err := e.repo.ListExerciseResults(ctx, st.Run.ID)
	require.NoError(t, err)
	assert.Len(t, list, 1)
}
