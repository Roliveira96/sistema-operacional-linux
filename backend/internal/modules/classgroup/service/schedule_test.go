package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
)

type fakeScheduleHook struct{ regenerated []uuid.UUID }

func (f *fakeScheduleHook) Regenerate(ctx context.Context, classID uuid.UUID) error {
	f.regenerated = append(f.regenerated, classID)
	return nil
}

// Covers SPEC-042 RN-12: the color of a class is one of the palette keys, orange by default.
func TestCreateClass_Color(t *testing.T) {
	svc := service.New(newFakeRepo())
	in := validCreateInput()
	class, err := svc.CreateClass(context.Background(), uuid.New(), in)
	require.NoError(t, err)
	assert.Equal(t, "orange", class.Color)

	in = validCreateInput()
	in.CourseCode = "SO35E"
	in.Color = "teal"
	class, err = svc.CreateClass(context.Background(), uuid.New(), in)
	require.NoError(t, err)
	assert.Equal(t, "teal", class.Color)

	in = validCreateInput()
	in.CourseCode = "SO36E"
	in.Color = "black"
	_, err = svc.CreateClass(context.Background(), uuid.New(), in)
	require.ErrorIs(t, err, domain.ErrInvalidColor)
}

// Covers SPEC-042 RN-12 and CA-03: the color can be changed, and a new validity regenerates the sessions.
func TestUpdateClass_ColorAndRegenerate(t *testing.T) {
	repo := newFakeRepo()
	hook := &fakeScheduleHook{}
	svc := service.New(repo).WithScheduleHook(hook)
	teacher := uuid.New()
	class, err := svc.CreateClass(context.Background(), teacher, validCreateInput())
	require.NoError(t, err)

	purple := "purple"
	updated, err := svc.UpdateClass(context.Background(), teacher, class.ID, service.UpdateClassInput{Color: &purple})
	require.NoError(t, err)
	assert.Equal(t, "purple", updated.Color)
	assert.Empty(t, hook.regenerated, "the validity did not change")

	bad := "black"
	_, err = svc.UpdateClass(context.Background(), teacher, class.ID, service.UpdateClassInput{Color: &bad})
	require.ErrorIs(t, err, domain.ErrInvalidColor)

	end := class.EndDate.Add(14 * 24 * time.Hour)
	_, err = svc.UpdateClass(context.Background(), teacher, class.ID, service.UpdateClassInput{EndDate: &end})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{class.ID}, hook.regenerated)
}
