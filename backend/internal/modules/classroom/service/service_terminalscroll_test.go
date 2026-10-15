package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// ---- SPEC-057 CA-23: the scroll of the history of each terminal ----

// Covers SPEC-057 CA-23: no terminal has a position by default; the service keeps the latest position of each terminal, apart from the
// others and from the panes of the stage.
func TestTerminalScroll_DefaultsToNoneAndKeepsTheLatestOfEach(t *testing.T) {
	w := setup(t)
	s := w.start(t)
	assert.Empty(t, stageOf(t, w, s.ID).TerminalScroll, "no terminal was scrolled yet")

	w.svc.SetTerminalScroll(s.ID, 2, 0.4)
	assert.Equal(t, map[int]float64{2: 0.4}, stageOf(t, w, s.ID).TerminalScroll, "only the terminals that were scrolled")
	w.svc.SetTerminalScroll(s.ID, 1, 1)
	w.svc.SetTerminalScroll(s.ID, 3, 0)
	assert.Equal(t, map[int]float64{1: 1, 2: 0.4, 3: 0}, stageOf(t, w, s.ID).TerminalScroll, "a position of 0 is a position: the terminal was scrolled to the top")
	w.svc.SetTerminalScroll(s.ID, 2, 0.9)
	assert.Equal(t, map[int]float64{1: 1, 2: 0.9, 3: 0}, stageOf(t, w, s.ID).TerminalScroll, "only the latest of each, no history")

	w.svc.SetStageScroll(s.ID, "slide", 0.3)
	w.svc.SetStageScroll(s.ID, "material", 0.6)
	view := stageOf(t, w, s.ID)
	assert.Equal(t, []float64{0.3, 0.6}, []float64{view.SlideScroll, view.MaterialScroll})
	assert.Equal(t, map[int]float64{1: 1, 2: 0.9, 3: 0}, view.TerminalScroll, "the slide and the material do not touch the terminals")

	w.svc.SetTerminalScroll(s.ID, 0, 0.5)
	w.svc.SetTerminalScroll(s.ID, 4, 0.5)
	assert.Equal(t, map[int]float64{1: 1, 2: 0.9, 3: 0}, stageOf(t, w, s.ID).TerminalScroll, "a terminal the stage does not have changes nothing")
}

// Covers SPEC-057 CA-23: what the snapshot hands out is a copy, so the one who reads it cannot change the state of the room.
func TestTerminalScroll_TheSnapshotIsACopy(t *testing.T) {
	w := setup(t)
	s := w.start(t)
	w.svc.SetTerminalScroll(s.ID, 1, 0.5)

	got := stageOf(t, w, s.ID).TerminalScroll
	got[1] = 0.99
	got[2] = 0.99
	assert.Equal(t, map[int]float64{1: 0.5}, stageOf(t, w, s.ID).TerminalScroll)
}

// Covers SPEC-057 CA-23 (adjusted): the terminals of the lesson are created again with each module, so choosing another module puts the
// scroll of every terminal back ({}), together with the scroll of the material and the selection of text; the slide, the zoom and the
// request of the full screen stay. A new slide, going back to the slides, showing the same module again, or a module that is refused do
// not touch the terminals.
func TestTerminalScroll_ChangingTheModulePutsThemBack(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	first, second, ghost := uuid.New(), uuid.New(), uuid.New()
	w.withModules(first, second)
	scrolled := func() {
		w.svc.SetTerminalScroll(s.ID, 1, 0.3)
		w.svc.SetTerminalScroll(s.ID, 2, 0.8)
		w.svc.SetStageScroll(s.ID, "material", 0.5)
		w.svc.SetStageSelection(s.ID, terminalPick)
		w.svc.SetStageScroll(s.ID, "slide", 0.4)
		w.svc.SetStageZoom(s.ID, 1.5)
		w.svc.SetStageFullscreen(s.ID, true)
	}
	want := map[int]float64{1: 0.3, 2: 0.8}
	scrolled()

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "a new slide")

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	view := stageOf(t, w, s.ID)
	assert.Empty(t, view.TerminalScroll, "the first module of the lesson: its terminals start at the end")
	assert.NotNil(t, view.TerminalScroll, "an empty object, not null")
	assert.Zero(t, view.MaterialScroll)
	assert.Empty(t, view.Selection)
	assert.Equal(t, []any{1.5, true}, []any{view.Zoom, view.Fullscreen}, "the zoom and the full screen are the teacher's choices for the lesson")

	scrolled()
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "back to the slides keeps the module, and its terminals")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "the same module again is not a change of module")
	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &ghost), domain.ErrModuleNotFound)
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "a module that is refused changes nothing")

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &second))
	view = stageOf(t, w, s.ID)
	assert.Empty(t, view.TerminalScroll, "another module: its terminals start at the end")
	assert.NotNil(t, view.TerminalScroll)
	assert.Equal(t, 0.4, view.SlideScroll, "the slide stays")

	w.svc.SetTerminalScroll(s.ID, 3, 0.6)
	assert.Equal(t, map[int]float64{3: 0.6}, stageOf(t, w, s.ID).TerminalScroll, "and the new terminals scroll from nothing")
}

// Covers SPEC-057 CA-23: the position of each terminal is part of the state of the room that anybody who comes in receives, from the REST
// state and from the snapshot, and it ends with the lesson (the room is reopened in the fake repository to look at what the service holds).
func TestTerminalScroll_IsInTheStateOfTheRoomAndEndsWithTheLesson(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)
	w.svc.SetTerminalScroll(s.ID, 3, 0.7)

	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		assert.Equal(t, map[int]float64{3: 0.7}, a.StageView.TerminalScroll)
	}

	_, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	reopened := w.repo.sessions[s.ID]
	reopened.Status, reopened.EndedAt = domain.StatusActive, nil
	w.repo.sessions[s.ID] = reopened
	assert.Empty(t, stageOf(t, w, s.ID).TerminalScroll, "the lesson ended: nothing of its terminals is left")
}
