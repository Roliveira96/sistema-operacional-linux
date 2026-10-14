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

// ---- SPEC-059: the full screen of the students, asked by the teacher ----

// Covers SPEC-059 CA-07: nobody asked for it by default, and the service keeps whether it was asked, the latest answer only.
func TestFullscreen_DefaultsToOffAndKeepsTheLatest(t *testing.T) {
	w := setup(t)
	s := w.start(t)
	assert.False(t, stageOf(t, w, s.ID).Fullscreen, "off by default")

	w.svc.SetStageFullscreen(s.ID, true)
	assert.True(t, stageOf(t, w, s.ID).Fullscreen)
	w.svc.SetStageFullscreen(s.ID, true)
	assert.True(t, stageOf(t, w, s.ID).Fullscreen, "asking twice is the same")
	w.svc.SetStageFullscreen(s.ID, false)
	assert.False(t, stageOf(t, w, s.ID).Fullscreen)

	w.svc.SetStageFullscreen(s.ID, true)
	w.svc.SetStageScroll(s.ID, "slide", 0.4)
	w.svc.SetStageZoom(s.ID, 1.5)
	w.svc.SetStageSplit(s.ID, 0.3)
	w.svc.SetStageSelection(s.ID, materialPick)
	w.svc.SetTerminalScroll(s.ID, 1, 0.5)
	view := stageOf(t, w, s.ID)
	assert.True(t, view.Fullscreen, "the other parts of the stage do not touch it")
	assert.Equal(t, []float64{0.4, 1.5}, []float64{view.SlideScroll, view.Zoom}, "and it does not touch them")
	assert.NotEmpty(t, view.Selection)
	assert.Equal(t, map[int]float64{1: 0.5}, view.TerminalScroll)
}

// Covers SPEC-059 section 3.2: the request is not started over by a change of slide or of module, nor by going back to the slides: it is the
// teacher's choice, and it stands until he takes it back.
func TestFullscreen_SurvivesTheChangesOfSlideAndModule(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	first, second := uuid.New(), uuid.New()
	w.withModules(first, second)
	w.svc.SetStageFullscreen(s.ID, true)

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	assert.True(t, stageOf(t, w, s.ID).Fullscreen, "a new slide")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	assert.True(t, stageOf(t, w, s.ID).Fullscreen, "the first module")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &second))
	assert.True(t, stageOf(t, w, s.ID).Fullscreen, "another module")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	assert.True(t, stageOf(t, w, s.ID).Fullscreen, "back to the slides")
}

// Covers SPEC-059 CA-06 and CA-07: the request is part of the state of the room that anybody who comes in receives, from the REST state and
// from the snapshot, and it ends with the lesson (the room is reopened in the fake repository to look at what the service still holds).
func TestFullscreen_IsInTheStateOfTheRoomAndEndsWithTheLesson(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)
	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		assert.False(t, a.StageView.Fullscreen, "the default")
	}
	w.svc.SetStageFullscreen(s.ID, true)
	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		assert.True(t, a.StageView.Fullscreen)
	}

	_, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	reopened := w.repo.sessions[s.ID]
	reopened.Status, reopened.EndedAt = domain.StatusActive, nil
	w.repo.sessions[s.ID] = reopened
	assert.False(t, stageOf(t, w, s.ID).Fullscreen, "the lesson ended: the request is off")
}
