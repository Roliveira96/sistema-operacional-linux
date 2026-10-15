package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- SPEC-057 CA-23: the scroll of the history of each terminal ----

// scrollOf is the pane (and the terminal, 0 for none) and the position that the test wrote in a scroll message.
func scrollOf(t *testing.T, m message) (pane string, terminal int, y float64) {
	t.Helper()
	var d struct {
		Pane     string  `json:"pane"`
		Terminal int     `json:"terminal"`
		Y        float64 `json:"y"`
	}
	require.NoError(t, json.Unmarshal(m.Data, &d))
	return d.Pane, d.Terminal, d.Y
}

// untilScrolls reads until the last position of each key has arrived ("terminal1", "slide", ...), and returns the positions it got.
func untilScrolls(t *testing.T, c *websocket.Conn, want map[string]float64) {
	t.Helper()
	got := map[string]float64{}
	for i := 0; i < 400; i++ {
		done := true
		for key, y := range want {
			if v, ok := got[key]; !ok || v < y-1e-9 {
				done = false
			}
		}
		if done {
			return
		}
		m := readUntil(t, c, scrollMessage)
		pane, terminal, y := scrollOf(t, m)
		key := pane
		if pane == "terminal" {
			key = fmt.Sprintf("terminal%d", terminal)
		}
		require.GreaterOrEqual(t, y, got[key]-1e-9, "the positions of %s arrive in order", key)
		got[key] = y
	}
	require.FailNow(t, "the last positions did not arrive", "%v of %v", got, want)
}

// Covers SPEC-057 CA-23 and CA-09 (transport): the scroll of a terminal comes from the presenter window and reaches the panel and the
// admitted students as it is, and not the window that sent it; the service keeps one position for each terminal.
func TestTerminalScroll_ReachesThePanelAndTheStudentsWithoutEcho(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	for _, sent := range []string{`{"pane":"terminal","terminal":1,"y":0.25}`, `{"pane":"terminal","terminal":3,"y":1}`, `{"pane":"terminal","terminal":2,"y":0}`} {
		sendMsg(t, presenter, scrollMessage, sent)
		for _, c := range []*websocket.Conn{panel, student} {
			assert.JSONEq(t, sent, string(readUntil(t, c, scrollMessage).Data))
		}
	}
	eventually(t, func() bool { return len(w.svc.keptTerminalScrolls()) == 3 })
	assert.Equal(t, []string{"1:0.25", "3:1", "2:0"}, w.svc.keptTerminalScrolls())
	assert.Empty(t, w.svc.keptScrolls(), "the slide and the material have nothing to do with it")
	assert.Empty(t, w.svc.keptScrollXs())
	nothingMore(t, presenter, scrollMessage)
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-057 CA-23 and CA-09: only the presenter window sends it; from the panel it is dropped as wrong-view and from a student as
// not-controller, with an audit entry, and it is neither kept nor passed on.
func TestTerminalScroll_OnlyFromThePresenter(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, panel, scrollMessage, `{"pane":"terminal","terminal":1,"y":0.5}`)
	sendMsg(t, student, scrollMessage, `{"pane":"terminal","terminal":2,"y":0.5}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 2 })
	assert.ElementsMatch(t, []string{scrollMessage + ":wrong-view", scrollMessage + ":not-controller"}, droppedReasons(w))
	assert.Empty(t, w.svc.keptTerminalScrolls())

	// had the student or the panel got a dropped one, 0.5 would come before 0.1
	sendMsg(t, presenter, scrollMessage, `{"pane":"terminal","terminal":1,"y":0.1}`)
	_, _, y := scrollOf(t, readUntil(t, student, scrollMessage))
	assert.InDelta(t, 0.1, y, 1e-9)
	_, _, y = scrollOf(t, readUntil(t, panel, scrollMessage))
	assert.InDelta(t, 0.1, y, 1e-9)
	assert.Equal(t, []string{"1:0.1"}, w.svc.keptTerminalScrolls())
}

// Covers SPEC-057 CA-23 and CA-09: the terminal is required for the pane terminal, and is an integer from 1 to 3; the slide and the
// material take none; the terminal has no horizontal scroll; the position is from 0 to 1. Whatever is not so is rejected, with an audit
// entry, and neither kept nor passed on; the connection goes on.
func TestTerminalScroll_MustBeValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	bad := []string{
		// the terminal of the pane terminal
		`{"pane":"terminal","y":0.5}`, `{"pane":"terminal","terminal":null,"y":0.5}`, `{"pane":"terminal","terminal":0,"y":0.5}`,
		`{"pane":"terminal","terminal":4,"y":0.5}`, `{"pane":"terminal","terminal":-1,"y":0.5}`, `{"pane":"terminal","terminal":1.5,"y":0.5}`,
		`{"pane":"terminal","terminal":"1","y":0.5}`, `{"pane":"terminal","terminal":true,"y":0.5}`, `{"pane":"terminal","terminal":[1],"y":0.5}`,
		`{"pane":"terminal","terminal":1e999,"y":0.5}`,
		// the position
		`{"pane":"terminal","terminal":1}`, `{"pane":"terminal","terminal":1,"y":null}`, `{"pane":"terminal","terminal":1,"y":-0.001}`,
		`{"pane":"terminal","terminal":1,"y":1.001}`, `{"pane":"terminal","terminal":1,"y":"0.5"}`, `{"pane":"terminal","terminal":1,"y":1e999}`,
		// no horizontal scroll in the terminal
		`{"pane":"terminal","terminal":1,"y":0.5,"x":0}`, `{"pane":"terminal","terminal":2,"y":0.5,"x":0.5}`,
		// the other panes take no terminal
		`{"pane":"slide","terminal":1,"y":0.5}`, `{"pane":"material","terminal":2,"y":0.5}`, `{"pane":"slide","terminal":0,"y":0.5}`,
		`{"pane":"material","terminal":"x","y":0.5}`,
		// not a pane
		`{"pane":"Terminal","terminal":1,"y":0.5}`, `{"pane":"terminals","terminal":1,"y":0.5}`,
	}
	for _, b := range bad {
		sendMsg(t, presenter, scrollMessage, b)
	}
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == len(bad) })
	assert.Empty(t, droppedReasons(w), "a bad body is rejected, not dropped")
	assert.Empty(t, w.svc.keptTerminalScrolls())
	assert.Empty(t, w.svc.keptScrolls(), "a message that is rejected keeps nothing, not even its y")
	assert.Empty(t, w.svc.keptScrollXs())

	sendMsg(t, presenter, scrollMessage, `{"pane":"terminal","terminal":2,"y":0.3}`)
	pane, terminal, y := scrollOf(t, readUntil(t, student, scrollMessage))
	assert.Equal(t, []any{"terminal", 2, 0.3}, []any{pane, terminal, y}, "nothing bad reached the student, and the window goes on")
}

// Covers SPEC-057 CA-23: the window of the hub that merges the burst of a pointer or of a scroll keeps one place for each pane and each
// terminal: scrolling the three terminals, the slide and the material in the same 30 ms, the latest of each one reaches the students and the
// panel, and none takes the place of another.
func TestTerminalScroll_NoTerminalTakesThePlaceOfAnother(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	for i := 1; i <= 5; i++ {
		y := float64(i) / 10
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"terminal","terminal":1,"y":%s}`, num(y)))
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"terminal","terminal":2,"y":%s}`, num(y+0.1)))
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"terminal","terminal":3,"y":%s}`, num(y+0.2)))
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"slide","y":%s}`, num(y/2)))
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"material","y":%s}`, num(y/3)))
	}
	want := map[string]float64{"terminal1": 0.5, "terminal2": 0.6, "terminal3": 0.7, "slide": 0.25, "material": 0.5 / 3}
	untilScrolls(t, student, want)
	untilScrolls(t, panel, want)
	eventually(t, func() bool { return len(w.svc.keptTerminalScrolls()) == 15 && len(w.svc.keptScrolls()) == 10 })
	assert.Equal(t, "1:0.5", w.svc.keptTerminalScrolls()[12])
	assert.Equal(t, "3:0.7", w.svc.keptTerminalScrolls()[14])
}

// Covers SPEC-057 CA-23: the scroll of a terminal is not counted in the rate limit of its emitter; with the pointer using up the budget of
// the second, the last position of a long burst still reaches the student.
func TestTerminalScroll_NotHeldBackByTheRateLimit(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for i := 0; i < 60; i++ {
		sendMsg(t, presenter, "live:cursor:move", `{"x":1,"y":2}`)
	}
	for i := 1; i <= 60; i++ {
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"terminal","terminal":2,"y":%s}`, num(float64(i)/100)))
	}
	untilScrolls(t, student, map[string]float64{"terminal2": 0.6})
	eventually(t, func() bool { return len(w.svc.keptTerminalScrolls()) == 60 })
	reasons := droppedReasons(w)
	assert.Contains(t, reasons, "live:cursor:move:rate-limit", "the budget of the second was really used up")
	assert.NotContains(t, reasons, scrollMessage+":rate-limit")
}

// Covers SPEC-057 CA-23: who comes in, or comes back, gets the current position of each terminal that was scrolled in the stageView of the
// snapshot, whatever the window; the REST state has it too; with no scroll yet it is an empty object, not null.
func TestTerminalScroll_TheSnapshotsCarryEachPosition(t *testing.T) {
	w := setup(t)
	check := func(want, why string) {
		t.Helper()
		for _, tc := range []struct{ token, view string }{{"student", ""}, {"teacher2", "panel"}} {
			snap := snapshotOf(t, w.dialView(t, tc.token, tc.view))
			assert.JSONEq(t, want, mustJSON(snap["stageView"].(map[string]any)["terminalScroll"]), "%s %s: %s", tc.token, tc.view, why)
		}
		code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
		require.Equal(t, http.StatusOK, code)
		assert.JSONEq(t, want, mustJSON(body["stageView"].(map[string]any)["terminalScroll"]), "REST: %s", why)
	}
	check(`{}`, "nothing scrolled yet")

	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "second")
	assert.JSONEq(t, `{}`, mustJSON(snapshotOf(t, presenter)["stageView"].(map[string]any)["terminalScroll"]), "the presenter: nothing scrolled yet")
	readUntil(t, student, "live:snapshot")
	sendMsg(t, presenter, scrollMessage, `{"pane":"terminal","terminal":3,"y":0.4}`)
	sendMsg(t, presenter, scrollMessage, `{"pane":"terminal","terminal":1,"y":1}`)
	sendMsg(t, presenter, scrollMessage, `{"pane":"terminal","terminal":3,"y":0.45}`)
	untilScrolls(t, student, map[string]float64{"terminal1": 1, "terminal3": 0.45})
	eventually(t, func() bool { return len(w.svc.keptTerminalScrolls()) == 3 })
	check(`{"1":1,"3":0.45}`, "only the terminals that were scrolled, with the last position of each")
	presenter = w.dialView(t, "teacher", "presenter")
	assert.JSONEq(t, `{"1":1,"3":0.45}`, mustJSON(snapshotOf(t, presenter)["stageView"].(map[string]any)["terminalScroll"]), "a new presenter window")
}

// Covers SPEC-057 CA-23: a student who is accepted after the lesson began gets the position of each terminal with his snapshot, and nothing
// of the stage before, since a student who waits receives no broadcast.
func TestTerminalScroll_TheAcceptedStudentGetsEachPosition(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, presenter, scrollMessage, `{"pane":"terminal","terminal":2,"y":0.8}`)
	eventually(t, func() bool { return len(w.svc.keptTerminalScrolls()) == 1 })

	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, nextMsg(t, student)), "nothing of the stage came before the admission")
	snap := nextMsg(t, student)
	require.Equal(t, "live:snapshot", snap.Type)
	var body map[string]any
	require.NoError(t, json.Unmarshal(snap.Data, &body))
	assert.JSONEq(t, `{"2":0.8}`, mustJSON(body["stageView"].(map[string]any)["terminalScroll"]))
}
