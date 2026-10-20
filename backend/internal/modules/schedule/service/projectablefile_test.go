package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// Covers SPEC-074 RN-08: what the live classroom reads of a file material to put it on the stage. The authorization is the classroom's; here
// the file is found by the class, in any lesson of it, hidden or not, and a link, a deleted material or one of another class is not found.
func TestProjectableFile(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	slides := f.addFile(t, f.teacher, "Slides 01", domain.MaterialSlides, domain.VisibilityAfterClass)
	link := f.addLink(t, "Referência", domain.MaterialReference, domain.VisibilityAlways)

	got, err := f.svc.ProjectableFile(ctx, f.class.ID, slides.ID)
	require.NoError(t, err, "a material hidden from the class can still be projected by the teacher")
	assert.Equal(t, "Slides 01", got.Title)
	require.NotNil(t, slides.ObjectKey)
	assert.Equal(t, *slides.ObjectKey, got.ObjectKey)
	assert.Equal(t, "application/pdf", got.ContentType)
	assert.Equal(t, 5, got.PageCount)

	_, err = f.svc.ProjectableFile(ctx, f.class.ID, link.ID)
	assert.ErrorIs(t, err, domain.ErrNotAFile, "a link has no file")

	_, err = f.svc.ProjectableFile(ctx, uuid.New(), slides.ID)
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound, "of another class")
	_, err = f.svc.ProjectableFile(ctx, f.class.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound, "unknown")

	require.NoError(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, slides.ID))
	_, err = f.svc.ProjectableFile(ctx, f.class.ID, slides.ID)
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound, "deleted")
}
