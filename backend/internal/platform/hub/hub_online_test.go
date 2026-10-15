package hub_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// onlineConfig takes up to five viewers: the tests need two tabs of one user among them.
func onlineConfig() hub.Config {
	cfg := waitingConfig()
	cfg.MaxViewers = 5
	return cfg
}

// Covers SPEC-063 section 3.1: a room that does not exist has nobody online, and the answer is an empty list (not nil, it goes to the
// panel as a JSON array).
func TestOnlineUsers_NoRoomNobody(t *testing.T) {
	e := start(t, onlineConfig(), false)
	assert.Equal(t, []string{}, e.hub.OnlineUsers("nobody"))
}

// Covers SPEC-063 CA-02 to CA-04 and section 3.1: the users of the viewers that were admitted, each one once (two tabs of a student are
// one student), in order; the waiting and the controller are not in the list, and who is admitted or sent back moves in and out of it.
func TestOnlineUsers_ViewersOnceAndInOrder(t *testing.T) {
	e := start(t, onlineConfig(), false)
	read(t, e.dial(t, "r", "viewer", "b"))
	read(t, e.dial(t, "r", "viewer", "a"))
	secondTab := e.dial(t, "r", "viewer", "a")
	read(t, secondTab)
	assert.Equal(t, 3, e.hub.Online("r"), "three connections")
	assert.Equal(t, []string{"a", "b"}, e.hub.OnlineUsers("r"), "two users, in order, with no repeat")

	read(t, e.dial(t, "r", "controller", "t"))
	read(t, e.dialWaiting(t, "r", "w"))
	assert.Equal(t, []string{"a", "b"}, e.hub.OnlineUsers("r"), "neither the controller nor who waits")

	e.hub.SetWaiting("r", "w", false)
	assert.Equal(t, []string{"a", "b", "w"}, e.hub.OnlineUsers("r"), "admitted")
	e.hub.SetWaiting("r", "w", true)
	assert.Equal(t, []string{"a", "b"}, e.hub.OnlineUsers("r"), "sent back to the waiting room")

	_ = secondTab.Close()
	require.Eventually(t, func() bool { return e.hub.Online("r") == 2 }, 2*time.Second, 5*time.Millisecond)
	assert.Equal(t, []string{"a", "b"}, e.hub.OnlineUsers("r"), "he still has the other tab")
}

// Covers SPEC-063 section 3.1: a user leaves the list with his last connection.
func TestOnlineUsers_LeavesWithTheLastConnection(t *testing.T) {
	e := start(t, onlineConfig(), false)
	first := e.dial(t, "r", "viewer", "a")
	read(t, first)
	read(t, e.dial(t, "r", "viewer", "b"))
	require.Equal(t, []string{"a", "b"}, e.hub.OnlineUsers("r"))

	_ = first.Close()
	require.Eventually(t, func() bool { return len(e.hub.OnlineUsers("r")) == 1 }, 2*time.Second, 5*time.Millisecond)
	assert.Equal(t, []string{"b"}, e.hub.OnlineUsers("r"))
}

// Covers SPEC-063 section 3.1: a window of the teacher that another one replaced goes on as a passive viewer; it is not a student online.
func TestOnlineUsers_ReplacedControllerIsNotOnline(t *testing.T) {
	e := start(t, onlineConfig(), false)
	old := e.dial(t, "r", "controller", "t")
	read(t, old)
	read(t, e.dial(t, "r", "controller", "t2"))
	assert.Equal(t, "revoked", read(t, old).Type)

	assert.Equal(t, []string{}, e.hub.OnlineUsers("r"), "the old window is a viewer that does not count")
}
