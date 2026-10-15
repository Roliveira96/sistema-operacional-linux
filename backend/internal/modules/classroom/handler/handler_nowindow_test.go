package handler_test

import (
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// ---- SPEC-070: the waiting screen while the room has no presenter window ----

// fakeTimer is the timer of the tolerance, which the test fires when it wants (the handler takes it in Options.After).
type fakeTimer struct {
	mu      sync.Mutex
	entries []*timerEntry
}

type timerEntry struct {
	after          time.Duration
	run            func()
	stopped, fired bool
}

func (t *fakeTimer) after(d time.Duration, f func()) func() {
	e := &timerEntry{after: d, run: f}
	t.mu.Lock()
	t.entries = append(t.entries, e)
	t.mu.Unlock()
	return func() {
		t.mu.Lock()
		e.stopped = true
		t.mu.Unlock()
	}
}

// pending counts the timers that were neither stopped nor fired.
func (t *fakeTimer) pending() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	n := 0
	for _, e := range t.entries {
		if !e.stopped && !e.fired {
			n++
		}
	}
	return n
}

// scheduled counts every timer that was ever asked for.
func (t *fakeTimer) scheduled() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.entries)
}

// delay is how long the last timer asked for.
func (t *fakeTimer) delay() time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.entries) == 0 {
		return 0
	}
	return t.entries[len(t.entries)-1].after
}

// fire runs the pending timers, as the clock would when the time is up.
func (t *fakeTimer) fire() {
	t.mu.Lock()
	var run []func()
	for _, e := range t.entries {
		if !e.stopped && !e.fired {
			e.fired = true
			run = append(run, e.run)
		}
	}
	t.mu.Unlock()
	for _, f := range run {
		f()
	}
}

// setupNoWindow is the room of setup with a handler that takes the fake timer.
func setupNoWindow(t *testing.T) (*world, *fakeTimer) {
	t.Helper()
	w := setup(t)
	timer := &fakeTimer{}
	core, logs := observer.New(zap.WarnLevel)
	w.logs = logs
	w.h = handler.New(w.svc, validator{people: w.people}, zap.New(core), handler.Options{After: timer.after})
	w.srv = httptest.NewServer(server.NewEngine(zap.NewNop(), nil, w.h))
	t.Cleanup(w.srv.Close)
	return w, timer
}

const blankMessage = "live:stage:blank"

// Covers SPEC-070 CA-01, CA-02, CA-05, CA-09 (RN-01, RN-02, RN-04, RN-05): with no presenter window the admitted students and the panel see the
// waiting screen from the start of the lesson; the first window takes it off for everybody, and nobody else is told anything.
func TestNoWindow_TheWaitingScreenFromTheStartUntilTheFirstWindow(t *testing.T) {
	w, timer := setupNoWindow(t)
	student := w.dial(t, "student")
	panel := w.dialView(t, "teacher", "panel")
	assert.Equal(t, true, snapshotOf(t, student)["stageBlank"], "no presenter window yet: the waiting screen, with no tolerance")
	panelSnap := snapshotOf(t, panel)
	assert.Equal(t, true, panelSnap["stageBlank"])
	assert.Equal(t, false, panelSnap["presenterConnected"])

	w.svc.waiting = true
	waiting := w.dial(t, "stranger") // not admitted: his screen is the one of the waiting room (SPEC-054)
	readUntil(t, waiting, "live:admission:state")
	w.svc.waiting = false

	presenter := w.dialView(t, "teacher2", "presenter")
	assert.Equal(t, false, snapshotOf(t, presenter)["stageBlank"], "the window that comes in sees the stage")
	for _, c := range []*websocket.Conn{student, panel} {
		assert.JSONEq(t, `{"blank":false}`, string(readUntil(t, c, blankMessage).Data), "the first window takes the waiting screen off")
	}
	nothingMore(t, presenter, blankMessage)
	nothingMore(t, waiting, blankMessage)
	assert.Equal(t, false, snapshotOf(t, w.dialView(t, "second", ""))["stageBlank"], "who comes in later sees the stage")
	assert.Zero(t, timer.scheduled(), "no tolerance without a window that left")
}

// Covers SPEC-070 CA-03, CA-05 (RN-03, RN-05): when the last window leaves, the waiting screen waits 10 seconds; the one who comes in meanwhile
// still sees the stage; when the time is up with no window, everybody is told, and the next one to come in sees the waiting screen.
func TestWindowLeaves_TenSecondsThenTheWaitingScreen(t *testing.T) {
	w, timer := setupNoWindow(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	quiet := w.dial(t, "stranger") // only to see that nothing comes before the time is up: a read that times out spoils the connection
	for _, c := range []*websocket.Conn{presenter, panel, student, quiet} {
		readUntil(t, c, "live:snapshot")
	}

	require.NoError(t, presenter.Close())
	eventually(t, func() bool { return timer.pending() == 1 })
	assert.Equal(t, 10*time.Second, timer.delay())
	nothingMore(t, quiet, blankMessage)

	meanwhile := w.dialView(t, "second", "")
	assert.Equal(t, false, snapshotOf(t, meanwhile)["stageBlank"], "during the tolerance it is the stage: the value of the B key")

	timer.fire()
	for _, c := range []*websocket.Conn{student, panel, meanwhile} {
		assert.JSONEq(t, `{"blank":true}`, string(readUntil(t, c, blankMessage).Data))
	}
	assert.Equal(t, true, snapshotOf(t, w.dialView(t, "stranger", ""))["stageBlank"], "after the tolerance: the waiting screen")

	back := w.dialView(t, "teacher", "presenter")
	assert.Equal(t, false, snapshotOf(t, back)["stageBlank"])
	assert.JSONEq(t, `{"blank":false}`, string(readUntil(t, student, blankMessage).Data), "the window that comes back takes the waiting screen off")
}

// Covers SPEC-070 CA-04 (RN-03): a window that comes back inside the 10 seconds (a reload, a short drop) leaves nothing to tell: no waiting
// screen now, none when the time would be up, and no message to anybody.
func TestWindowComesBackInTime_NothingChanges(t *testing.T) {
	w, timer := setupNoWindow(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	require.NoError(t, presenter.Close())
	eventually(t, func() bool { return timer.pending() == 1 })
	back := w.dialView(t, "teacher", "presenter")
	assert.Equal(t, false, snapshotOf(t, back)["stageBlank"])
	assert.Zero(t, timer.pending(), "the window that came back stops the tolerance")

	timer.fire()
	nothingMore(t, student, blankMessage)
	assert.Equal(t, false, snapshotOf(t, w.dialView(t, "second", ""))["stageBlank"])
}

// Covers SPEC-070 CA-04 (RN-02): a window that replaces the old one is not a window that left, in either order of the two events.
func TestWindowReplaced_NothingChanges(t *testing.T) {
	w, timer := setupNoWindow(t)
	old := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, old, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	next := w.dialView(t, "teacher2", "presenter")
	readUntil(t, next, "live:snapshot")
	require.NoError(t, old.Close()) // the old window, already replaced, leaves
	require.Never(t, func() bool { return timer.scheduled() > 0 }, 300*time.Millisecond, 10*time.Millisecond, "a replaced window leaving starts no tolerance")
	nothingMore(t, student, blankMessage)
}

// Covers SPEC-070 CA-06 (RN-06): the end of the lesson cancels the tolerance that was running, and the windows that leave because the room
// closed start none.
func TestRoomEnds_NoWaitingScreenAndNoTolerance(t *testing.T) {
	w, timer := setupNoWindow(t)
	presenter := w.dialView(t, "teacher", "presenter")
	readUntil(t, presenter, "live:snapshot")
	require.NoError(t, presenter.Close())
	eventually(t, func() bool { return timer.pending() == 1 })

	w.h.CloseRoom(w.session.ID)
	assert.Zero(t, timer.pending(), "the tolerance of a room that closed is cancelled")

	// A room that closes with the window open: everybody leaves, and the window leaving starts nothing.
	w2, timer2 := setupNoWindow(t)
	open := w2.dialView(t, "teacher", "presenter")
	student := w2.dial(t, "student")
	readUntil(t, open, "live:snapshot")
	readUntil(t, student, "live:snapshot")
	w2.h.CloseRoom(w2.session.ID)
	readUntil(t, student, "live:ended")
	require.Never(t, func() bool { return timer2.scheduled() > 0 }, 300*time.Millisecond, 10*time.Millisecond)
}

// Covers SPEC-070 CA-07 (RN-07): with no window the panel can change the slide, and the students keep the waiting screen.
func TestNoWindow_ThePanelDoesNotTurnTheWaitingScreenOff(t *testing.T) {
	w, _ := setupNoWindow(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, panel, "live:slide:change", `{"slide":3}`)
	eventually(t, func() bool { w.svc.mu.Lock(); defer w.svc.mu.Unlock(); return len(w.svc.slides) == 1 })
	nothingMore(t, student, blankMessage)
	assert.Equal(t, true, snapshotOf(t, w.dialView(t, "second", ""))["stageBlank"])
}
