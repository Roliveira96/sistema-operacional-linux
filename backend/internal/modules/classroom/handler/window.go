package handler

import (
	"sync"
	"time"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// presenterGrace is how long the stage waits for a presenter window that left, before the students see the waiting screen (SPEC-070 RN-03).
const presenterGrace = 10 * time.Second

// stageWindow is what a room remembers about its presenter window (SPEC-070 RN-01).
type stageWindow struct {
	joined bool   // a presenter window connected, and the tolerance did not end without one
	grace  func() // stops the tolerance that is running; nil when none runs
	closed bool   // the lesson ended: nothing more is told, and no tolerance starts
}

// stageWindows keeps the rooms' windows. A room that closed leaves its small entry until the server restarts, so that the windows that leave
// because of the close start no tolerance; sweep them if the rooms get to be many.
type stageWindows struct {
	mu    sync.Mutex
	rooms map[string]*stageWindow
}

func (s *stageWindows) of(room string) *stageWindow {
	if s.rooms == nil {
		s.rooms = map[string]*stageWindow{}
	}
	st, ok := s.rooms[room]
	if !ok {
		st = &stageWindow{}
		s.rooms[room] = st
	}
	return st
}

func defaultAfter(d time.Duration, f func()) func() {
	t := time.AfterFunc(d, f)
	return func() { t.Stop() }
}

// windowAway tells whether the students of the room see the waiting screen for the lack of a presenter window: no window connected yet, or the
// tolerance ended without one (SPEC-070 RN-01, RN-05). During the tolerance it is not away.
func (h *Handler) windowAway(room string) bool {
	h.windows.mu.Lock()
	defer h.windows.mu.Unlock()
	st, ok := h.windows.rooms[room]
	return !ok || !st.joined
}

// windowOpened records that a presenter window connected, ends the tolerance if it runs, and tells whether the room was away (SPEC-070 RN-02,
// RN-03, RN-04).
func (h *Handler) windowOpened(room string) (wasAway bool) {
	h.windows.mu.Lock()
	defer h.windows.mu.Unlock()
	st := h.windows.of(room)
	wasAway = !st.joined
	st.joined = true
	if st.grace != nil {
		st.grace()
		st.grace = nil
	}
	return wasAway
}

// windowLeft starts the tolerance when the window that left was the last one. A window that a new one replaced leaves with the new one there,
// so it starts nothing (SPEC-070 RN-02, RN-03).
func (h *Handler) windowLeft(room string) {
	if h.hub.KindConnected(room, viewPresenter) {
		return
	}
	h.windows.mu.Lock()
	defer h.windows.mu.Unlock()
	st := h.windows.of(room)
	if st.closed || !st.joined || st.grace != nil {
		return
	}
	st.grace = h.after(presenterGrace, func() { h.windowGone(room) })
}

// windowGone is the end of the tolerance: with no window back, the room is away and everybody is told.
func (h *Handler) windowGone(room string) {
	h.windows.mu.Lock()
	st := h.windows.of(room)
	if st.closed || st.grace == nil || h.hub.KindConnected(room, viewPresenter) {
		h.windows.mu.Unlock()
		return
	}
	st.grace, st.joined = nil, false
	h.windows.mu.Unlock()
	h.hub.Broadcast(room, hub.Message{Type: typeStageBlank, Data: mustMarshal(map[string]bool{"blank": true})}, "")
}

// windowRoomClosed is the end of the lesson: the tolerance is cancelled, and the windows that leave from now on start none (SPEC-070 RN-06).
func (h *Handler) windowRoomClosed(room string) {
	h.windows.mu.Lock()
	defer h.windows.mu.Unlock()
	st := h.windows.of(room)
	st.closed = true
	if st.grace != nil {
		st.grace()
		st.grace = nil
	}
}

var _ service.AfterFunc = defaultAfter
