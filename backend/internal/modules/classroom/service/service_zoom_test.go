package service_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// ---- SPEC-057 (CA-15 to CA-21): the zoom, the horizontal scroll of the slide and the selection of text of the teacher ----

// stageOf is the whole view of the stage of the room, as the snapshot gives it.
func stageOf(t *testing.T, w *world, id uuid.UUID) service.StageView {
	t.Helper()
	a, err := w.svc.Snapshot(context.Background(), id)
	require.NoError(t, err)
	return a.StageView
}

// Covers SPEC-057 CA-15 and CA-18: the zoom is 1 (100%) by default, and the service keeps only the latest one.
func TestStageZoom_DefaultsToOneAndKeepsTheLatest(t *testing.T) {
	w := setup(t)
	s := w.start(t)
	assert.Equal(t, 1.0, stageOf(t, w, s.ID).Zoom, "the stage starts at 100%")

	w.svc.SetStageZoom(s.ID, 1.5)
	assert.Equal(t, 1.5, stageOf(t, w, s.ID).Zoom)
	w.svc.SetStageZoom(s.ID, 2)
	assert.Equal(t, 2.0, stageOf(t, w, s.ID).Zoom)
	w.svc.SetStageZoom(s.ID, 1)
	assert.Equal(t, 1.0, stageOf(t, w, s.ID).Zoom, "back to 100%, and only the latest is kept")

	w.svc.SetStageScroll(s.ID, "slide", 0.4)
	w.svc.SetStageSplit(s.ID, 0.3)
	w.svc.SetStageZoom(s.ID, 1.25)
	view := stageOf(t, w, s.ID)
	assert.Equal(t, 0.4, view.SlideScroll, "the zoom does not touch the scrolls or the divider")
	require.NotNil(t, view.Split)
	assert.Equal(t, 0.3, *view.Split)
}

// Covers SPEC-057 CA-15 and section 3.2: the zoom is not started over by a change of slide or of module; it is the teacher's choice for
// the lesson.
func TestStageZoom_SurvivesTheChangesOfSlideAndModule(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	first, second := uuid.New(), uuid.New()
	w.withModules(first, second)
	w.svc.SetStageZoom(s.ID, 1.5)

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	assert.Equal(t, 1.5, stageOf(t, w, s.ID).Zoom, "a new slide")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	assert.Equal(t, 1.5, stageOf(t, w, s.ID).Zoom, "the first module")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &second))
	assert.Equal(t, 1.5, stageOf(t, w, s.ID).Zoom, "another module")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	assert.Equal(t, 1.5, stageOf(t, w, s.ID).Zoom, "back to the slides")
}

// Covers SPEC-057 CA-17 and CA-18: the horizontal scroll of the slide is 0 by default and kept apart from the vertical one; a new slide puts
// both back to the top-left (0), a slide that is refused changes nothing, and the module, the zoom and the divider do not touch it.
func TestStageScrollX_StartsOverWithTheSlide(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	module := uuid.New()
	w.withModules(module)
	assert.Zero(t, stageOf(t, w, s.ID).SlideScrollX, "the default")

	w.svc.SetStageScroll(s.ID, "slide", 0.5)
	w.svc.SetStageScrollX(s.ID, 0.4)
	w.svc.SetStageScroll(s.ID, "material", 0.2)
	w.svc.SetStageZoom(s.ID, 1.5)
	w.svc.SetStageSplit(s.ID, 0.6)
	view := stageOf(t, w, s.ID)
	assert.Equal(t, []float64{0.5, 0.4, 0.2, 1.5}, []float64{view.SlideScroll, view.SlideScrollX, view.MaterialScroll, view.Zoom}, "each keeps its own")

	assert.ErrorIs(t, w.svc.ChangeSlide(ctx, s.ID, 0), domain.ErrInvalidSlide)
	view = stageOf(t, w, s.ID)
	assert.Equal(t, []float64{0.5, 0.4}, []float64{view.SlideScroll, view.SlideScrollX}, "the slide was not changed, so the scroll stays")

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module))
	assert.Equal(t, 0.4, stageOf(t, w, s.ID).SlideScrollX, "the module does not touch the scroll of the slide")

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	view = stageOf(t, w, s.ID)
	assert.Equal(t, []float64{0, 0}, []float64{view.SlideScroll, view.SlideScrollX}, "a new slide starts at the top-left")
	require.NotNil(t, view.Split)
	assert.Equal(t, []float64{0, 1.5, 0.6}, []float64{view.MaterialScroll, view.Zoom, *view.Split}, "the rest stays (the material goes back only with the module)")
}

// Covers SPEC-057 CA-18: the zoom and the horizontal scroll are part of the state of the room that anybody who comes in receives: the
// student, the teacher and the administrator get them from the REST state, and the snapshot gives them to the connection.
func TestStageZoomAndScrollX_AreInTheStateOfTheRoom(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)

	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		assert.Equal(t, 1.0, a.StageView.Zoom, "the default")
		assert.Zero(t, a.StageView.SlideScrollX)
	}
	w.svc.SetStageZoom(s.ID, 1.75)
	w.svc.SetStageScrollX(s.ID, 0.9)
	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		assert.Equal(t, 1.75, a.StageView.Zoom)
		assert.Equal(t, 0.9, a.StageView.SlideScrollX)
	}
}

// Covers SPEC-057 section 4: the zoom and the horizontal scroll are kept in memory only, and end with the lesson (the room is reopened in
// the fake repository just to look at what the service still holds for it).
func TestStageZoomAndScrollX_EndWithTheLesson(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.svc.SetStageZoom(s.ID, 2)
	w.svc.SetStageScrollX(s.ID, 0.5)
	view := stageOf(t, w, s.ID)
	assert.Equal(t, []float64{2, 0.5}, []float64{view.Zoom, view.SlideScrollX}, "the room had them")

	_, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	reopened := w.repo.sessions[s.ID]
	reopened.Status, reopened.EndedAt = domain.StatusActive, nil
	w.repo.sessions[s.ID] = reopened

	view = stageOf(t, w, s.ID)
	assert.Equal(t, []float64{1, 0}, []float64{view.Zoom, view.SlideScrollX}, "the lesson ended: the zoom is back to 100% and nothing else is left")
}

var (
	materialPick = json.RawMessage(`{"pane":"material","start":{"block":"b1","offset":3},"end":{"block":"b2","offset":7}}`)
	terminalPick = json.RawMessage(`{"pane":"terminal","terminal":2,"start":3,"end":9}`)
)

// Covers SPEC-057 CA-20 and CA-21: there is no selection by default; the service keeps only the last one, and none after a clear (nil).
func TestStageSelection_DefaultsToNoneAndKeepsTheLatest(t *testing.T) {
	w := setup(t)
	s := w.start(t)
	assert.Empty(t, stageOf(t, w, s.ID).Selection, "no selection by default")

	w.svc.SetStageSelection(s.ID, terminalPick)
	assert.JSONEq(t, string(terminalPick), string(stageOf(t, w, s.ID).Selection))
	w.svc.SetStageSelection(s.ID, materialPick)
	assert.JSONEq(t, string(materialPick), string(stageOf(t, w, s.ID).Selection), "only the last one, no history")
	w.svc.SetStageSelection(s.ID, nil)
	assert.Empty(t, stageOf(t, w, s.ID).Selection, "a clear keeps none")

	w.svc.SetStageSelection(s.ID, materialPick)
	w.svc.SetStageScroll(s.ID, "material", 0.5)
	w.svc.SetStageZoom(s.ID, 1.5)
	w.svc.SetStageSplit(s.ID, 0.4)
	assert.JSONEq(t, string(materialPick), string(stageOf(t, w, s.ID).Selection), "the scroll, the zoom and the divider do not touch it")
}

// Covers SPEC-057 CA-21: the service keeps its own copy, so the buffer of the message that it came in can be reused.
func TestStageSelection_IsACopy(t *testing.T) {
	w := setup(t)
	s := w.start(t)
	buf := append(json.RawMessage(nil), terminalPick...)
	w.svc.SetStageSelection(s.ID, buf)
	for i := range buf {
		buf[i] = 'x'
	}
	assert.JSONEq(t, string(terminalPick), string(stageOf(t, w, s.ID).Selection))

	got := stageOf(t, w, s.ID).Selection
	for i := range got {
		got[i] = 'y'
	}
	assert.JSONEq(t, string(terminalPick), string(stageOf(t, w, s.ID).Selection), "and what the snapshot hands out is a copy too")
}

// Covers SPEC-057 CA-20: choosing another module clears the selection (it was of the module that left); a new slide, going back to the
// slides, showing the same module again, or a module that is refused do not.
func TestStageSelection_ChangingTheModuleClearsIt(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	first, second, ghost := uuid.New(), uuid.New(), uuid.New()
	w.withModules(first, second)

	w.svc.SetStageSelection(s.ID, terminalPick)
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	assert.Empty(t, stageOf(t, w, s.ID).Selection, "the first module of the lesson starts with no selection")

	w.svc.SetStageSelection(s.ID, materialPick)
	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	assert.NotEmpty(t, stageOf(t, w, s.ID).Selection, "a new slide")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	assert.NotEmpty(t, stageOf(t, w, s.ID).Selection, "back to the slides keeps the module, and its selection")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	assert.NotEmpty(t, stageOf(t, w, s.ID).Selection, "the same module again is not a change of module")
	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &ghost), domain.ErrModuleNotFound)
	assert.NotEmpty(t, stageOf(t, w, s.ID).Selection, "a module that is refused changes nothing")

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &second))
	assert.Empty(t, stageOf(t, w, s.ID).Selection, "another module clears the selection")
}

// Covers SPEC-057 CA-20 and CA-21: the selection is part of the state of the room that anybody who comes in receives, from the REST state
// and from the snapshot, and it ends with the lesson (the room is reopened in the fake repository to look at what the service still holds).
func TestStageSelection_IsInTheStateOfTheRoomAndEndsWithTheLesson(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)
	w.svc.SetStageSelection(s.ID, materialPick)

	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		assert.JSONEq(t, string(materialPick), string(a.StageView.Selection))
	}

	_, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	reopened := w.repo.sessions[s.ID]
	reopened.Status, reopened.EndedAt = domain.StatusActive, nil
	w.repo.sessions[s.ID] = reopened
	assert.Empty(t, stageOf(t, w, s.ID).Selection, "the lesson ended: nothing of its selection is left")
}
