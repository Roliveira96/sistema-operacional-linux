package handler_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

func snapshotOf(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	var snap map[string]any
	require.NoError(t, json.Unmarshal(readUntil(t, c, "live:snapshot").Data, &snap))
	return snap
}

func droppedReasons(w *world) []string {
	var out []string
	for _, e := range w.logs.FilterMessage("classroom message dropped").All() {
		m := e.ContextMap()
		out = append(out, m["type"].(string)+":"+m["reason"].(string))
	}
	return out
}

// Covers SPEC-055 CA-01, CA-09 and section 5: the connection takes view=panel|presenter; without it the window is the panel; an invalid
// value is refused with 400 for the teacher; the student ignores it.
func TestConnectionView(t *testing.T) {
	w := setup(t)
	w.svc.active = service.Active{Found: true, Session: w.session}

	for _, view := range []string{"", "panel"} {
		panel := snapshotOf(t, w.dialView(t, "teacher", view))
		assert.Contains(t, panel, "admissions", "view=%q is the panel", view)
		assert.Equal(t, false, panel["presenterConnected"])
		assert.Equal(t, false, panel["stageBlank"])
		assert.Equal(t, "2026-10-14T19:00:00Z", panel["startedAt"])
		assert.Contains(t, panel, "handRaises")
		assert.Contains(t, panel, "onlineCount")
		assert.NotContains(t, panel, "terminalBroadcast")
	}

	presenter := snapshotOf(t, w.dialView(t, "teacher", "presenter"))
	assert.Equal(t, false, presenter["stageBlank"])
	for _, key := range []string{"admissions", "handRaises", "onlineCount", "presenterConnected", "terminalBroadcast"} {
		assert.NotContains(t, presenter, key, "the presenter gets the stage only")
	}
	assert.EqualValues(t, 2, presenter["currentSlide"])
	assert.Contains(t, presenter, "recentDrawings")
	assert.Contains(t, presenter, "terminal")

	url := "ws" + strings.TrimPrefix(w.srv.URL, "http") + w.path("/ws?view=bogus")
	_, res, err := websocket.DefaultDialer.Dial(url, http.Header{"Cookie": []string{authn.CookieName + "=teacher"}})
	require.Error(t, err)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)

	student := snapshotOf(t, w.dialView(t, "student", "bogus"))
	assert.Equal(t, false, student["stageBlank"])
	assert.NotContains(t, student, "admissions")
}

// Covers SPEC-055 CA-07 and RN-01: the panel and the presenter do not revoke each other; a new window of the same kind replaces the old.
func TestTwoTeacherViewsLiveTogether(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")

	sendMsg(t, panel, "live:slide:change", `{"slide":3}`)
	readUntil(t, presenter, "live:slide:change")
	sendMsg(t, presenter, "live:slide:change", `{"slide":4}`)
	readUntil(t, panel, "live:slide:change")
	assert.Equal(t, []int{3, 4}, w.svc.slides, "both windows control the room")
	assert.Empty(t, droppedReasons(w))

	newPresenter := w.dialView(t, "teacher", "presenter")
	readUntil(t, newPresenter, "live:snapshot")
	readUntil(t, presenter, "live:control:revoked")
	sendMsg(t, presenter, "live:slide:change", `{"slide":9}`)
	eventually(t, func() bool { return len(droppedReasons(w)) == 1 })
	assert.Equal(t, []int{3, 4}, w.svc.slides)

	sendMsg(t, panel, "live:slide:change", `{"slide":5}`)
	readUntil(t, newPresenter, "live:slide:change")
	assert.Equal(t, []int{3, 4, 5}, w.svc.slides, "the panel kept its control")
}

// Covers SPEC-055 CA-06 and RN-03: what one window sends reaches the other window and the students, and not the sender.
func TestTeacherMessagesReachTheOtherWindow(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}
	module := uuid.New()

	sendMsg(t, presenter, "live:slide:change", `{"slide":7}`)
	assert.JSONEq(t, `{"slide":7}`, string(readUntil(t, panel, "live:slide:change").Data))
	assert.JSONEq(t, `{"slide":7}`, string(readUntil(t, student, "live:slide:change").Data))

	sendMsg(t, panel, "live:mode:switch", `{"mode":"MODULE","moduleId":"`+module.String()+`"}`)
	assert.JSONEq(t, `{"mode":"MODULE","moduleId":"`+module.String()+`"}`, string(readUntil(t, presenter, "live:mode:switch").Data))
	readUntil(t, student, "live:mode:switch")

	sendMsg(t, panel, "live:module:focus", `{"blockId":"b9"}`)
	readUntil(t, presenter, "live:module:focus")
	readUntil(t, student, "live:module:focus")

	sendMsg(t, presenter, "live:cursor:move", `{"x":1,"y":2}`)
	readUntil(t, panel, "live:cursor:move")
	readUntil(t, student, "live:cursor:move")

	nothingMore(t, panel, "live:slide:change", "live:mode:switch", "live:module:focus")
	nothingMore(t, presenter, "live:mode:switch", "live:module:focus", "live:cursor:move")
}

// Covers SPEC-055 CA-08 and RN-02: the stage messages from the panel are dropped, with an audit entry, and not passed on.
func TestStageMessagesOnlyFromThePresenter(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, panel, "live:cursor:move", `{"x":1,"y":1}`)
	sendMsg(t, panel, "live:canvas:draw", `{"path":[[1,2]]}`)
	sendMsg(t, panel, "live:terminal:screen", `{"screen":{"tag":"div","children":["ls"]}}`)
	sendMsg(t, panel, "live:stage:blank", `{"blank":true}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 4 })

	entry := w.logs.FilterMessage("classroom message dropped").All()[0].ContextMap()
	assert.Equal(t, "live:cursor:move", entry["type"])
	assert.Equal(t, "wrong-view", entry["reason"])
	assert.Equal(t, w.teacher.UserID.String(), entry["userId"])
	assert.Equal(t, []string{"live:cursor:move:wrong-view", "live:canvas:draw:wrong-view", "live:terminal:screen:wrong-view", "live:stage:blank:wrong-view"},
		droppedReasons(w), "SPEC-056 CA-08: the screen from the panel is dropped with the audit entry of the stage messages")
	nothingMore(t, student, "live:cursor:move", "live:canvas:draw", "live:terminal:screen", "live:stage:blank")
	assert.Empty(t, w.svc.drawings)
	assert.Empty(t, w.svc.keptScreens())
	assert.Empty(t, w.svc.blankSets)
}

// Covers SPEC-055 CA-08 and RN-02: the waiting room and the hands are the panel's; the presenter's attempts are dropped.
func TestAdminMessagesOnlyFromThePanel(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	id := w.student.UserID.String()

	sendMsg(t, presenter, "live:admission:accept", `{"studentId":"`+id+`"}`)
	sendMsg(t, presenter, "live:admission:accept-all", `{}`)
	sendMsg(t, presenter, "live:admission:remove", `{"studentId":"`+id+`"}`)
	sendMsg(t, presenter, "live:hand:moderate", `{"all":true}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 4 })
	assert.Empty(t, w.svc.decided)
	assert.Equal(t, 0, w.svc.called("moderate"))
	assert.Equal(t, "wrong-view", w.logs.FilterMessage("classroom message dropped").All()[0].ContextMap()["reason"])

	sendMsg(t, panel, "live:hand:moderate", `{"all":true}`)
	readUntil(t, panel, "live:hand:queue")
	assert.Equal(t, 1, w.svc.called("moderate"))
}

// Covers SPEC-055 RN-05: the line of the waiting room goes to the panel, not to the presenter.
func TestWaitingRoomQueueGoesToThePanelOnly(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")

	readUntil(t, panel, "live:admission:queue")
	nothingMore(t, presenter, "live:admission:queue")
}

// Covers SPEC-055 CA-09 and RN-05: the panel is told when the presenter window comes, goes, or is replaced.
func TestPresenterStateIsSentToThePanel(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	readUntil(t, panel, "live:snapshot")
	stateOf := func(m message) bool {
		var d struct {
			Connected bool `json:"connected"`
		}
		require.NoError(t, json.Unmarshal(m.Data, &d))
		return d.Connected
	}

	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, presenter, "live:snapshot")
	assert.True(t, stateOf(readUntil(t, panel, "live:presenter:state")))

	// replaced: the panel is never told "closed" while there is a presenter
	second := w.dialView(t, "teacher", "presenter")
	readUntil(t, second, "live:snapshot")
	readUntil(t, presenter, "live:control:revoked")
	_ = presenter.Close()
	time.Sleep(100 * time.Millisecond) // the old window leaves; the new one is still there
	sendMsg(t, second, "live:slide:change", `{"slide":2}`)
	for {
		m := readMsg(t, panel)
		if m.Type == "live:slide:change" {
			break
		}
		if m.Type == "live:presenter:state" {
			assert.True(t, stateOf(m), "the replaced window leaving does not close the presenter")
		}
	}

	_ = second.Close()
	for i := 0; ; i++ {
		require.Less(t, i, 10, "the panel was not told the presenter closed")
		if !stateOf(readUntil(t, panel, "live:presenter:state")) {
			break
		}
	}

	third := w.dialView(t, "teacher", "presenter")
	readUntil(t, third, "live:snapshot")
	late := snapshotOf(t, w.dialView(t, "teacher2", "panel"))
	assert.Equal(t, true, late["presenterConnected"], "the snapshot says the presenter is there")
}

// Covers SPEC-055 CA-17: the black screen is the presenter's, kept for who comes in later, shown to the others and ended by a new presenter.
func TestStageBlank(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{presenter, panel, student} {
		readUntil(t, c, "live:snapshot")
	}

	sendMsg(t, presenter, "live:stage:blank", `{"blank":true}`)
	assert.JSONEq(t, `{"blank":true}`, string(readUntil(t, student, "live:stage:blank").Data))
	assert.JSONEq(t, `{"blank":true}`, string(readUntil(t, panel, "live:stage:blank").Data))
	assert.True(t, w.svc.StageBlank(w.session.ID))
	nothingMore(t, presenter, "live:stage:blank")

	late := w.dialView(t, "second", "")
	assert.Equal(t, true, snapshotOf(t, late)["stageBlank"], "who comes in later sees the black screen")
	assert.Equal(t, true, snapshotOf(t, w.dialView(t, "teacher2", "panel"))["stageBlank"])

	sendMsg(t, presenter, "live:stage:blank", `{"blank":false}`)
	assert.JSONEq(t, `{"blank":false}`, string(readUntil(t, student, "live:stage:blank").Data))
	assert.False(t, w.svc.StageBlank(w.session.ID))

	sendMsg(t, presenter, "live:stage:blank", `{"blank":true}`)
	readUntil(t, student, "live:stage:blank")
	next := w.dialView(t, "teacher", "presenter")
	assert.Equal(t, false, snapshotOf(t, next)["stageBlank"], "a new presenter window starts with the stage on")
	assert.JSONEq(t, `{"blank":false}`, string(readUntil(t, student, "live:stage:blank").Data))
	assert.False(t, w.svc.StageBlank(w.session.ID))
}

// Covers SPEC-055 CA-17: a malformed black screen message is rejected without a change.
func TestStageBlankIsChecked(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	readUntil(t, presenter, "live:snapshot")
	sendMsg(t, presenter, "live:stage:blank", `"broken"`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	assert.Empty(t, w.svc.blankSets)
}

// Covers SPEC-055 CA-10: ending the room ends it for both windows; closing only one of them does not end it.
func TestClosingOneWindowDoesNotEndTheRoom(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")

	_ = presenter.Close()
	eventually(t, func() bool { return w.svc.called("presence") >= 1 })
	assert.True(t, w.h.ControllerConnected(w.session.ID), "the other window keeps the room with its teacher")
	sendMsg(t, panel, "live:slide:change", `{"slide":2}`)
	eventually(t, func() bool { w.svc.mu.Lock(); defer w.svc.mu.Unlock(); return len(w.svc.slides) == 1 })

	second := w.dialView(t, "teacher2", "presenter")
	readUntil(t, second, "live:snapshot")
	w.h.CloseRoom(w.session.ID)
	readUntil(t, panel, "live:ended")
	readUntil(t, second, "live:ended")
	eventually(t, func() bool { return !w.h.ControllerConnected(w.session.ID) })
}
