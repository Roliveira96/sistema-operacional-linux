package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- SPEC-057: the scroll of the panes and the divider of the stage ----

const (
	scrollMessage = "live:stage:scroll"
	splitMessage  = "live:stage:split"
	stageLimit    = 1 << 10 // both messages are small: at most 1 KiB for the whole frame
)

// the view of a stage nobody touched: the scrolls at 0, no divider, 100%, no selection (the zoom, the horizontal scroll and the selection
// came with CA-15 to CA-21)
const noStageView = `{"slideScroll":0,"slideScrollX":0,"materialScroll":0,"split":null,"zoom":1,"selection":null,"terminalScroll":{}}`

// stageFrame is a raw frame of a stage message with exactly size bytes, padded inside the data.
func stageFrame(t *testing.T, typ, data string, size int) []byte {
	t.Helper()
	prefix := `{"type":"` + typ + `","data":` + strings.TrimSuffix(data, "}") + `,"pad":"`
	suffix := `"}}`
	pad := size - len(prefix) - len(suffix)
	require.Positive(t, pad)
	return []byte(prefix + strings.Repeat("x", pad) + suffix)
}

// scrollY is the position the test wrote in a scroll message.
func scrollY(t *testing.T, m message) float64 {
	t.Helper()
	var d struct {
		Y float64 `json:"y"`
	}
	require.NoError(t, json.Unmarshal(m.Data, &d))
	return d.Y
}

// untilScroll reads until the scroll message with the position arrives, and requires the positions to come in order.
func untilScroll(t *testing.T, c *websocket.Conn, last float64) {
	t.Helper()
	seen := 0.0
	for seen < last {
		y := scrollY(t, readUntil(t, c, scrollMessage))
		require.Greater(t, y, seen, "the scrolls arrive in order")
		seen = y
	}
	require.InDelta(t, last, seen, 1e-9, "the last scroll always arrives")
}

// Covers SPEC-057 CA-09 (transport): the scroll of the two panes and the divider come from the presenter window and reach the panel and
// the admitted students as they are, and not the window that sent them; the service keeps the values.
func TestStageView_ReachesThePanelAndTheStudentsWithoutEcho(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.25}`)
	for _, c := range []*websocket.Conn{panel, student} {
		assert.JSONEq(t, `{"pane":"slide","y":0.25}`, string(readUntil(t, c, scrollMessage).Data))
	}
	sendMsg(t, presenter, scrollMessage, `{"pane":"material","y":0.75}`)
	for _, c := range []*websocket.Conn{panel, student} {
		assert.JSONEq(t, `{"pane":"material","y":0.75}`, string(readUntil(t, c, scrollMessage).Data))
	}
	sendMsg(t, presenter, splitMessage, `{"ratio":0.4}`)
	for _, c := range []*websocket.Conn{panel, student} {
		assert.JSONEq(t, `{"ratio":0.4}`, string(readUntil(t, c, splitMessage).Data))
	}

	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 2 && len(w.svc.keptSplits()) == 1 })
	assert.Equal(t, []string{"slide:0.25", "material:0.75"}, w.svc.keptScrolls())
	assert.Equal(t, []float64{0.4}, w.svc.keptSplits())
	nothingMore(t, presenter, scrollMessage, splitMessage)
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-057 CA-09: the edges of the ranges are valid: the scroll from 0 to 1 and the divider from 0.2 to 0.8.
func TestStageView_TheEdgesOfTheRangesAreValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0}`)
	assert.JSONEq(t, `{"pane":"slide","y":0}`, string(readUntil(t, student, scrollMessage).Data))
	sendMsg(t, presenter, scrollMessage, `{"pane":"material","y":1}`)
	assert.JSONEq(t, `{"pane":"material","y":1}`, string(readUntil(t, student, scrollMessage).Data))
	sendMsg(t, presenter, splitMessage, `{"ratio":0.2}`)
	assert.JSONEq(t, `{"ratio":0.2}`, string(readUntil(t, student, splitMessage).Data))
	sendMsg(t, presenter, splitMessage, `{"ratio":0.8}`)
	assert.JSONEq(t, `{"ratio":0.8}`, string(readUntil(t, student, splitMessage).Data))

	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 2 && len(w.svc.keptSplits()) == 2 })
	assert.Equal(t, []string{"slide:0", "material:1"}, w.svc.keptScrolls())
	assert.Equal(t, []float64{0.2, 0.8}, w.svc.keptSplits())
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-057 CA-09 and CA-10: only the presenter window sends them; from the panel they are dropped as wrong-view and from a student
// as not-controller, with an audit entry, and they are neither kept nor passed on.
func TestStageView_OnlyFromThePresenter(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, panel, scrollMessage, `{"pane":"slide","y":0.5}`)
	sendMsg(t, panel, splitMessage, `{"ratio":0.5}`)
	sendMsg(t, student, scrollMessage, `{"pane":"slide","y":0.5}`)
	sendMsg(t, student, splitMessage, `{"ratio":0.5}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 4 })
	assert.ElementsMatch(t, []string{
		scrollMessage + ":wrong-view", splitMessage + ":wrong-view",
		scrollMessage + ":not-controller", splitMessage + ":not-controller",
	}, droppedReasons(w))
	for _, e := range w.logs.FilterMessage("classroom message dropped").All() {
		assert.NotEmpty(t, e.ContextMap()["userId"])
		assert.NotEmpty(t, e.ContextMap()["role"])
	}
	assert.Empty(t, w.logs.FilterMessage("classroom message rejected").All(), "they were dropped, not rejected")
	nothingMore(t, presenter, scrollMessage, splitMessage)
	assert.Empty(t, w.svc.keptScrolls())
	assert.Empty(t, w.svc.keptSplits())

	// the next thing the presenter sends is the first one that anybody sees (a read that times out ends a connection for the test, so the
	// student and the panel are not checked for silence: had they got the dropped ones, 0.5 would come before 0.1)
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.1}`)
	assert.InDelta(t, 0.1, scrollY(t, readUntil(t, student, scrollMessage)), 1e-9)
	assert.InDelta(t, 0.1, scrollY(t, readUntil(t, panel, scrollMessage)), 1e-9)
	assert.Equal(t, []string{"slide:0.1"}, w.svc.keptScrolls())
	assert.Empty(t, w.svc.keptSplits())
}

// Covers SPEC-057 CA-09: an unknown pane, a missing or non-numeric position, a number out of its range, a divider out of 0.2 to 0.8, and
// a body that is not an object are rejected, with an audit entry, and are neither kept nor passed on; the connection goes on.
func TestStageView_MustBeValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	badScrolls := []string{
		`{"pane":"page","y":0.5}`, `{"pane":"","y":0.5}`, `{"pane":"Slide","y":0.5}`, `{"pane":42,"y":0.5}`, `{"y":0.5}`,
		`{"pane":"slide"}`, `{"pane":"slide","y":null}`, `{"pane":"slide","y":"0.5"}`, `{"pane":"slide","y":true}`,
		`{"pane":"slide","y":-0.001}`, `{"pane":"slide","y":1.001}`, `{"pane":"material","y":2}`, `{"pane":"material","y":-1}`,
		`{"pane":"slide","y":1e999}`, `{"pane":"slide","y":-1e999}`, `{}`, `null`, `"broken"`, `[1]`,
	}
	badSplits := []string{
		`{}`, `{"ratio":null}`, `{"ratio":"0.5"}`, `{"ratio":false}`, `{"ratio":0.19}`, `{"ratio":0.81}`, `{"ratio":0}`, `{"ratio":1}`,
		`{"ratio":-0.5}`, `{"ratio":1e999}`, `null`, `"broken"`, `[0.5]`,
	}
	for _, bad := range badScrolls {
		sendMsg(t, presenter, scrollMessage, bad)
	}
	for _, bad := range badSplits {
		sendMsg(t, presenter, splitMessage, bad)
	}
	total := len(badScrolls) + len(badSplits)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == total })
	assert.Empty(t, droppedReasons(w), "a bad body is rejected, not dropped")
	assert.Empty(t, w.svc.keptScrolls())
	assert.Empty(t, w.svc.keptSplits())

	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.3}`)
	assert.InDelta(t, 0.3, scrollY(t, readUntil(t, student, scrollMessage)), 1e-9, "nothing bad reached the student, and the window goes on")
	assert.Equal(t, []string{"slide:0.3"}, w.svc.keptScrolls())
}

// Covers SPEC-057 CA-09: NaN and Infinity are not JSON, so a frame with them never reaches the service or anybody.
func TestStageView_NotANumberNeverGetsThrough(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for _, frame := range []string{
		`{"type":"live:stage:scroll","data":{"pane":"slide","y":NaN}}`,
		`{"type":"live:stage:scroll","data":{"pane":"slide","y":Infinity}}`,
		`{"type":"live:stage:scroll","data":{"pane":"slide","y":-Infinity}}`,
		`{"type":"live:stage:split","data":{"ratio":NaN}}`,
		`{"type":"live:stage:split","data":{"ratio":Infinity}}`,
	} {
		require.NoError(t, presenter.WriteMessage(websocket.TextMessage, []byte(frame)))
	}
	sendMsg(t, presenter, scrollMessage, `{"pane":"material","y":0.5}`)
	assert.InDelta(t, 0.5, scrollY(t, readUntil(t, student, scrollMessage)), 1e-9, "the first thing the student gets is the good one")
	assert.Equal(t, []string{"material:0.5"}, w.svc.keptScrolls())
	assert.Empty(t, w.svc.keptSplits())
}

// Covers SPEC-057 CA-09: both messages are small, at most 1 KiB for the whole frame; one byte more is rejected, with an audit entry.
func TestStageView_HasASmallLimit(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, stageFrame(t, scrollMessage, `{"pane":"slide","y":0.5}`, stageLimit)))
	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, stageFrame(t, splitMessage, `{"ratio":0.5}`, stageLimit)))
	readUntil(t, student, scrollMessage)
	readUntil(t, student, splitMessage)
	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 1 && len(w.svc.keptSplits()) == 1 })

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, stageFrame(t, scrollMessage, `{"pane":"slide","y":0.9}`, stageLimit+1)))
	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, stageFrame(t, splitMessage, `{"ratio":0.7}`, stageLimit+1)))
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 2 })
	for _, e := range w.logs.FilterMessage("classroom message rejected").All() {
		assert.Equal(t, "too-large", e.ContextMap()["reason"])
	}
	assert.Len(t, w.svc.keptScrolls(), 1, "the large one was not kept")
	assert.Len(t, w.svc.keptSplits(), 1, "the large one was not kept")

	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.6}`)
	assert.InDelta(t, 0.6, scrollY(t, readUntil(t, student, scrollMessage)), 1e-9, "the large ones were not passed on, and the window goes on")
}

// Covers SPEC-057 CA-04 (transport): the scrolls of a burst reach the panel and the students in order, and the last one always arrives,
// so what they see is the position the teacher has; the service gets every one of them.
func TestStageView_TheLatestScrollAlwaysArrivesInOrder(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	for i := 1; i <= 5; i++ {
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"slide","y":%s}`, strconv.FormatFloat(float64(i)/10, 'g', -1, 64)))
	}
	untilScroll(t, panel, 0.5)
	untilScroll(t, student, 0.5)
	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 5 })
	assert.Equal(t, "slide:0.5", w.svc.keptScrolls()[4])
}

// Covers SPEC-057 CA-04: the scroll and the divider are not counted in the rate limit of their emitter (the window of the presenter sends at
// most 10 per second by itself); with the pointer using up the budget of the second, the last scroll and the last divider still arrive.
func TestStageView_NotHeldBackByTheRateLimit(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for i := 0; i < 60; i++ {
		sendMsg(t, presenter, "live:cursor:move", `{"x":1,"y":2}`)
	}
	for i := 1; i <= 60; i++ {
		sendMsg(t, presenter, scrollMessage, fmt.Sprintf(`{"pane":"material","y":%s}`, strconv.FormatFloat(float64(i)/100, 'g', -1, 64)))
	}
	sendMsg(t, presenter, splitMessage, `{"ratio":0.55}`)

	gotScroll, gotSplit := false, false
	for i := 0; i < 400 && !(gotScroll && gotSplit); i++ {
		switch m := readMsg(t, student); m.Type {
		case scrollMessage:
			gotScroll = gotScroll || scrollY(t, m) > 0.599
		case splitMessage:
			gotSplit = true
		}
	}
	assert.True(t, gotScroll, "the last scroll did not reach the student")
	assert.True(t, gotSplit, "the divider did not reach the student")
	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 60 && len(w.svc.keptSplits()) == 1 })
	reasons := droppedReasons(w)
	assert.Contains(t, reasons, "live:cursor:move:rate-limit", "the budget of the second was really used up")
	assert.NotContains(t, reasons, scrollMessage+":rate-limit")
	assert.NotContains(t, reasons, splitMessage+":rate-limit")
}

// Covers SPEC-057 CA-08 and CA-09: who comes in, or comes back, gets the current view in the snapshot, whatever the window (student, panel,
// presenter); the REST state of the room has it too; with nothing sent yet, the scrolls are 0 and the divider is null.
func TestStageView_TheSnapshotsCarryTheCurrentView(t *testing.T) {
	w := setup(t)
	for _, tc := range []struct{ token, view string }{{"student", ""}, {"teacher", "panel"}, {"teacher2", "presenter"}} {
		snap := snapshotOf(t, w.dialView(t, tc.token, tc.view))
		assert.JSONEq(t, noStageView, mustJSON(snap["stageView"]), "%s %s: the default", tc.token, tc.view)
	}
	code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, noStageView, mustJSON(body["stageView"]), "REST: the default")

	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "second")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.4}`)
	sendMsg(t, presenter, scrollMessage, `{"pane":"material","y":0.7}`)
	sendMsg(t, presenter, splitMessage, `{"ratio":0.35}`)
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.45}`)
	// the panes do not share a place in the window of the hub: the latest of the slide, the latest of the material and the divider all
	// arrive (in the order of their keys), where the one of the slide alone would have taken the place of the material
	for arrived := map[string]float64{}; arrived["slide"] < 0.449 || arrived["material"] < 0.699 || arrived["split"] == 0; {
		switch m := readMsg(t, student); m.Type {
		case scrollMessage:
			var d struct {
				Pane string  `json:"pane"`
				Y    float64 `json:"y"`
			}
			require.NoError(t, json.Unmarshal(m.Data, &d))
			arrived[d.Pane] = d.Y
		case splitMessage:
			arrived["split"] = 1
		}
	}
	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 3 && len(w.svc.keptSplits()) == 1 })
	want := `{"slideScroll":0.45,"slideScrollX":0,"materialScroll":0.7,"split":0.35,"zoom":1,"selection":null,"terminalScroll":{}}`

	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "student", ""))["stageView"]), "a student who comes in later")
	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "teacher2", "panel"))["stageView"]), "the panel that opens later")
	next := w.dialView(t, "teacher", "presenter")
	assert.JSONEq(t, want, mustJSON(snapshotOf(t, next)["stageView"]), "a new presenter window starts with the view the room has")
	code, body = w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, want, mustJSON(body["stageView"]), "REST")
}

// Covers SPEC-057 CA-08: a student who is accepted after the lesson began gets the current view with his snapshot, and nothing of the
// stage before, since a student who waits receives no broadcast.
func TestStageView_TheAcceptedStudentGetsTheCurrentView(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.2}`)
	sendMsg(t, presenter, scrollMessage, `{"pane":"material","y":0.6}`)
	sendMsg(t, presenter, splitMessage, `{"ratio":0.3}`)
	eventually(t, func() bool { return len(w.svc.keptScrolls()) == 2 && len(w.svc.keptSplits()) == 1 })

	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, nextMsg(t, student)), "nothing of the stage came before the admission")
	snap := nextMsg(t, student)
	require.Equal(t, "live:snapshot", snap.Type)
	var body map[string]any
	require.NoError(t, json.Unmarshal(snap.Data, &body))
	assert.JSONEq(t, `{"slideScroll":0.2,"slideScrollX":0,"materialScroll":0.6,"split":0.3,"zoom":1,"selection":null,"terminalScroll":{}}`, mustJSON(body["stageView"]))
}

// Covers SPEC-057 CA-05 (transport): the new slide and the new module reach everybody by their own messages, and the server invents no
// message to put the scroll back, since the screens do it by themselves.
func TestStageView_ChangesOfSlideAndModuleSendNoExtraMessage(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}
	sendMsg(t, presenter, scrollMessage, `{"pane":"slide","y":0.5}`)
	readUntil(t, student, scrollMessage)
	readUntil(t, panel, scrollMessage)

	sendMsg(t, presenter, "live:slide:change", `{"slide":3}`)
	for _, c := range []*websocket.Conn{student, panel} {
		assert.JSONEq(t, `{"slide":3}`, string(readUntil(t, c, "live:slide:change").Data), "the panel and the student see the new slide")
	}
	sendMsg(t, panel, "live:mode:switch", `{"mode":"MODULE","moduleId":"`+uuid.NewString()+`"}`)
	readUntil(t, student, "live:mode:switch")
	readUntil(t, presenter, "live:mode:switch")
	nothingMore(t, student, scrollMessage, splitMessage)
	nothingMore(t, panel, scrollMessage, splitMessage)
	nothingMore(t, presenter, scrollMessage, splitMessage)
}
