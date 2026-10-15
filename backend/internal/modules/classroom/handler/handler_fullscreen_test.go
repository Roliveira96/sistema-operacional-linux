package handler_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- SPEC-059: the full screen of the students, asked by the teacher ----

const fullscreenMessage = "live:stage:fullscreen"

// fullscreenOf is the stageView.fullscreen of a snapshot or of the REST state.
func fullscreenOf(t *testing.T, body map[string]any) bool {
	t.Helper()
	view, ok := body["stageView"].(map[string]any)
	require.True(t, ok, "there is a stageView")
	require.Contains(t, view, "fullscreen", "the stageView always says whether the full screen was asked")
	on, ok := view["fullscreen"].(bool)
	require.True(t, ok, "fullscreen is a boolean")
	return on
}

// Covers SPEC-059 CA-07 and section 3.2 (transport): the request comes from the panel and from the presentation window, the two windows of
// the teacher; it reaches the other window and the admitted students as it is, and not the window that sent it; the service keeps it.
func TestFullscreen_FromEitherWindowReachesTheOtherAndTheStudentsWithoutEcho(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, panel, fullscreenMessage, `{"enabled":true}`)
	for _, c := range []*websocket.Conn{presenter, student} {
		assert.JSONEq(t, `{"enabled":true}`, string(readUntil(t, c, fullscreenMessage).Data), "from the panel")
	}
	sendMsg(t, presenter, fullscreenMessage, `{"enabled":false}`)
	for _, c := range []*websocket.Conn{panel, student} {
		assert.JSONEq(t, `{"enabled":false}`, string(readUntil(t, c, fullscreenMessage).Data), "from the presentation window; the first thing the panel gets is not its own request")
	}
	eventually(t, func() bool { return len(w.svc.keptFullscreens()) == 2 })
	assert.Equal(t, []bool{true, false}, w.svc.keptFullscreens())
	nothingMore(t, presenter, fullscreenMessage)
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-059 CA-07: a student cannot ask for it: it is dropped as not-controller, with an audit entry, and it is neither kept nor passed
// on; a window of the teacher that another window replaced is a viewer now, and is dropped the same way.
func TestFullscreen_NotFromAStudentNorFromAReplacedWindow(t *testing.T) {
	w := setup(t)
	oldPanel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{oldPanel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}
	newPanel := w.dialView(t, "teacher2", "panel")
	readUntil(t, newPanel, "live:snapshot")
	readUntil(t, oldPanel, "live:control:revoked")

	sendMsg(t, student, fullscreenMessage, `{"enabled":true}`)
	sendMsg(t, oldPanel, fullscreenMessage, `{"enabled":true}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 2 })
	assert.Equal(t, []string{fullscreenMessage + ":not-controller", fullscreenMessage + ":not-controller"}, droppedReasons(w))
	for _, e := range w.logs.FilterMessage("classroom message dropped").All() {
		assert.Equal(t, fullscreenMessage, e.ContextMap()["type"])
		assert.NotEmpty(t, e.ContextMap()["userId"])
	}
	assert.Empty(t, w.logs.FilterMessage("classroom message rejected").All(), "dropped, not rejected")
	assert.Empty(t, w.svc.keptFullscreens())

	// had anybody got a dropped one, it would come before this one
	sendMsg(t, newPanel, fullscreenMessage, `{"enabled":true}`)
	assert.JSONEq(t, `{"enabled":true}`, string(readUntil(t, student, fullscreenMessage).Data))
	assert.JSONEq(t, `{"enabled":true}`, string(readUntil(t, presenter, fullscreenMessage).Data))
	assert.Equal(t, []bool{true}, w.svc.keptFullscreens())
}

// Covers SPEC-059 CA-07: enabled is required and must be a boolean: missing, null, a string, a number, a list, an object, or a body that is
// not an object is rejected, with an audit entry, and is neither kept nor passed on; the connection goes on.
func TestFullscreen_EnabledMustBeABoolean(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}

	bad := []string{
		`{}`, `{"enable":true}`, `{"enabled":null}`, `{"enabled":"true"}`, `{"enabled":"false"}`, `{"enabled":""}`, `{"enabled":1}`, `{"enabled":0}`,
		`{"enabled":1.5}`, `{"enabled":[true]}`, `{"enabled":{"value":true}}`, `null`, `"broken"`, `[true]`, `true`, `42`,
	}
	for _, b := range bad {
		sendMsg(t, panel, fullscreenMessage, b)
	}
	for _, b := range bad[:4] { // and from the other window
		sendMsg(t, presenter, fullscreenMessage, b)
	}
	total := len(bad) + 4
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == total })
	assert.Empty(t, droppedReasons(w), "a bad body is rejected, not dropped")
	assert.Empty(t, w.svc.keptFullscreens())

	sendMsg(t, panel, fullscreenMessage, `{"enabled":true}`)
	assert.JSONEq(t, `{"enabled":true}`, string(readUntil(t, student, fullscreenMessage).Data), "nothing bad reached the student, and the window goes on")
	assert.Equal(t, []bool{true}, w.svc.keptFullscreens())
}

// Covers SPEC-059 section 3.2: the request is tiny, at most 256 bytes for the whole frame; one byte more is rejected, with an audit entry.
func TestFullscreen_HasASmallLimit(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	require.NoError(t, panel.WriteMessage(websocket.TextMessage, stageFrame(t, fullscreenMessage, `{"enabled":true}`, 256)))
	readUntil(t, student, fullscreenMessage)
	eventually(t, func() bool { return len(w.svc.keptFullscreens()) == 1 })

	require.NoError(t, panel.WriteMessage(websocket.TextMessage, stageFrame(t, fullscreenMessage, `{"enabled":false}`, 257)))
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	entry := w.logs.FilterMessage("classroom message rejected").All()[0].ContextMap()
	assert.Equal(t, fullscreenMessage, entry["type"])
	assert.Equal(t, "too-large", entry["reason"])
	assert.Equal(t, []bool{true}, w.svc.keptFullscreens(), "the large one was not kept")

	sendMsg(t, panel, fullscreenMessage, `{"enabled":false}`)
	assert.JSONEq(t, `{"enabled":false}`, string(readUntil(t, student, fullscreenMessage).Data), "the large one was not passed on, and the window goes on")
}

// Covers SPEC-059 section 3.2: the request is not counted in the rate limit of its emitter, and the latest of a burst of switches always
// arrives last, so the students end in the state the teacher left, even with the pointer using up the budget of the second.
func TestFullscreen_TheLatestAlwaysArrivesAndIsNotRateLimited(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for i := 0; i < 60; i++ {
		sendMsg(t, presenter, "live:cursor:move", `{"x":1,"y":2}`)
	}
	for i := 1; i <= 61; i++ { // on, off, on... and the last, the 61st, is on
		sendMsg(t, presenter, fullscreenMessage, `{"enabled":`+strconv.FormatBool(i%2 == 1)+`}`)
	}
	eventually(t, func() bool { return len(w.svc.keptFullscreens()) == 61 })

	var last *bool
	for {
		require.NoError(t, student.SetReadDeadline(time.Now().Add(400*time.Millisecond)))
		var m message
		if err := student.ReadJSON(&m); err != nil {
			break
		}
		if m.Type == fullscreenMessage {
			var d struct {
				Enabled bool `json:"enabled"`
			}
			require.NoError(t, json.Unmarshal(m.Data, &d))
			last = &d.Enabled
		}
	}
	require.NotNil(t, last, "the request reached the student")
	assert.True(t, *last, "and the last one he got is the last one the teacher sent")
	reasons := droppedReasons(w)
	assert.Contains(t, reasons, "live:cursor:move:rate-limit", "the budget of the second was really used up")
	assert.NotContains(t, reasons, fullscreenMessage+":rate-limit")
}

// Covers SPEC-059 CA-06 and CA-07: who comes in, or comes back, gets the state in stageView.fullscreen of the snapshot, whatever the window
// (student, panel, presenter), and the REST state of the room has it too: false by default, true after the request, false after it is off.
func TestFullscreen_TheSnapshotsCarryTheState(t *testing.T) {
	w := setup(t)
	check := func(want bool, why string) {
		t.Helper()
		for _, tc := range []struct{ token, view string }{{"student", ""}, {"teacher2", "panel"}} {
			assert.Equal(t, want, fullscreenOf(t, snapshotOf(t, w.dialView(t, tc.token, tc.view))), "%s %s: %s", tc.token, tc.view, why)
		}
		code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
		require.Equal(t, http.StatusOK, code)
		assert.Equal(t, want, fullscreenOf(t, body), "REST: %s", why)
	}
	check(false, "nobody asked yet")

	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "second")
	assert.False(t, fullscreenOf(t, snapshotOf(t, presenter)), "the presenter: nobody asked yet")
	readUntil(t, student, "live:snapshot")
	sendMsg(t, presenter, fullscreenMessage, `{"enabled":true}`)
	readUntil(t, student, fullscreenMessage)
	eventually(t, func() bool { return len(w.svc.keptFullscreens()) == 1 })
	check(true, "after the request")
	presenter = w.dialView(t, "teacher", "presenter")
	assert.True(t, fullscreenOf(t, snapshotOf(t, presenter)), "a new presentation window")

	sendMsg(t, presenter, fullscreenMessage, `{"enabled":false}`)
	assert.JSONEq(t, `{"enabled":false}`, string(readUntil(t, student, fullscreenMessage).Data))
	eventually(t, func() bool { return len(w.svc.keptFullscreens()) == 2 })
	check(false, "after it was turned off")
}

// Covers SPEC-059 CA-06: a student who is accepted after the request was made gets the state with his snapshot, and nothing of the stage
// before, since a student who waits receives no broadcast.
func TestFullscreen_TheAcceptedStudentGetsTheState(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	readUntil(t, panel, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, panel, fullscreenMessage, `{"enabled":true}`)
	eventually(t, func() bool { return len(w.svc.keptFullscreens()) == 1 })

	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, nextMsg(t, student)), "nothing of the stage came before the admission")
	snap := nextMsg(t, student)
	require.Equal(t, "live:snapshot", snap.Type)
	var body map[string]any
	require.NoError(t, json.Unmarshal(snap.Data, &body))
	assert.True(t, fullscreenOf(t, body))
}
