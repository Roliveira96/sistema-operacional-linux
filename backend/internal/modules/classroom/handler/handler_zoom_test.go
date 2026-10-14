package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- SPEC-057 (CA-15 to CA-18): the zoom of the teacher and the horizontal scroll of the slide ----

const zoomMessage = "live:stage:zoom"

func zoomOf(t *testing.T, m message) float64 {
	t.Helper()
	var d struct {
		Zoom float64 `json:"zoom"`
	}
	require.NoError(t, json.Unmarshal(m.Data, &d))
	return d.Zoom
}

func num(f float64) string { return strconv.FormatFloat(f, 'g', -1, 64) }

// Covers SPEC-057 CA-15 and CA-09 (transport): the zoom comes from the presenter window and reaches the panel and the admitted students as
// it is, and not the window that sent it; the service keeps the value.
func TestStageZoom_ReachesThePanelAndTheStudentsWithoutEcho(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, presenter, zoomMessage, `{"zoom":1.5}`)
	for _, c := range []*websocket.Conn{panel, student} {
		assert.JSONEq(t, `{"zoom":1.5}`, string(readUntil(t, c, zoomMessage).Data))
	}
	eventually(t, func() bool { return len(w.svc.keptZooms()) == 1 })
	assert.Equal(t, []float64{1.5}, w.svc.keptZooms())
	nothingMore(t, presenter, zoomMessage)
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-057 CA-15: the edges of the range are valid: from 1 (100%) to 2 (200%), inclusive.
func TestStageZoom_TheEdgesOfTheRangeAreValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for _, zoom := range []string{"2", "1", "1.25"} {
		sendMsg(t, presenter, zoomMessage, `{"zoom":`+zoom+`}`)
		assert.JSONEq(t, `{"zoom":`+zoom+`}`, string(readUntil(t, student, zoomMessage).Data))
	}
	eventually(t, func() bool { return len(w.svc.keptZooms()) == 3 })
	assert.Equal(t, []float64{2, 1, 1.25}, w.svc.keptZooms())
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-057 CA-18 and CA-09: only the presenter window sends the zoom; from the panel it is dropped as wrong-view and from a student
// as not-controller (a student has no control of the zoom), with an audit entry, and it is neither kept nor passed on.
func TestStageZoom_OnlyFromThePresenter(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, panel, zoomMessage, `{"zoom":1.5}`)
	sendMsg(t, student, zoomMessage, `{"zoom":1.5}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 2 })
	assert.ElementsMatch(t, []string{zoomMessage + ":wrong-view", zoomMessage + ":not-controller"}, droppedReasons(w))
	for _, e := range w.logs.FilterMessage("classroom message dropped").All() {
		assert.Equal(t, zoomMessage, e.ContextMap()["type"])
		assert.NotEmpty(t, e.ContextMap()["userId"])
	}
	assert.Empty(t, w.logs.FilterMessage("classroom message rejected").All(), "they were dropped, not rejected")
	nothingMore(t, presenter, zoomMessage)
	assert.Empty(t, w.svc.keptZooms())

	// had the student or the panel got a dropped one, 1.5 would come before 1.2
	sendMsg(t, presenter, zoomMessage, `{"zoom":1.2}`)
	assert.InDelta(t, 1.2, zoomOf(t, readUntil(t, student, zoomMessage)), 1e-9)
	assert.InDelta(t, 1.2, zoomOf(t, readUntil(t, panel, zoomMessage)), 1e-9)
	assert.Equal(t, []float64{1.2}, w.svc.keptZooms())
}

// Covers SPEC-057 CA-15 and CA-09: a missing or non-numeric zoom, and a number out of 1 to 2, are rejected, with an audit entry, and are
// neither kept nor passed on; the connection goes on.
func TestStageZoom_MustBeValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	bad := []string{
		`{}`, `{"zoom":null}`, `{"zoom":"1.5"}`, `{"zoom":true}`, `{"zoom":[1.5]}`, `{"level":1.5}`,
		`{"zoom":0.99}`, `{"zoom":0.999999}`, `{"zoom":0}`, `{"zoom":-1}`, `{"zoom":2.000001}`, `{"zoom":3}`, `{"zoom":100}`,
		`{"zoom":1e999}`, `{"zoom":-1e999}`, `null`, `"broken"`, `[1.5]`,
	}
	for _, b := range bad {
		sendMsg(t, presenter, zoomMessage, b)
	}
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == len(bad) })
	assert.Empty(t, droppedReasons(w), "a bad body is rejected, not dropped")
	assert.Empty(t, w.svc.keptZooms())

	sendMsg(t, presenter, zoomMessage, `{"zoom":1.5}`)
	assert.InDelta(t, 1.5, zoomOf(t, readUntil(t, student, zoomMessage)), 1e-9, "nothing bad reached the student, and the window goes on")
	assert.Equal(t, []float64{1.5}, w.svc.keptZooms())
}

// Covers SPEC-057 CA-09: NaN and Infinity are not JSON, so a frame with them (as the zoom or as the horizontal scroll) never reaches the
// service or anybody.
func TestStageZoomAndScrollX_NotANumberNeverGetsThrough(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for _, frame := range []string{
		`{"type":"live:stage:zoom","data":{"zoom":NaN}}`,
		`{"type":"live:stage:zoom","data":{"zoom":Infinity}}`,
		`{"type":"live:stage:zoom","data":{"zoom":-Infinity}}`,
		`{"type":"live:stage:scroll","data":{"pane":"slide","y":0.5,"x":NaN}}`,
		`{"type":"live:stage:scroll","data":{"pane":"slide","y":0.5,"x":Infinity}}`,
	} {
		require.NoError(t, presenter.WriteMessage(websocket.TextMessage, []byte(frame)))
	}
	sendMsg(t, presenter, zoomMessage, `{"zoom":1.5}`)
	assert.InDelta(t, 1.5, zoomOf(t, readUntil(t, student, zoomMessage)), 1e-9, "the first zoom the student gets is the good one")
	assert.Equal(t, []float64{1.5}, w.svc.keptZooms())
	assert.Empty(t, w.svc.keptScrolls())
	assert.Empty(t, w.svc.keptScrollXs())
}

// Covers SPEC-057 CA-15 and CA-09: the zoom is small, at most 1 KiB for the whole frame; one byte more is rejected, with an audit entry.
func TestStageZoom_HasASmallLimit(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, stageFrame(t, zoomMessage, `{"zoom":1.5}`, stageLimit)))
	readUntil(t, student, zoomMessage)
	eventually(t, func() bool { return len(w.svc.keptZooms()) == 1 })

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, stageFrame(t, zoomMessage, `{"zoom":1.9}`, stageLimit+1)))
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	assert.Equal(t, "too-large", w.logs.FilterMessage("classroom message rejected").All()[0].ContextMap()["reason"])
	assert.Len(t, w.svc.keptZooms(), 1, "the large one was not kept")

	sendMsg(t, presenter, zoomMessage, `{"zoom":1.2}`)
	assert.InDelta(t, 1.2, zoomOf(t, readUntil(t, student, zoomMessage)), 1e-9, "the large one was not passed on, and the window goes on")
}

// Covers SPEC-057 CA-15: the zoom is not counted in the rate limit of its emitter, and the latest of a burst always arrives, in order; with
// the pointer using up the budget of the second, the last zoom still reaches the student, and the service gets every one of them.
func TestStageZoom_TheLatestAlwaysArrivesAndIsNotRateLimited(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for i := 0; i < 60; i++ {
		sendMsg(t, presenter, "live:cursor:move", `{"x":1,"y":2}`)
	}
	for i := 1; i <= 60; i++ {
		sendMsg(t, presenter, zoomMessage, fmt.Sprintf(`{"zoom":%s}`, num(1+float64(i)/100)))
	}

	seen := 1.0
	for i := 0; i < 400 && seen < 1.599; i++ {
		if m := readMsg(t, student); m.Type == zoomMessage {
			z := zoomOf(t, m)
			require.Greater(t, z, seen, "the zooms arrive in order")
			seen = z
		}
	}
	assert.InDelta(t, 1.6, seen, 1e-9, "the last zoom did not reach the student")
	eventually(t, func() bool { return len(w.svc.keptZooms()) == 60 })
	reasons := droppedReasons(w)
	assert.Contains(t, reasons, "live:cursor:move:rate-limit", "the budget of the second was really used up")
	assert.NotContains(t, reasons, zoomMessage+":rate-limit")
}

// Covers SPEC-057 CA-17 and CA-09: the scroll of the slide takes x, from 0 to 1, optional; the message reaches the others as it came, and
// the service keeps the horizontal scroll together with the vertical one; with no x the horizontal scroll is 0.
func TestStageScrollX_IsKeptAndPassedOn(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.25,"x":0.5}`)
	for _, c := range []*websocket.Conn{panel, student} {
		assert.JSONEq(t, `{"pane":"slide","y":0.25,"x":0.5}`, string(readUntil(t, c, scrollMessage).Data))
	}
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.3}`)
	for _, c := range []*websocket.Conn{panel, student} {
		assert.JSONEq(t, `{"pane":"slide","y":0.3}`, string(readUntil(t, c, scrollMessage).Data), "the message goes on as it came")
	}
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0,"x":0}`)
	readUntil(t, student, scrollMessage)
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":1,"x":1}`)
	assert.JSONEq(t, `{"pane":"slide","y":1,"x":1}`, string(readUntil(t, student, scrollMessage).Data))
	sendMsg(t, presenter, scrollMessage, `{"pane":"material","y":0.8}`)
	readUntil(t, student, scrollMessage)

	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 5 })
	assert.Equal(t, []string{"slide:0.25", "slide:0.3", "slide:0", "slide:1", "material:0.8"}, w.svc.keptScrolls())
	assert.Equal(t, []float64{0.5, 0, 0, 1}, w.svc.keptScrollXs(), "no x is 0, and the scroll of the material has no horizontal one")
	nothingMore(t, presenter, scrollMessage)
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-057 CA-17 and CA-09: an x out of 0 to 1 or not a number is rejected; the material has no horizontal scroll, so an x with it
// is rejected too (and not ignored); nothing is kept or passed on, and the connection goes on.
func TestStageScrollX_MustBeValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	bad := []string{
		`{"pane":"slide","y":0.5,"x":-0.001}`, `{"pane":"slide","y":0.5,"x":1.001}`, `{"pane":"slide","y":0.5,"x":2}`,
		`{"pane":"slide","y":0.5,"x":"0.5"}`, `{"pane":"slide","y":0.5,"x":true}`, `{"pane":"slide","y":0.5,"x":[0.5]}`,
		`{"pane":"slide","y":0.5,"x":1e999}`, `{"pane":"slide","y":0.5,"x":-1e999}`,
		`{"pane":"material","y":0.5,"x":0}`, `{"pane":"material","y":0.5,"x":0.5}`, `{"pane":"material","y":0.5,"x":2}`,
	}
	for _, b := range bad {
		sendMsg(t, presenter, scrollMessage, b)
	}
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == len(bad) })
	assert.Empty(t, droppedReasons(w), "a bad body is rejected, not dropped")
	assert.Empty(t, w.svc.keptScrolls(), "a message that is rejected keeps nothing, not even its y")
	assert.Empty(t, w.svc.keptScrollXs())

	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.3,"x":0.2}`)
	assert.InDelta(t, 0.3, scrollY(t, readUntil(t, student, scrollMessage)), 1e-9, "nothing bad reached the student, and the window goes on")
	assert.Equal(t, []float64{0.2}, w.svc.keptScrollXs())
}

// Covers SPEC-057 CA-18: who comes in, or comes back, gets the current zoom and horizontal scroll in the snapshot, whatever the window
// (student, panel, presenter); the REST state of the room has them too; with nothing sent yet the zoom is 1 and the scroll 0.
func TestStageZoom_TheSnapshotsCarryTheCurrentZoomAndScrollX(t *testing.T) {
	w := setup(t)
	for _, tc := range []struct{ token, view string }{{"student", ""}, {"teacher", "panel"}, {"teacher2", "presenter"}} {
		snap := snapshotOf(t, w.dialView(t, tc.token, tc.view))
		assert.JSONEq(t, noStageView, mustJSON(snap["stageView"]), "%s %s: the default", tc.token, tc.view)
	}

	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "second")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")
	sendMsg(t, presenter, zoomMessage, `{"zoom":1.5}`)
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.4,"x":0.6}`)
	// the two messages of a window of the hub arrive in the order of their types, not of their sending: wait for both, whichever comes first
	for seen := 0; seen < 2; {
		if m := readMsg(t, student); m.Type == zoomMessage || m.Type == scrollMessage {
			seen++
		}
	}
	eventually(t, func() bool { return len(w.svc.keptZooms()) == 1 && len(w.svc.keptScrollXs()) == 1 })
	want := `{"slideScroll":0.4,"slideScrollX":0.6,"materialScroll":0,"split":null,"zoom":1.5,"selection":null}`

	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "student", ""))["stageView"]), "a student who comes in later")
	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "teacher2", "panel"))["stageView"]), "the panel that opens later")
	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "teacher", "presenter"))["stageView"]), "a new presenter window")
	code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, want, mustJSON(body["stageView"]), "REST")
}

// Covers SPEC-057 CA-18: a student who is accepted after the lesson began gets the current zoom and horizontal scroll with his snapshot,
// and nothing of the stage before, since a student who waits receives no broadcast.
func TestStageZoom_TheAcceptedStudentGetsTheCurrentZoom(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, presenter, zoomMessage, `{"zoom":1.75}`)
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.2,"x":0.9}`)
	eventually(t, func() bool { return len(w.svc.keptZooms()) == 1 && len(w.svc.keptScrollXs()) == 1 })

	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, nextMsg(t, student)), "nothing of the stage came before the admission")
	snap := nextMsg(t, student)
	require.Equal(t, "live:snapshot", snap.Type)
	var body map[string]any
	require.NoError(t, json.Unmarshal(snap.Data, &body))
	assert.JSONEq(t, `{"slideScroll":0.2,"slideScrollX":0.9,"materialScroll":0,"split":null,"zoom":1.75,"selection":null}`, mustJSON(body["stageView"]))
}
