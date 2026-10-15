package hub_test

import (
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// Covers SPEC-058 section 3.2: a message can go to the part of the room that a filter picks (the queue of hands has the questions for the
// panel and has none for the students and the presentation window): the filter sees the identity of each connection, and the ones that
// wait to be admitted never get it.
func TestBroadcastTo_OnlyWhoTheFilterPicks(t *testing.T) {
	e := start(t, viewsConfig(), false)
	panel := e.dialKind(t, "room-1", "panel", "prof")
	presenter := e.dialKind(t, "room-1", "presenter", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	waiting := e.dialWaiting(t, "room-1", "bia")
	read(t, panel)
	read(t, presenter)
	read(t, student)
	read(t, waiting)

	var seen []hub.Identity
	notPanel := func(who hub.Identity) bool {
		seen = append(seen, who)
		return !(who.Role == hub.Controller && who.Kind == "panel")
	}
	e.hub.BroadcastTo("room-1", hub.Message{Type: "queue", Data: json.RawMessage(`{"plain":true}`)}, notPanel)
	assert.JSONEq(t, `{"plain":true}`, string(read(t, presenter).Data), "the presentation window is not the panel")
	assert.JSONEq(t, `{"plain":true}`, string(read(t, student).Data), "a student is not the panel")

	roles := map[hub.Role]int{}
	kinds := map[string]int{}
	for _, who := range seen {
		assert.False(t, who.Waiting, "the filter is not even asked about who waits")
		roles[who.Role]++
		kinds[who.Kind]++
		assert.NotEmpty(t, who.ConnID, "the filter sees the identity of the connection")
	}
	assert.Equal(t, map[hub.Role]int{hub.Controller: 2, hub.Viewer: 1}, roles)
	assert.Equal(t, map[string]int{"panel": 1, "presenter": 1, "": 1}, kinds)

	e.hub.BroadcastTo("room-1", hub.Message{Type: "only-ana"}, func(who hub.Identity) bool { return who.UserID == "ana" })
	assert.Equal(t, "only-ana", read(t, student).Type)

	e.hub.BroadcastTo("room-1", hub.Message{Type: "nobody"}, func(hub.Identity) bool { return false })
	e.hub.BroadcastTo("no-such-room", hub.Message{Type: "nobody"}, func(hub.Identity) bool { return true })
	// a read that times out ends a connection for the test, so each one is checked for silence once, at the end
	nothing(t, panel, 150*time.Millisecond)
	nothing(t, waiting, 50*time.Millisecond)
	nothing(t, presenter, 50*time.Millisecond)
	nothing(t, student, 50*time.Millisecond)
}

// Covers SPEC-058 section 3.2: the filtered message follows the rule of its type, as a broadcast does: with Coalesce, each connection gets
// only the latest of the window.
func TestBroadcastTo_FollowsTheRuleOfTheType(t *testing.T) {
	e := start(t, viewsConfig(), false)
	panel := e.dialKind(t, "room-1", "panel", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, panel)
	read(t, student)

	for i := 1; i <= 5; i++ {
		e.hub.BroadcastTo("room-1", hub.Message{Type: "cursor", Data: json.RawMessage(`{"i":` + strconv.Itoa(i) + `}`)},
			func(who hub.Identity) bool { return who.Role == hub.Viewer })
	}
	assert.JSONEq(t, `{"i":5}`, string(read(t, student).Data), "only the latest of the window")
	nothing(t, student, 100*time.Millisecond)
	nothing(t, panel, 50*time.Millisecond)
	require.True(t, e.hub.KindConnected("room-1", "panel"))
}
