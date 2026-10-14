package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- SPEC-057 (CA-20, CA-21): the text that the teacher selects, marked for the students ----

const selectionMessage = "live:stage:selection"

// the three shapes of the message (the server does not read what a block is)
const (
	materialSelection = `{"pane":"material","start":{"block":"b1","offset":3},"end":{"block":"b2","offset":7}}`
	terminalSelection = `{"pane":"terminal","terminal":2,"start":3,"end":9}`
	clearSelection    = `{"clear":true}`
)

func material(start, end string) string {
	return `{"pane":"material","start":` + start + `,"end":` + end + `}`
}

func point(block, offset string) string { return `{"block":` + block + `,"offset":` + offset + `}` }

func terminal(n, start, end string) string {
	return `{"pane":"terminal","terminal":` + n + `,"start":` + start + `,"end":` + end + `}`
}

// padded is a raw frame of the clear message with exactly size bytes, padded with blanks (a field would be refused).
func padded(t *testing.T, size int) []byte {
	t.Helper()
	prefix := `{"type":"` + selectionMessage + `","data":{"clear":true`
	suffix := `}}`
	pad := size - len(prefix) - len(suffix)
	require.Positive(t, pad)
	return []byte(prefix + strings.Repeat(" ", pad) + suffix)
}

// selectionOf is the selection of the stageView of a snapshot (or of the REST state), as JSON: null when there is none.
func selectionOf(t *testing.T, stageView any) string {
	t.Helper()
	m, ok := stageView.(map[string]any)
	require.True(t, ok, "the snapshot has a stageView")
	require.Contains(t, m, "selection", "the stageView always says whether there is a selection")
	return mustJSON(m["selection"])
}

// Covers SPEC-057 CA-20 and CA-09 (transport): the three shapes of the message come from the presenter window and reach the panel and the
// admitted students as they are, and not the window that sent them; the service keeps the last one, or none after a clear.
func TestStageSelection_ReachesThePanelAndTheStudentsWithoutEcho(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	for _, sent := range []string{materialSelection, terminalSelection, clearSelection} {
		sendMsg(t, presenter, selectionMessage, sent)
		for _, c := range []*websocket.Conn{panel, student} {
			assert.JSONEq(t, sent, string(readUntil(t, c, selectionMessage).Data))
		}
	}
	eventually(t, func() bool { return len(w.svc.keptSelections()) == 3 })
	kept := w.svc.keptSelections()
	assert.JSONEq(t, materialSelection, kept[0])
	assert.JSONEq(t, terminalSelection, kept[1])
	assert.Equal(t, "none", kept[2], "a clear keeps no selection")
	nothingMore(t, presenter, selectionMessage)
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-057 CA-09: the edges of the ranges are valid: a block of 128 characters (characters, not bytes), the offsets from 0 to
// 1,000,000, the terminals 1 to 3, and a terminal selection whose start equals its end.
func TestStageSelection_TheEdgesOfTheRangesAreValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	valid := []string{
		material(point(`"`+strings.Repeat("b", 128)+`"`, "0"), point(`"b"`, "1000000")),
		material(point(`"`+strings.Repeat("ã", 128)+`"`, "1000000"), point(`"ã"`, "0")),
		material(point(`"b"`, "5"), point(`"b"`, "5")),
		terminal("1", "0", "0"),
		terminal("3", "0", "1000000"),
		terminal("2", "7", "7"),
	}
	for _, sent := range valid {
		sendMsg(t, presenter, selectionMessage, sent)
		assert.JSONEq(t, sent, string(readUntil(t, student, selectionMessage).Data))
	}
	eventually(t, func() bool { return len(w.svc.keptSelections()) == len(valid) })
	assert.Empty(t, droppedReasons(w))
	assert.Empty(t, w.logs.FilterMessage("classroom message rejected").All())
}

// Covers SPEC-057 CA-09 and CA-20: only the presenter window sends the selection (and its clear); from the panel it is dropped as
// wrong-view and from a student as not-controller (a student has no selection of his own to send), with an audit entry, and it is neither
// kept nor passed on.
func TestStageSelection_OnlyFromThePresenter(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, panel, selectionMessage, materialSelection)
	sendMsg(t, panel, selectionMessage, clearSelection)
	sendMsg(t, student, selectionMessage, terminalSelection)
	sendMsg(t, student, selectionMessage, clearSelection)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 4 })
	assert.ElementsMatch(t, []string{
		selectionMessage + ":wrong-view", selectionMessage + ":wrong-view",
		selectionMessage + ":not-controller", selectionMessage + ":not-controller",
	}, droppedReasons(w))
	for _, e := range w.logs.FilterMessage("classroom message dropped").All() {
		assert.NotEmpty(t, e.ContextMap()["userId"])
	}
	assert.Empty(t, w.logs.FilterMessage("classroom message rejected").All(), "they were dropped, not rejected")
	nothingMore(t, presenter, selectionMessage)
	assert.Empty(t, w.svc.keptSelections())

	// had the student or the panel got a dropped one, it would come before this one
	sendMsg(t, presenter, selectionMessage, terminalSelection)
	assert.JSONEq(t, terminalSelection, string(readUntil(t, student, selectionMessage).Data))
	assert.JSONEq(t, terminalSelection, string(readUntil(t, panel, selectionMessage).Data))
	assert.Len(t, w.svc.keptSelections(), 1)
}

// Covers SPEC-057 CA-09: a body that is none of the three shapes is rejected, with an audit entry, and is neither kept nor passed on: an
// unknown pane, a missing or mistyped field, a block that is empty or over 128 characters, a number that is not an integer or is out of
// 0 to 1,000,000, a terminal out of 1 to 3, a terminal selection that ends before it starts, and any other field. The connection goes on.
func TestStageSelection_MustBeValid(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	ok := point(`"b"`, "1")
	long := `"` + strings.Repeat("b", 129) + `"`
	bad := []string{
		// not an object, or empty
		`{}`, `null`, `"broken"`, `[1]`, `42`,
		// the clear one
		`{"clear":false}`, `{"clear":"yes"}`, `{"clear":1}`, `{"clear":null}`, `{"clear":true,"extra":1}`,
		`{"clear":true,"pane":"terminal","terminal":1,"start":0,"end":1}`,
		// the pane
		`{"pane":"slide","start":0,"end":1}`, `{"pane":"","terminal":1,"start":0,"end":1}`, `{"pane":"Material","start":` + ok + `,"end":` + ok + `}`,
		`{"pane":5}`, `{"pane":null}`, `{"pane":"material"}`, `{"pane":"terminal"}`, `{"start":` + ok + `,"end":` + ok + `}`,
		// the material
		`{"pane":"material","start":` + ok + `}`, `{"pane":"material","end":` + ok + `}`,
		material(`null`, ok), material(ok, `null`), material(`3`, ok), material(ok, `"b"`), material(`[1]`, ok),
		material(`{"offset":1}`, ok), material(point(`""`, "1"), ok), material(point(long, "1"), ok), material(point("5", "1"), ok), material(point("null", "1"), ok),
		material(`{"block":"b"}`, ok), material(`{"block":"b","offset":null}`, ok), material(point(`"b"`, "-1"), ok), material(point(`"b"`, "1000001"), ok),
		material(point(`"b"`, "1.5"), ok), material(point(`"b"`, `"3"`), ok), material(point(`"b"`, "true"), ok), material(point(`"b"`, "1e999"), ok),
		material(ok, point(`"b"`, "-1")), material(ok, point(`""`, "1")), material(ok, point(long, "1")), material(ok, point(`"b"`, "1000001")),
		material(`{"block":"b","offset":1,"extra":1}`, ok), material(ok, `{"block":"b","offset":1,"extra":1}`),
		`{"pane":"material","terminal":1,"start":` + ok + `,"end":` + ok + `}`, `{"pane":"material","start":` + ok + `,"end":` + ok + `,"foo":1}`,
		// the terminal
		`{"pane":"terminal","start":0,"end":1}`, terminal("0", "0", "1"), terminal("4", "0", "1"), terminal("-1", "0", "1"), terminal(`"1"`, "0", "1"),
		terminal("1.5", "0", "1"), terminal("null", "0", "1"), terminal("true", "0", "1"),
		`{"pane":"terminal","terminal":1,"end":1}`, `{"pane":"terminal","terminal":1,"start":0}`, terminal("1", "null", "1"), terminal("1", "0", "null"),
		terminal("1", "5", "3"), terminal("1", "1000000", "999999"), terminal("1", "-1", "1"), terminal("1", "0", "-1"), terminal("1", "0", "1000001"),
		terminal("1", "1000001", "1000001"), terminal("1", "1.5", "2"), terminal("1", "0", "1.5"), terminal("1", `"1"`, "2"), terminal("1", "0", `"2"`),
		terminal("1", ok, "2"), terminal("1", "0", ok), terminal("1", "1e999", "1e999"),
		`{"pane":"terminal","terminal":1,"start":0,"end":1,"foo":1}`, `{"pane":"terminal","terminal":1,"start":0,"end":1,"block":"b"}`,
	}
	for _, b := range bad {
		sendMsg(t, presenter, selectionMessage, b)
	}
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == len(bad) })
	assert.Empty(t, droppedReasons(w), "a bad body is rejected, not dropped")
	assert.Empty(t, w.svc.keptSelections())

	sendMsg(t, presenter, selectionMessage, terminalSelection)
	assert.JSONEq(t, terminalSelection, string(readUntil(t, student, selectionMessage).Data), "nothing bad reached the student, and the window goes on")
	assert.Len(t, w.svc.keptSelections(), 1)
}

// Covers SPEC-057 CA-09: the selection is small, at most 1 KiB for the whole frame; one byte more is rejected, with an audit entry.
func TestStageSelection_HasASmallLimit(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, padded(t, stageLimit)))
	readUntil(t, student, selectionMessage)
	eventually(t, func() bool { return len(w.svc.keptSelections()) == 1 })

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, padded(t, stageLimit+1)))
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	entry := w.logs.FilterMessage("classroom message rejected").All()[0].ContextMap()
	assert.Equal(t, selectionMessage, entry["type"])
	assert.Equal(t, "too-large", entry["reason"])
	assert.Len(t, w.svc.keptSelections(), 1, "the large one was not kept")

	sendMsg(t, presenter, selectionMessage, terminalSelection)
	assert.JSONEq(t, terminalSelection, string(readUntil(t, student, selectionMessage).Data), "the large one was not passed on, and the window goes on")
}

// Covers SPEC-057 CA-20: the selection follows the mouse, so it comes in bursts: it is not counted in the rate limit of its emitter, and the
// latest of a burst always arrives, in order, even with the pointer using up the budget of the second; the service gets every one.
func TestStageSelection_TheLatestAlwaysArrivesAndIsNotRateLimited(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for i := 0; i < 60; i++ {
		sendMsg(t, presenter, "live:cursor:move", `{"x":1,"y":2}`)
	}
	for i := 1; i <= 60; i++ {
		sendMsg(t, presenter, selectionMessage, terminal("1", "0", fmt.Sprint(i)))
	}

	last := 0
	for i := 0; i < 400 && last < 60; i++ {
		if m := readMsg(t, student); m.Type == selectionMessage {
			var d struct {
				End int `json:"end"`
			}
			require.NoError(t, json.Unmarshal(m.Data, &d))
			require.Greater(t, d.End, last, "the selections arrive in order")
			last = d.End
		}
	}
	assert.Equal(t, 60, last, "the last selection did not reach the student")
	eventually(t, func() bool { return len(w.svc.keptSelections()) == 60 })
	reasons := droppedReasons(w)
	assert.Contains(t, reasons, "live:cursor:move:rate-limit", "the budget of the second was really used up")
	assert.NotContains(t, reasons, selectionMessage+":rate-limit")
}

// Covers SPEC-057 CA-21 and CA-09: who comes in, or comes back, gets the current selection in the stageView of the snapshot, whatever the
// window (student, panel, presenter), and the REST state of the room has it too; null with no selection, and null again after a clear.
func TestStageSelection_TheSnapshotsCarryTheCurrentSelection(t *testing.T) {
	w := setup(t)
	// the student, the panel and the REST state; the presenter window is checked apart, since a new one replaces the one that sends
	check := func(want, why string) {
		t.Helper()
		for _, tc := range []struct{ token, view string }{{"student", ""}, {"teacher2", "panel"}} {
			snap := snapshotOf(t, w.dialView(t, tc.token, tc.view))
			assert.JSONEq(t, want, selectionOf(t, snap["stageView"]), "%s %s: %s", tc.token, tc.view, why)
		}
		code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
		require.Equal(t, http.StatusOK, code)
		assert.JSONEq(t, want, selectionOf(t, body["stageView"]), "REST: %s", why)
	}
	check("null", "nothing selected yet")

	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "second")
	assert.JSONEq(t, "null", selectionOf(t, snapshotOf(t, presenter)["stageView"]), "the presenter: nothing selected yet")
	readUntil(t, student, "live:snapshot")
	sendMsg(t, presenter, selectionMessage, terminalSelection)
	sendMsg(t, presenter, selectionMessage, materialSelection)
	for got := ""; !strings.Contains(got, `"material"`); {
		got = string(readUntil(t, student, selectionMessage).Data)
	}
	eventually(t, func() bool { return len(w.svc.keptSelections()) == 2 })
	check(materialSelection, "only the last selection")
	presenter = w.dialView(t, "teacher", "presenter")
	assert.JSONEq(t, materialSelection, selectionOf(t, snapshotOf(t, presenter)["stageView"]), "a new presenter window")

	sendMsg(t, presenter, selectionMessage, clearSelection)
	assert.JSONEq(t, clearSelection, string(readUntil(t, student, selectionMessage).Data))
	eventually(t, func() bool { return len(w.svc.keptSelections()) == 3 })
	check("null", "after the clear")
}

// Covers SPEC-057 CA-21: a student who is accepted after the lesson began gets the current selection with his snapshot, and nothing of the
// stage before, since a student who waits receives no broadcast.
func TestStageSelection_TheAcceptedStudentGetsTheCurrentSelection(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, presenter, selectionMessage, materialSelection)
	eventually(t, func() bool { return len(w.svc.keptSelections()) == 1 })

	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, nextMsg(t, student)), "nothing of the stage came before the admission")
	snap := nextMsg(t, student)
	require.Equal(t, "live:snapshot", snap.Type)
	var body map[string]any
	require.NoError(t, json.Unmarshal(snap.Data, &body))
	assert.JSONEq(t, materialSelection, selectionOf(t, body["stageView"]))
}
