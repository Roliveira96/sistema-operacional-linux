package service

import (
	"bytes"
	"encoding/json"
	"sync"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
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

	// the view of the stage (SPEC-057): only the latest of each, never a history
	stage StageView
}

// StageView is how the teacher left the stage: how far each pane is scrolled, as a fraction from 0 to 1 of what can be scrolled (the slide
// also sideways), the divider of the module as the fraction of the width that the material takes (nil is the default of the layout), the
// zoom (1 is 100%) and the text he selected (the last selection in its JSON form, nil for none). The server does not read the selection:
// it was checked when it came in.
type StageView struct {
	SlideScroll    float64
	SlideScrollX   float64
	MaterialScroll float64
	Split          *float64
	Zoom           float64
	Selection      json.RawMessage
}

// defaultStageView is the stage that nobody touched: at the top, no divider chosen, at 100%, nothing selected.
func defaultStageView() StageView { return StageView{Zoom: domain.MinZoom} }

type liveStates struct {
	mu    sync.Mutex
	rooms map[uuid.UUID]*liveState
}

func newLiveStates() *liveStates { return &liveStates{rooms: map[uuid.UUID]*liveState{}} }

// of returns the state of the room, creating it. The caller holds the lock.
func (l *liveStates) of(id uuid.UUID) *liveState {
	st, ok := l.rooms[id]
	if !ok {
		st = &liveState{stage: defaultStageView()}
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

// setScroll keeps the scroll of a pane; a pane the stage does not have changes nothing.
func (l *liveStates) setScroll(id uuid.UUID, pane string, y float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	switch pane {
	case domain.PaneSlide:
		l.of(id).stage.SlideScroll = y
	case domain.PaneMaterial:
		l.of(id).stage.MaterialScroll = y
	}
}

func (l *liveStates) setSplit(id uuid.UUID, ratio float64) {
	l.mu.Lock()
	l.of(id).stage.Split = &ratio
	l.mu.Unlock()
}

func (l *liveStates) setScrollX(id uuid.UUID, x float64) {
	l.mu.Lock()
	l.of(id).stage.SlideScrollX = x
	l.mu.Unlock()
}

func (l *liveStates) setZoom(id uuid.UUID, zoom float64) {
	l.mu.Lock()
	l.of(id).stage.Zoom = zoom
	l.mu.Unlock()
}

// setSelection keeps the selection in place of the one before; nil is no selection.
func (l *liveStates) setSelection(id uuid.UUID, raw json.RawMessage) {
	l.mu.Lock()
	l.of(id).stage.Selection = bytes.Clone(raw)
	l.mu.Unlock()
}

// resetScroll puts the scroll of a pane back to the top, which is what a new slide or a new module starts at; the slide goes back to the
// left too.
func (l *liveStates) resetScroll(id uuid.UUID, pane string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.of(id)
	switch pane {
	case domain.PaneSlide:
		st.stage.SlideScroll, st.stage.SlideScrollX = 0, 0
	case domain.PaneMaterial:
		st.stage.MaterialScroll = 0
	}
}

// stageView returns a copy of the view of the stage of the room.
func (l *liveStates) stageView(id uuid.UUID) StageView {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok {
		return defaultStageView()
	}
	view := st.stage
	if view.Split != nil {
		ratio := *view.Split
		view.Split = &ratio
	}
	view.Selection = bytes.Clone(view.Selection)
	return view
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
