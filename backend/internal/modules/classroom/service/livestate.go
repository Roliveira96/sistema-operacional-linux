package service

import (
	"bytes"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
)

// What a student who comes in the middle of the lesson needs and that is not worth a database row (SPEC-051 RN-07). It lives in memory
// while the room is open.
const maxDrawings = 1000

type liveState struct {
	drawings []json.RawMessage
	// the last screen of the terminal of the teacher (SPEC-056): only the latest, never a history
	screen json.RawMessage

	// what the teacher published of the module (SPEC-054), and whether the stage is on the black screen (SPEC-055)
	focusBlock string
	blank      bool
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

// setScreen keeps the screen of the terminal in place of the one before.
func (l *liveStates) setScreen(id uuid.UUID, raw json.RawMessage) {
	l.mu.Lock()
	l.of(id).screen = bytes.Clone(raw)
	l.mu.Unlock()
}

func (l *liveStates) setBlank(id uuid.UUID, on bool) {
	l.mu.Lock()
	l.of(id).blank = on
	l.mu.Unlock()
}

func (l *liveStates) isBlank(id uuid.UUID) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	return ok && st.blank
}

func (l *liveStates) setFocus(id uuid.UUID, blockID string) {
	l.mu.Lock()
	l.of(id).focusBlock = blockID
	l.mu.Unlock()
}

// focus returns the block of the module the teacher put in focus.
func (l *liveStates) focus(id uuid.UUID) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if st, ok := l.rooms[id]; ok {
		return st.focusBlock
	}
	return ""
}

// view returns a copy of the strokes of the room and its last terminal screen.
func (l *liveStates) view(id uuid.UUID) ([]json.RawMessage, json.RawMessage) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok {
		return nil, nil
	}
	return append([]json.RawMessage(nil), st.drawings...), st.screen
}
