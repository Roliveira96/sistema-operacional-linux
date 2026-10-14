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

// paneKey is the key of a rule that keeps one place in the window for each pane of the message.
func paneKey(msg hub.Message) string {
	var d struct {
		Pane string `json:"pane"`
	}
	_ = json.Unmarshal(msg.Data, &d)
	return d.Pane
}

func keyedConfig() hub.Config {
	cfg := testConfig()
	cfg.RatePerSecond = 0
	cfg.Rules["scroll"] = hub.Rule{MaxBytes: 300, ControllerOnly: true, Coalesce: true, CoalesceKey: paneKey}
	return cfg
}

// Covers SPEC-057 CA-23: a rule that coalesces may say what the latest message is the latest of: with a CoalesceKey, messages of the same
// type that have different keys each keep their own place in the window, and only the ones with the same key are merged.
func TestCoalesceKey_DifferentKeysAreNotMerged(t *testing.T) {
	e := start(t, keyedConfig(), true)
	teacher := e.dial(t, "room-1", "controller", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, teacher)
	read(t, student)

	for i := 1; i <= 3; i++ {
		for _, pane := range []string{"terminal1", "terminal2", "slide"} {
			send(t, teacher, "scroll", `{"pane":"`+pane+`","n":`+strconv.Itoa(i)+`}`)
		}
	}
	got := map[string]int{}
	for len(got) < 3 {
		var d struct {
			Pane string `json:"pane"`
			N    int    `json:"n"`
		}
		require.NoError(t, json.Unmarshal(read(t, student).Data, &d))
		require.GreaterOrEqual(t, d.N, got[d.Pane], "in order, for each key")
		got[d.Pane] = d.N
		if got["terminal1"] == 3 && got["terminal2"] == 3 && got["slide"] == 3 {
			break
		}
	}
	assert.Equal(t, map[string]int{"terminal1": 3, "terminal2": 3, "slide": 3}, got, "the latest of each key arrived: none took the place of another")
	nothing(t, student, 150*time.Millisecond)
}

// Covers SPEC-057 CA-23: within one window, each key delivers only its latest message, once.
func TestCoalesceKey_OneMessageForEachKeyInTheWindow(t *testing.T) {
	e := start(t, keyedConfig(), false)
	teacher := e.dial(t, "room-1", "controller", "prof")
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, teacher)
	read(t, student)

	for i := 1; i <= 4; i++ {
		e.hub.Broadcast("room-1", hub.Message{Type: "scroll", Data: json.RawMessage(`{"pane":"a","n":` + strconv.Itoa(i) + `}`)}, "")
		e.hub.Broadcast("room-1", hub.Message{Type: "scroll", Data: json.RawMessage(`{"pane":"b","n":` + strconv.Itoa(i*10) + `}`)}, "")
	}
	first, second := read(t, student), read(t, student)
	assert.JSONEq(t, `{"pane":"a","n":4}`, string(first.Data), "in the order of the keys")
	assert.JSONEq(t, `{"pane":"b","n":40}`, string(second.Data))
	nothing(t, student, 150*time.Millisecond)
}

// A rule without a key still merges by type, as before.
func TestCoalesceKey_WithoutAKeyTheTypeIsTheKey(t *testing.T) {
	e := start(t, keyedConfig(), false)
	student := e.dial(t, "room-1", "viewer", "ana")
	read(t, student)

	for i := 1; i <= 4; i++ {
		e.hub.Broadcast("room-1", hub.Message{Type: "cursor", Data: json.RawMessage(`{"pane":"` + strconv.Itoa(i) + `","n":` + strconv.Itoa(i) + `}`)}, "")
	}
	assert.JSONEq(t, `{"pane":"4","n":4}`, string(read(t, student).Data), "the latest of the type, whatever its fields")
	nothing(t, student, 150*time.Millisecond)
}
