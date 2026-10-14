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

// ---- SPEC-057: the scroll of the panes and the divider of the stage, kept in memory with the state of the stage ----

// viewOf is the stage view of the room, as the snapshot gives it; split is -1 when it is null (the default of the layout).
func viewOf(t *testing.T, w *world, id uuid.UUID) (slide, material, split float64) {
	t.Helper()
	a, err := w.svc.Snapshot(context.Background(), id)
	require.NoError(t, err)
	split = -1
	if a.StageView.Split != nil {
		split = *a.StageView.Split
	}
	return a.StageView.SlideScroll, a.StageView.MaterialScroll, split
}

// Covers SPEC-057 CA-08 and CA-09: the scrolls are 0 and the divider is null by default; each pane keeps its own latest value, and the
// divider its own, and a new value replaces the one before.
func TestStageView_DefaultsAndTheLatestOfEach(t *testing.T) {
	w := setup(t)
	s := w.start(t)

	slide, material, split := viewOf(t, w, s.ID)
	assert.Zero(t, slide)
	assert.Zero(t, material)
	assert.Equal(t, -1.0, split, "no divider chosen: the default of the layout")

	w.svc.SetStageScroll(s.ID, "slide", 0.3)
	slide, material, split = viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0.3, 0, -1}, []float64{slide, material, split}, "the panes do not share the value")

	w.svc.SetStageScroll(s.ID, "material", 0.6)
	w.svc.SetStageSplit(s.ID, 0.45)
	slide, material, split = viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0.3, 0.6, 0.45}, []float64{slide, material, split})

	w.svc.SetStageScroll(s.ID, "slide", 0.9)
	w.svc.SetStageScroll(s.ID, "material", 0)
	w.svc.SetStageSplit(s.ID, 0.8)
	slide, material, split = viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0.9, 0, 0.8}, []float64{slide, material, split}, "only the latest, no history")

	w.svc.SetStageScroll(s.ID, "page", 0.5)
	slide, material, split = viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0.9, 0, 0.8}, []float64{slide, material, split}, "a pane the stage does not have changes nothing")
}

// Covers SPEC-057 CA-08: the view is part of the state of the room that anybody who comes in receives: the student, the teacher and the
// administrator get it from the REST state, and the snapshot gives it to the connection.
func TestStageView_IsPartOfTheStateOfTheRoom(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)
	w.svc.SetStageScroll(s.ID, "slide", 0.2)
	w.svc.SetStageScroll(s.ID, "material", 0.8)
	w.svc.SetStageSplit(s.ID, 0.3)

	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		require.True(t, a.Found)
		assert.Equal(t, 0.2, a.StageView.SlideScroll)
		assert.Equal(t, 0.8, a.StageView.MaterialScroll)
		require.NotNil(t, a.StageView.Split)
		assert.Equal(t, 0.3, *a.StageView.Split)
	}
	a, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, 0.2, a.StageView.SlideScroll)
}

// Covers SPEC-057 CA-05: changing the slide puts the scroll of the slide back to the top (0) and leaves the scroll of the material and the
// divider as they were; a change that is refused changes nothing.
func TestStageView_ChangingTheSlideBringsItsScrollBackToTheTop(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.svc.SetStageScroll(s.ID, "slide", 0.7)
	w.svc.SetStageScroll(s.ID, "material", 0.2)
	w.svc.SetStageSplit(s.ID, 0.5)

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	slide, material, split := viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0, 0.2, 0.5}, []float64{slide, material, split}, "the slide goes back to the top; the material and the divider stay")

	w.svc.SetStageScroll(s.ID, "slide", 0.4)
	assert.ErrorIs(t, w.svc.ChangeSlide(ctx, s.ID, 0), domain.ErrInvalidSlide)
	slide, _, _ = viewOf(t, w, s.ID)
	assert.Equal(t, 0.4, slide, "the slide was not changed, so the scroll stays")

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 3))
	slide, _, _ = viewOf(t, w, s.ID)
	assert.Zero(t, slide, "every accepted change starts at the top")
}

// Covers SPEC-057 CA-05: choosing another module puts the scroll of the material back to the top (0), and the divider and the scroll of
// the slide stay; going back to the slides, showing the same module again, or a module that is refused changes nothing.
func TestStageView_ChangingTheModuleBringsItsScrollBackToTheTop(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	first, second, ghost := uuid.New(), uuid.New(), uuid.New()
	w.withModules(first, second)
	w.svc.SetStageScroll(s.ID, "slide", 0.3)
	w.svc.SetStageScroll(s.ID, "material", 0.6)
	w.svc.SetStageSplit(s.ID, 0.4)

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	slide, material, split := viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0.3, 0, 0.4}, []float64{slide, material, split}, "the first module of the lesson starts at the top; the slide and the divider stay")

	w.svc.SetStageScroll(s.ID, "material", 0.5)
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	_, material, _ = viewOf(t, w, s.ID)
	assert.Equal(t, 0.5, material, "going back to the slides keeps the module, and its scroll")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &first))
	_, material, _ = viewOf(t, w, s.ID)
	assert.Equal(t, 0.5, material, "the same module again is not a change of module")
	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &ghost), domain.ErrModuleNotFound)
	_, material, _ = viewOf(t, w, s.ID)
	assert.Equal(t, 0.5, material, "a module that is refused changes nothing")

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &second))
	slide, material, split = viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0.3, 0, 0.4}, []float64{slide, material, split}, "another module starts at the top; the slide and the divider stay")
}

// Covers SPEC-057 section 4: the view is kept in memory only, and ends with the lesson (the room is reopened in the fake repository just
// to look at what the service still holds for it).
func TestStageView_EndsWithTheLesson(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.svc.SetStageScroll(s.ID, "slide", 0.5)
	w.svc.SetStageScroll(s.ID, "material", 0.5)
	w.svc.SetStageSplit(s.ID, 0.5)
	slide, material, split := viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0.5, 0.5, 0.5}, []float64{slide, material, split}, "the room had a view")

	_, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	reopened := w.repo.sessions[s.ID]
	reopened.Status, reopened.EndedAt = domain.StatusActive, nil
	w.repo.sessions[s.ID] = reopened

	slide, material, split = viewOf(t, w, s.ID)
	assert.Equal(t, []float64{0, 0, -1}, []float64{slide, material, split}, "the lesson ended: nothing of its view is left")
}
