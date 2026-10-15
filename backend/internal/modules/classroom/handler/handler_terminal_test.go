package handler_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- SPEC-056: the mirror of the terminal screen ----

const (
	screenMessage = "live:terminal:screen"
	screenLimit   = 256 << 10 // the frame of a terminal screen has at most 256 KB
)

// screenFrame is a raw frame of the screen message with exactly size bytes.
func screenFrame(t *testing.T, size int) []byte {
	t.Helper()
	prefix := `{"type":"` + screenMessage + `","data":{"screen":{"tag":"pre","children":["`
	suffix := `"]}}}`
	pad := size - len(prefix) - len(suffix)
	require.Positive(t, pad)
	return []byte(prefix + strings.Repeat("x", pad) + suffix)
}

// screenNumber is the number the test wrote in a screen message ("n3" is 3); numbered builds the data of such a message.
func screenNumber(t *testing.T, m message) int {
	t.Helper()
	var d struct {
		Screen struct {
			Children []string `json:"children"`
		} `json:"screen"`
	}
	require.NoError(t, json.Unmarshal(m.Data, &d))
	require.Len(t, d.Screen.Children, 1)
	n, err := strconv.Atoi(strings.TrimPrefix(d.Screen.Children[0], "n"))
	require.NoError(t, err)
	return n
}

func numbered(n int) string { return fmt.Sprintf(`{"screen":{"tag":"div","children":["n%d"]}}`, n) }

// Covers SPEC-056 CA-08 and CA-03 (transport): the screen of the presenter window reaches the panel and the admitted students, and not
// the window that sent it; the service keeps the screen, and nothing else of the message.
func TestTerminalScreen_ReachesThePanelAndTheStudentsWithoutEcho(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}
	screen := `{"tag":"div","attrs":{"class":"term"},"children":["$ ls",{"tag":"span","children":["a b"]}]}`

	sendMsg(t, presenter, screenMessage, `{"screen":`+screen+`}`)
	assert.JSONEq(t, `{"screen":`+screen+`}`, string(readUntil(t, panel, screenMessage).Data))
	assert.JSONEq(t, `{"screen":`+screen+`}`, string(readUntil(t, student, screenMessage).Data))
	eventually(t, func() bool { return len(w.svc.keptScreens()) == 1 })
	assert.JSONEq(t, screen, w.svc.keptScreens()[0])
	nothingMore(t, presenter, screenMessage)
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-056 CA-08: only the presenter window sends the screen; from the panel it is dropped as wrong-view and from a student as
// not-controller, with an audit entry, and it is neither kept nor passed on.
func TestTerminalScreen_OnlyFromThePresenter(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, panel, screenMessage, `{"screen":{"tag":"div"}}`)
	sendMsg(t, student, screenMessage, `{"screen":{"tag":"div"}}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 2 })
	assert.ElementsMatch(t, []string{screenMessage + ":wrong-view", screenMessage + ":not-controller"}, droppedReasons(w))
	for _, e := range w.logs.FilterMessage("classroom message dropped").All() {
		assert.Equal(t, screenMessage, e.ContextMap()["type"])
		assert.NotEmpty(t, e.ContextMap()["userId"])
	}
	nothingMore(t, presenter, screenMessage)
	assert.Empty(t, w.svc.keptScreens())

	// the student and the presenter did get nothing: the next thing the presenter sends is the first screen they see
	sendMsg(t, presenter, screenMessage, numbered(1))
	assert.Equal(t, 1, screenNumber(t, readUntil(t, student, screenMessage)))
	assert.Equal(t, 1, screenNumber(t, readUntil(t, panel, screenMessage)))
}

// Covers SPEC-056 CA-08: what is not an object is rejected, with an audit entry, and it is neither kept nor passed on; the connection
// goes on.
func TestTerminalScreen_MustBeAnObject(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for _, bad := range []string{`{"screen":"text"}`, `{"screen":null}`, `{"screen":[{"tag":"div"}]}`, `{"screen":42}`, `{"screen":true}`, `{}`, `"broken"`} {
		sendMsg(t, presenter, screenMessage, bad)
	}
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 7 })
	assert.Empty(t, droppedReasons(w), "a bad body is rejected, not dropped")
	assert.Empty(t, w.svc.keptScreens())

	sendMsg(t, presenter, screenMessage, numbered(1))
	assert.Equal(t, 1, screenNumber(t, readUntil(t, student, screenMessage)), "nothing bad reached the student, and the window goes on")
	assert.Len(t, w.svc.keptScreens(), 1)
}

// Covers SPEC-056 CA-08: the screen has its own limit of 256 KB for the whole frame; one byte more is rejected, with an audit entry.
func TestTerminalScreen_HasItsOwnLimit(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, screenFrame(t, screenLimit)))
	got := readUntil(t, student, screenMessage)
	assert.Greater(t, len(got.Data), screenLimit-100, "a frame of exactly 256 KB goes through whole")
	eventually(t, func() bool { return len(w.svc.keptScreens()) == 1 })

	require.NoError(t, presenter.WriteMessage(websocket.TextMessage, screenFrame(t, screenLimit+1)))
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	entry := w.logs.FilterMessage("classroom message rejected").All()[0].ContextMap()
	assert.Equal(t, screenMessage, entry["type"])
	assert.Equal(t, "too-large", entry["reason"])
	assert.Len(t, w.svc.keptScreens(), 1, "the large one was not kept")

	sendMsg(t, presenter, screenMessage, numbered(2))
	assert.Equal(t, 2, screenNumber(t, readUntil(t, student, screenMessage)), "the large one was not passed on, and the window goes on")
}

// Covers SPEC-056 CA-08: a frame far over the limit never reaches anyone; the connection that sent it is closed.
func TestTerminalScreen_FarOverTheLimitEndsTheConnection(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	_ = presenter.WriteMessage(websocket.TextMessage, screenFrame(t, 3*screenLimit)) // the server may hang up before it takes the whole frame
	require.NoError(t, presenter.SetReadDeadline(time.Now().Add(2*time.Second)))
	var err error
	for err == nil {
		_, _, err = presenter.ReadMessage()
	}
	var netErr net.Error
	assert.False(t, errors.As(err, &netErr) && netErr.Timeout(), "the server closed the connection, it did not just stay quiet: %v", err)
	assert.Empty(t, w.svc.keptScreens())
	require.NoError(t, student.SetReadDeadline(time.Now().Add(200*time.Millisecond)))
	for {
		var m message
		err := student.ReadJSON(&m)
		if err != nil {
			break
		}
		require.NotEqual(t, screenMessage, m.Type, "the student got the huge screen")
	}
}

// Covers SPEC-056 CA-03: the screens of a burst reach the students in order, and the last one always arrives, so what they see is the
// screen the teacher has; the service gets every one of them.
func TestTerminalScreen_TheLatestAlwaysArrivesInOrder(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	for i := 1; i <= 5; i++ {
		sendMsg(t, presenter, screenMessage, numbered(i))
	}
	for _, c := range []*websocket.Conn{panel, student} {
		last := 0
		for last < 5 {
			n := screenNumber(t, readUntil(t, c, screenMessage))
			require.Greater(t, n, last, "the screens arrive in order")
			last = n
		}
	}
	eventually(t, func() bool { return len(w.svc.keptScreens()) == 5 })
	assert.JSONEq(t, `{"tag":"div","children":["n5"]}`, w.svc.keptScreens()[4])
}

// Covers SPEC-056 CA-03: the screen is not counted in the rate limit of its emitter; with the pointer of the teacher using up the budget
// of the second, the last screen still reaches the students, so they do not stay with an old one.
func TestTerminalScreen_NotHeldBackByTheCursorRate(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for i := 0; i < 60; i++ {
		sendMsg(t, presenter, "live:cursor:move", `{"x":1,"y":2}`)
	}
	sendMsg(t, presenter, screenMessage, numbered(1))

	got := false
	for i := 0; i < 100 && !got; i++ {
		if m := readMsg(t, student); m.Type == screenMessage {
			assert.Equal(t, 1, screenNumber(t, m))
			got = true
		}
	}
	assert.True(t, got, "the screen did not reach the student")
	eventually(t, func() bool { return len(w.svc.keptScreens()) == 1 })
	reasons := droppedReasons(w)
	assert.Contains(t, reasons, "live:cursor:move:rate-limit", "the budget of the second was really used up")
	assert.NotContains(t, reasons, screenMessage+":rate-limit")
}

// Covers SPEC-056 CA-05: who comes in, or comes back, gets the current screen in the snapshot, whatever the window: student, panel and
// presenter; and a new presenter window does not erase it. The REST state of the room has it too.
func TestTerminalScreen_TheSnapshotsCarryTheCurrentScreen(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, presenter, screenMessage, numbered(1))
	sendMsg(t, presenter, screenMessage, numbered(2))
	for n := 0; n < 2; {
		n = screenNumber(t, readUntil(t, student, screenMessage))
	}
	want := `{"screen":{"tag":"div","children":["n2"]}}`

	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "second", ""))["terminal"]), "a student who comes in later")
	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "teacher2", "panel"))["terminal"]), "the panel that opens later")

	next := w.dialView(t, "teacher", "presenter")
	assert.JSONEq(t, want, mustJSON(snapshotOf(t, next)["terminal"]), "a new presenter window starts with the screen the room has")
	assert.JSONEq(t, want, mustJSON(snapshotOf(t, w.dialView(t, "second", ""))["terminal"]), "and does not erase it")

	code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, want, mustJSON(body["terminal"]))
}

// Covers SPEC-056 CA-05 and CA-09: with no screen the terminal of the snapshot has the screen key empty and nothing else, for the
// student, the panel and the presenter.
func TestTerminalScreen_SnapshotsWithoutAScreen(t *testing.T) {
	w := setup(t)
	for _, tc := range []struct{ token, view string }{{"student", ""}, {"teacher", "panel"}, {"teacher2", "presenter"}} {
		snap := snapshotOf(t, w.dialView(t, tc.token, tc.view))
		assert.JSONEq(t, `{"screen":null}`, mustJSON(snap["terminal"]), "%s %s", tc.token, tc.view)
	}
}

// Covers SPEC-056 CA-05: a student who is accepted after the lesson began gets the current screen with his snapshot, and nothing of the
// screens before, since a student who waits receives no broadcast.
func TestTerminalScreen_TheAcceptedStudentGetsTheCurrentScreen(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, presenter, screenMessage, numbered(1))
	sendMsg(t, presenter, screenMessage, numbered(2))
	eventually(t, func() bool { return len(w.svc.keptScreens()) == 2 })

	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, nextMsg(t, student)), "nothing of the stage came before the admission")
	snap := nextMsg(t, student)
	require.Equal(t, "live:snapshot", snap.Type)
	var body map[string]any
	require.NoError(t, json.Unmarshal(snap.Data, &body))
	assert.JSONEq(t, `{"screen":{"tag":"div","children":["n2"]}}`, mustJSON(body["terminal"]))
}
