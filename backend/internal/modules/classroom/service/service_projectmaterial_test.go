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

// ---- SPEC-074 RN-08 and CA-16: a file material of a lesson put on the stage as a presentation of the class ----

type lessonFile struct {
	class uuid.UUID
	file  service.LessonMaterial
}

// fakeLessonMaterials answers for the materials of the lessons, like the schedule does through its adapter.
type fakeLessonMaterials struct {
	files map[uuid.UUID]lessonFile
	links map[uuid.UUID]bool
}

func (f fakeLessonMaterials) MaterialFile(_ context.Context, classID, id uuid.UUID) (service.LessonMaterial, error) {
	if f.links[id] {
		return service.LessonMaterial{}, domain.ErrMaterialNotProjectable
	}
	found, ok := f.files[id]
	if !ok || found.class != classID {
		return service.LessonMaterial{}, domain.ErrMaterialNotFound
	}
	return found.file, nil
}

// FindDeckByObjectKey is what the repository gives to tell that a file is already a presentation of the class.
func (f *fakeRepo) FindDeckByObjectKey(_ context.Context, classID uuid.UUID, key string) (domain.SlideDeck, error) {
	for _, d := range f.decks {
		if d.ClassID == classID && d.ObjectKey == key {
			return d, nil
		}
	}
	return domain.SlideDeck{}, domain.ErrDeckNotFound
}

const (
	pdfKey   = "classes/c/sessions/s/materials/pdf-1.pdf"
	imageKey = "classes/c/sessions/s/materials/img-1.png"
)

type projectWorld struct {
	*world
	pdf, image, link, foreign uuid.UUID
}

func newProjectWorld(t *testing.T) *projectWorld {
	t.Helper()
	w := setup(t)
	p := &projectWorld{world: w, pdf: uuid.New(), image: uuid.New(), link: uuid.New(), foreign: uuid.New()}
	w.svc.WithLessonMaterials(fakeLessonMaterials{
		files: map[uuid.UUID]lessonFile{
			p.pdf:     {class: w.class, file: service.LessonMaterial{Title: "Slides 01", ObjectKey: pdfKey, ContentType: "application/pdf", PageCount: 12}},
			p.image:   {class: w.class, file: service.LessonMaterial{Title: "Diagrama", ObjectKey: imageKey, ContentType: "image/png", PageCount: 0}},
			p.foreign: {class: uuid.New(), file: service.LessonMaterial{Title: "De outra turma", ObjectKey: "classes/z/x.pdf", ContentType: "application/pdf", PageCount: 3}},
		},
		links: map[uuid.UUID]bool{p.link: true},
	})
	return p
}

// Covers SPEC-074 CA-16: projecting a PDF material makes a presentation of the class that points to the same file, without copying it.
func TestProjectMaterial_CreatesDeckWithSameKey(t *testing.T) {
	p := newProjectWorld(t)
	ctx := context.Background()

	view, created, err := p.svc.ProjectMaterial(ctx, p.teacher, p.class, p.pdf)
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, pdfKey, view.Deck.ObjectKey, "the same object, not a copy")
	assert.Empty(t, p.store.puts, "nothing is written to the bucket")
	assert.Equal(t, "Slides 01", view.Deck.Title)
	assert.Equal(t, 12, view.Deck.PageCount)
	assert.Equal(t, domain.KindPDF, view.Deck.Kind)
	assert.Equal(t, p.class, view.Deck.ClassID)
	assert.Equal(t, p.teacher.UserID, view.Deck.UploadedBy)
	assert.NotEmpty(t, view.DownloadURL)
	stored, err := p.repo.FindDeck(ctx, view.Deck.ID)
	require.NoError(t, err)
	assert.Equal(t, pdfKey, stored.ObjectKey)

	// an image is one slide, whatever page count came with it
	img, created, err := p.svc.ProjectMaterial(ctx, p.teacher, p.class, p.image)
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, domain.KindImage, img.Deck.Kind)
	assert.Equal(t, 1, img.Deck.PageCount)
	assert.Equal(t, imageKey, img.Deck.ObjectKey)
}

// Covers SPEC-074 CA-16: projecting the same material again gives the presentation that is already there, and the limit is not spent.
func TestProjectMaterial_ReusesDeckOfSameKey(t *testing.T) {
	p := newProjectWorld(t)
	ctx := context.Background()

	first, created, err := p.svc.ProjectMaterial(ctx, p.teacher, p.class, p.pdf)
	require.NoError(t, err)
	require.True(t, created)
	again, created, err := p.svc.ProjectMaterial(ctx, p.teacher, p.class, p.pdf)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, first.Deck.ID, again.Deck.ID)
	count, err := p.repo.CountDecks(ctx, p.class)
	require.NoError(t, err)
	assert.EqualValues(t, 1, count)
	assert.NotEmpty(t, again.DownloadURL, "a fresh address")
}

// Covers SPEC-074 CA-16: a link has nothing to put on the stage.
func TestProjectMaterial_LinkIsNotProjectable(t *testing.T) {
	p := newProjectWorld(t)
	_, _, err := p.svc.ProjectMaterial(context.Background(), p.teacher, p.class, p.link)
	assert.ErrorIs(t, err, domain.ErrMaterialNotProjectable)
	count, _ := p.repo.CountDecks(context.Background(), p.class)
	assert.EqualValues(t, 0, count, "no presentation was made")
}

// Covers SPEC-074 CA-16: a material that does not exist, was deleted or is of another class is reported as missing.
func TestProjectMaterial_OtherClassOrMissingIs404(t *testing.T) {
	p := newProjectWorld(t)
	ctx := context.Background()
	_, _, err := p.svc.ProjectMaterial(ctx, p.teacher, p.class, uuid.New())
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound, "unknown")
	_, _, err = p.svc.ProjectMaterial(ctx, p.teacher, p.class, p.foreign)
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound, "of another class")
	_, _, err = p.svc.ProjectMaterial(ctx, p.teacher, uuid.New(), p.pdf)
	assert.ErrorIs(t, err, domain.ErrClassNotFound, "a class that does not exist")
}

// Covers SPEC-074 CA-16: the limit of 100 presentations is hit only when a new one would be made.
func TestProjectMaterial_LimitOnlyWhenNew(t *testing.T) {
	p := newProjectWorld(t)
	ctx := context.Background()
	for i := 0; i < domain.MaxDecksPerClass-1; i++ {
		d := domain.SlideDeck{ClassID: p.class, Title: "x", ObjectKey: "classes/c/decks/" + uuid.NewString() + ".pdf", PageCount: 1}
		require.NoError(t, p.repo.CreateDeck(ctx, &d))
	}
	mine := domain.SlideDeck{ClassID: p.class, Title: "Já era apresentação", ObjectKey: pdfKey, PageCount: 12}
	require.NoError(t, p.repo.CreateDeck(ctx, &mine))

	view, created, err := p.svc.ProjectMaterial(ctx, p.teacher, p.class, p.pdf)
	require.NoError(t, err, "the file is already a presentation: nothing new is made")
	assert.False(t, created)
	assert.Equal(t, mine.ID, view.Deck.ID)

	_, _, err = p.svc.ProjectMaterial(ctx, p.teacher, p.class, p.image)
	assert.ErrorIs(t, err, domain.ErrDeckLimit, "a new presentation would be the 101st")
}

// Covers SPEC-074 CA-16: only who runs the class projects; the administrator too.
func TestProjectMaterial_OnlyWhoRunsTheClass(t *testing.T) {
	p := newProjectWorld(t)
	ctx := context.Background()
	_, _, err := p.svc.ProjectMaterial(ctx, p.other, p.class, p.pdf)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a teacher of another class")
	_, _, err = p.svc.ProjectMaterial(ctx, p.student, p.class, p.pdf)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a student")
	_, _, err = p.svc.ProjectMaterial(ctx, p.admin, p.class, p.pdf)
	assert.NoError(t, err, "the administrator")
}
