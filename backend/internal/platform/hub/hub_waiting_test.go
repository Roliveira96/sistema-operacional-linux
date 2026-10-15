package hub_test

import (
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

func waitingConfig() hub.Config {
	cfg := testConfig()
	cfg.Rules["request"] = hub.Rule{MaxBytes: 100, AllowWaiting: true}
	cfg.MaxWaiting = 2
	return cfg
}

func (e *env) dialWaiting(t *testing.T, room, user string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/?room=" + room + "&role=viewer&waiting=1&user=" + user
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// Covers SPEC-054 RN-02: a connection in the waiting room gets its snapshot but nothing of what the room broadcasts.
func TestWaiting_DoesNotReceiveBroadcast(t *testing.T) {
	e := start(t, waitingConfig(), true)
	teacher := e.dial(t, "r", "controller", "t")
	read(t, teacher)
	waiter := e.dialWaiting(t, "r", "w")
	assert.Equal(t, "snap", read(t, waiter).Type, "the snapshot of the waiting room is delivered")
	admitted := e.dial(t, "r", "viewer", "a")
	read(t, admitted)

	send(t, teacher, "slide", `{"n":2}`)
	assert.Equal(t, "slide", read(t, admitted).Type)
	nothing(t, waiter, 150*time.Millisecond)
}

// Covers SPEC-054 RN-01/RN-05: the waiting do not count among the viewers, and have their own ceiling.
func TestWaiting_CountsApartAndHasItsOwnCeiling(t *testing.T) {
	e := start(t, waitingConfig(), false)
	read(t, e.dial(t, "r", "viewer", "a1"))
	read(t, e.dial(t, "r", "viewer", "a2"))
	read(t, e.dialWaiting(t, "r", "w1"))
	read(t, e.dialWaiting(t, "r", "w2"))
	assert.Equal(t, 2, e.hub.Online("r"), "the waiting are not online viewers")

	url := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/?room=r&role=viewer&waiting=1&user=w3"
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(t, err)
	defer c.Close()
	require.Error(t, drain(c), "the waiting room is full")
	assert.ErrorIs(t, <-e.errs, hub.ErrRoomFull)
}

func drain(c *websocket.Conn) error {
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	var m hub.Message
	return c.ReadJSON(&m)
}

// Covers SPEC-054 RN-01: a waiting connection may only send the types that allow it; the rest is dropped as not-admitted.
func TestWaiting_OnlyAllowedTypesReachTheHandler(t *testing.T) {
	e := start(t, waitingConfig(), false)
	waiter := e.dialWaiting(t, "r", "w")
	read(t, waiter)
	send(t, waiter, "raise", `{}`)
	send(t, waiter, "request", `{}`)
	require.Eventually(t, func() bool { return len(e.rec.received()) == 1 }, time.Second, 10*time.Millisecond)
	assert.Equal(t, "request", e.rec.received()[0].Type)
	assert.Contains(t, e.rec.droppedList(), "raise:not-admitted")
}

// Covers SPEC-054 RN-02: SendTo reaches the connections of one user, in the waiting room too, and nobody else.
func TestSendTo_ReachesOnlyThatUser(t *testing.T) {
	e := start(t, waitingConfig(), false)
	waiter := e.dialWaiting(t, "r", "w")
	read(t, waiter)
	other := e.dial(t, "r", "viewer", "o")
	read(t, other)

	e.hub.SendTo("r", "w", hub.Message{Type: "hello"})
	assert.Equal(t, "hello", read(t, waiter).Type)
	nothing(t, other, 100*time.Millisecond)
}

// Covers SPEC-054 RN-02: SetWaiting(false) releases the connection to the broadcasts, and SetWaiting(true) takes it back.
// (a read that timed out breaks the socket, so each step is told apart by the type of the next message that arrives.)
func TestSetWaiting_ChangesWhatTheConnectionReceives(t *testing.T) {
	e := start(t, waitingConfig(), false)
	waiter := e.dialWaiting(t, "r", "w")
	read(t, waiter)
	e.hub.Broadcast("r", hub.Message{Type: "while-waiting"}, "")

	e.hub.SetWaiting("r", "w", false)
	assert.Equal(t, 1, e.hub.Online("r"))
	e.hub.Broadcast("r", hub.Message{Type: "admitted"}, "")
	assert.Equal(t, "admitted", read(t, waiter).Type)

	e.hub.SetWaiting("r", "w", true)
	assert.Equal(t, 0, e.hub.Online("r"))
	e.hub.Broadcast("r", hub.Message{Type: "sent-back"}, "")
	e.hub.SetWaiting("r", "w", false)
	e.hub.Broadcast("r", hub.Message{Type: "again"}, "")
	assert.Equal(t, "again", read(t, waiter).Type)
}

// Covers SPEC-054 RN-01: the identity carries the waiting flag and the opaque meta that the application set.
func TestIdentity_CarriesWaitingAndMeta(t *testing.T) {
	e := start(t, waitingConfig(), false)
	read(t, e.dial(t, "r", "controller", "t"))
	w := e.dialWaiting(t, "r", "w")
	read(t, w)
	require.Eventually(t, func() bool { e.rec.mu.Lock(); defer e.rec.mu.Unlock(); return len(e.rec.joined) == 2 }, time.Second, 10*time.Millisecond)
	e.rec.mu.Lock()
	defer e.rec.mu.Unlock()
	assert.False(t, e.rec.joined[0].Waiting)
	assert.True(t, e.rec.joined[1].Waiting)
}

// Covers SPEC-054 RN-05: SendToController reaches the controller and nobody else; without a controller it does nothing.
func TestSendToController(t *testing.T) {
	e := start(t, waitingConfig(), false)
	e.hub.SendToController("r", hub.Message{Type: "x"}) // no room: nothing happens
	viewer := e.dial(t, "r", "viewer", "v")
	read(t, viewer)
	teacher := e.dial(t, "r", "controller", "t")
	read(t, teacher)
	e.hub.SendToController("r", hub.Message{Type: "queue"})
	assert.Equal(t, "queue", read(t, teacher).Type)
	nothing(t, viewer, 100*time.Millisecond)
}

// A room that only has waiting connections is closed with them: Close reaches the waiting too.
func TestClose_ReachesTheWaiting(t *testing.T) {
	e := start(t, waitingConfig(), false)
	waiter := e.dialWaiting(t, "r", "w")
	read(t, waiter)
	e.hub.Close("r", hub.Message{Type: "ended"})
	assert.Equal(t, "ended", read(t, waiter).Type)
}
