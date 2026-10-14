package service

import (
	"bytes"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
)

// What a student who comes in the middle of the lesson needs and that is not worth a database row (SPEC-051 RN-07). It lives in memory
// while the room is open.
const (
	maxDrawings        = 1000
	maxTerminalEntries = 200
)

type liveState struct {
	drawings []json.RawMessage
	input    json.RawMessage
	entries  []json.RawMessage
	state    json.RawMessage

	// what the teacher published of the module, and whether the terminal is being broadcast (SPEC-054)
	focusBlock string
	broadcast  bool
}

type liveStates struct {
	mu    sync.Mutex
	rooms map[uuid.UUID]*liveState
}

func newLiveStates() *liveStates { return &liveStates{rooms: map[uuid.UUID]*liveState{}} }

// of returns the state of the room, creating it. The caller holds the lock.
func (l *liveStates) of(id uuid.UUID) *liveState {
	st, ok := l.rooms[id]
	if !ok {
		st = &liveState{}
		l.rooms[id] = st
	}
	return st
}

func (l *liveStates) forget(id uuid.UUID) {
	l.mu.Lock()
	delete(l.rooms, id)
	l.mu.Unlock()
}

func (l *liveStates) clearDrawings(id uuid.UUID) {
	l.mu.Lock()
	l.of(id).drawings = nil
	l.mu.Unlock()
}

// drawing keeps a stroke, or empties the strokes when the message is the clear one.
func (l *liveStates) drawing(id uuid.UUID, raw json.RawMessage) {
	var m struct {
		Clear bool `json:"clear"`
	}
	_ = json.Unmarshal(raw, &m)
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.of(id)
	if m.Clear {
		st.drawings = nil
		return
	}
	st.drawings = append(st.drawings, bytes.Clone(raw))
	if len(st.drawings) > maxDrawings {
		st.drawings = st.drawings[len(st.drawings)-maxDrawings:]
	}
}

// input keeps the line being typed; it reports false, keeping nothing, while the terminal is not being broadcast.
func (l *liveStates) input(id uuid.UUID, raw json.RawMessage) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.of(id)
	if !st.broadcast {
		return false
	}
	st.input = bytes.Clone(raw)
	return true
}

// setBroadcast turns the broadcast of the terminal on or off; turning it off forgets what the terminal kept.
func (l *liveStates) setBroadcast(id uuid.UUID, on bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.of(id)
	st.broadcast = on
	if !on {
		st.input, st.entries, st.state = nil, nil, nil
	}
}

func (l *liveStates) broadcasting(id uuid.UUID) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	return ok && st.broadcast
}

func (l *liveStates) setFocus(id uuid.UUID, blockID string) {
	l.mu.Lock()
	l.of(id).focusBlock = blockID
	l.mu.Unlock()
}

// published returns the block in focus and the state of the broadcast.
func (l *liveStates) published(id uuid.UUID) (string, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok {
		return "", false
	}
	return st.focusBlock, st.broadcast
}

// sync keeps a command with its output in the history and the machine it left as the current state; it reports false, keeping
// nothing, while the terminal is not being broadcast.
func (l *liveStates) sync(id uuid.UUID, raw json.RawMessage) bool {
	var m struct {
		State json.RawMessage `json:"state"`
	}
	_ = json.Unmarshal(raw, &m)
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.of(id)
	if !st.broadcast {
		return false
	}
	st.entries = append(st.entries, bytes.Clone(raw))
	if len(st.entries) > maxTerminalEntries {
		st.entries = st.entries[len(st.entries)-maxTerminalEntries:]
	}
	if len(m.State) > 0 && string(m.State) != "null" {
		st.state = bytes.Clone(m.State)
	}
	return true
}

// view returns a copy of the strokes and of the terminal of the room.
func (l *liveStates) view(id uuid.UUID) ([]json.RawMessage, TerminalState) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok {
		return nil, TerminalState{}
	}
	return append([]json.RawMessage(nil), st.drawings...),
		TerminalState{Input: st.input, Entries: append([]json.RawMessage(nil), st.entries...), State: st.state}
}
