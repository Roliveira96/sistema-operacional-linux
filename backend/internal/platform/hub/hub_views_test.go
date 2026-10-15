package hub_test

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// viewsConfig adds the rules of the two teacher windows (SPEC-055 RN-02): the stage is the presenter's, the admin the panel's.
func viewsConfig() hub.Config {
	cfg := testConfig()
	cfg.RatePerSecond = 0
	cfg.Rules["stage"] = hub.Rule{MaxBytes: 300, ControllerOnly: true, Kind: "presenter"}
	cfg.Rules["admin"] = hub.Rule{MaxBytes: 300, ControllerOnly: true, Kind: "panel"}
	return cfg
}

// dialKind connects a controller with a window kind (the test server reads it from the query string).
func (e *env) dialKind(t *testing.T, room, kind, user string) *websocket.Conn {
	t.Helper()
	q := url.Values{"room": {room}, "role": {"controller"}, "user": {user}, "kind": {kind}}
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(e.srv.URL, "http")+"/?"+q.Encode(), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// Covers SPEC-055 CA-07 and RN-01: the two windows of the teacher live together and do not revoke each other.
func TestTwoTeacherViews_DoNotRevokeEachOther(t *testing.T) {
	e := start(t, viewsConfig(), true)
	panel := e.dialKind(t, "room-1", "panel", "prof")
	presenter := e.dialKind(t, "room-1", "presenter", "prof")
	read(t, panel)
	read(t, presenter)

	send(t, panel, "slide", `{"index":1}`)
	send(t, presenter, "slide", `{"index":2}`)
	eventually(t, func() bool { return len(e.rec.received()) == 2 })
	assert.Empty(t, e.rec.droppedList(), "both windows still control the room")
	assert.True(t, e.hub.KindConnected("room-1", "panel"))
	assert.True(t, e.hub.KindConnected("room-1", "presenter"))
	assert.Equal(t, "slide", read(t, panel).Type, "and neither was told it was revoked")
	assert.Equal(t, "slide", read(t, presenter).Type)
}

// Covers SPEC-055 CA-07 and RN-01: a new window of the same kind replaces the old one, which is told and becomes passive.
func TestNewViewOfTheSameKindReplacesTheOld(t *testing.T) {
	e := start(t, viewsConfig(), true)
	oldPresenter := e.dialKind(t, "room-1", "presenter", "prof")
	panel := e.dialKind(t, "room-1", "panel", "prof")
	read(t, oldPresenter)
	read(t, panel)
	newPresenter := e.dialKind(t, "room-1", "presenter", "prof")
	read(t, newPresenter)

	assert.Equal(t, "revoked", read(t, oldPresenter).Type)
	send(t, oldPresenter, "stage", `{}`)
	eventually(t, func() bool { return len(e.rec.droppedList()) == 1 })
	assert.Equal(t, "stage:not-controller", e.rec.droppedList()[0])

	send(t, panel, "slide", `{"index":3}`)
	assert.Equal(t, "slide", read(t, newPresenter).Type, "the panel was not revoked")
	assert.Equal(t, 0, e.hub.Online("room-1"), "a replaced window is not a viewer of the room")
	assert.True(t, e.hub.KindConnected("room-1", "presenter"))
}

// Covers SPEC-055 CA-06 and RN-03: what a window of the teacher sends reaches the other window and the students, not the sender.
func TestTeacherMessagesReachTheOtherView(t *testing.T) {
	e := start(t, viewsConfig(), true)
	panel := e.dialKind(t, "room-1", "panel", "prof")
	presenter := e.dialKind(t, "room-1", "presenter", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, panel)
	read(t, presenter)
	read(t, student)

	send(t, panel, "slide", `{"index":4}`)
	assert.JSONEq(t, `{"index":4}`, string(read(t, presenter).Data))
	assert.JSONEq(t, `{"index":4}`, string(read(t, student).Data))
	nothing(t, panel, 100*time.Millisecond)
}

// Covers SPEC-055 CA-08 and RN-02: the messages of the stage only count from the presenter window.
func TestStageMessagesOnlyFromThePresenter(t *testing.T) {
	e := start(t, viewsConfig(), true)
	panel := e.dialKind(t, "room-1", "panel", "prof")
	presenter := e.dialKind(t, "room-1", "presenter", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, panel)
	read(t, presenter)
	read(t, student)

	send(t, panel, "stage", `{}`)
	eventually(t, func() bool { return len(e.rec.droppedList()) == 1 })
	assert.Equal(t, "stage:wrong-view", e.rec.droppedList()[0])
	assert.Empty(t, e.rec.received())

	send(t, presenter, "stage", `{"a":1}`)
	assert.Equal(t, "stage", read(t, student).Type)
	assert.Equal(t, "stage", read(t, panel).Type, "the panel sees what the presenter does")
}

// Covers SPEC-055 CA-08 and RN-02: the waiting room and the hands are the panel's.
func TestAdminMessagesOnlyFromThePanel(t *testing.T) {
	e := start(t, viewsConfig(), true)
	panel := e.dialKind(t, "room-1", "panel", "prof")
	presenter := e.dialKind(t, "room-1", "presenter", "prof")
	read(t, panel)
	read(t, presenter)

	send(t, presenter, "admin", `{}`)
	eventually(t, func() bool { return len(e.rec.droppedList()) == 1 })
	assert.Equal(t, "admin:wrong-view", e.rec.droppedList()[0])
	assert.Empty(t, e.rec.received())

	send(t, panel, "admin", `{}`)
	eventually(t, func() bool { return len(e.rec.received()) == 1 })
}

// Covers SPEC-055 CA-09 and RN-05: the hub knows which kinds are connected and can send to one kind only.
func TestPresenterStateIsSentToThePanel(t *testing.T) {
	e := start(t, viewsConfig(), true)
	panel := e.dialKind(t, "room-1", "panel", "prof")
	read(t, panel)
	assert.False(t, e.hub.KindConnected("room-1", "presenter"))

	presenter := e.dialKind(t, "room-1", "presenter", "prof")
	read(t, presenter)
	assert.True(t, e.hub.KindConnected("room-1", "presenter"))
	assert.True(t, e.hub.KindConnected("room-1", "panel"))

	e.hub.SendToKind("room-1", "panel", hub.Message{Type: "state"})
	assert.Equal(t, "state", read(t, panel).Type)
	nothing(t, presenter, 100*time.Millisecond)

	panel2 := e.dialKind(t, "room-2", "presenter", "prof")
	read(t, panel2)
	_ = panel2.Close()
	eventually(t, func() bool { return !e.hub.KindConnected("room-2", "presenter") })
}

// Covers SPEC-055 RN-01: the identity carries the kind to Joined and Left.
func TestJoinedAndLeftCarryTheKind(t *testing.T) {
	e := start(t, viewsConfig(), true)
	presenter := e.dialKind(t, "room-1", "presenter", "prof")
	read(t, presenter)
	eventually(t, func() bool { e.rec.mu.Lock(); defer e.rec.mu.Unlock(); return len(e.rec.joined) == 1 })
	assert.Equal(t, "presenter", e.rec.joined[0].Kind)
	_ = presenter.Close()
	eventually(t, func() bool { e.rec.mu.Lock(); defer e.rec.mu.Unlock(); return len(e.rec.left) == 1 })
	assert.Equal(t, "presenter", e.rec.left[0].Kind)
}
