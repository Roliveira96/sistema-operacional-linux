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

// Covers SPEC-057 CA-23 and section 3.2: the terminals of the lesson are the same through the whole lesson, so a new slide, a new module,
// or the slides again do not put their scroll back to the top.
func TestTerminalScroll_SurvivesTheChangesOfSlideAndModule(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	first, second := uuid.New(), uuid.New()
	w.withModules(first, second)
	w.svc.SetTerminalScroll(s.ID, 1, 0.3)
	w.svc.SetTerminalScroll(s.ID, 2, 0.8)
	want := map[int]float64{1: 0.3, 2: 0.8}

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "a new slide")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "the first module")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &second))
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "another module")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	assert.Equal(t, want, stageOf(t, w, s.ID).TerminalScroll, "back to the slides")
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
