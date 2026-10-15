package service_test

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ---- SPEC-068: PDF and images sent by the teacher with the room open, and the choice of what is on the stage ----

// typedStorage keeps the content type of each object, which the fake storage of the other tests forgets.
type typedStorage struct {
	*fakeStorage
	types map[string]string
}

func (s *typedStorage) PutObject(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	if s.types == nil {
		s.types = map[string]string{}
	}
	s.types[key] = contentType
	return s.fakeStorage.PutObject(ctx, key, r, size, contentType)
}

var (
	pngBytes  = append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13}, bytes.Repeat([]byte{1}, 200)...)
	jpegBytes = append([]byte{0xff, 0xd8, 0xff, 0xe0, 0, 16, 'J', 'F', 'I', 'F', 0, 1}, bytes.Repeat([]byte{1}, 200)...)
	webpBytes = append([]byte("RIFF\x24\x00\x00\x00WEBPVP8 "), bytes.Repeat([]byte{1}, 200)...)
)

// uploadWorld is the world of the other tests with a service that takes the typed storage.
func uploadWorld(t *testing.T) (*world, *service.Service, *typedStorage) {
	t.Helper()
	w := setup(t)
	storage := &typedStorage{fakeStorage: w.store}
	svc := service.New(w.repo, storage, func() time.Time { return w.now })
	return w, svc, storage
}

func send(t *testing.T, svc *service.Service, w *world, title string, pages int, data []byte) (service.DeckView, error) {
	t.Helper()
	return svc.UploadDeck(context.Background(), w.teacher, w.class, service.UploadInput{Title: title, PageCount: pages, Size: int64(len(data)), File: bytes.NewReader(data)})
}

// Covers SPEC-068 CA-01: a PDF sent with the room open is kept, and the room goes on.
func TestUploadDeck_PDFWithTheRoomOpen(t *testing.T) {
	w, svc, storage := uploadWorld(t)
	room, _, err := svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "Aula"})
	require.NoError(t, err)

	view, err := send(t, svc, w, "Slides", 12, pdfBytes())
	require.NoError(t, err)
	assert.Equal(t, domain.KindPDF, view.Deck.Kind)
	assert.Equal(t, 12, view.Deck.PageCount)
	assert.Equal(t, "classes/"+w.class.String()+"/decks/"+view.Deck.ID.String()+".pdf", view.Deck.ObjectKey)
	assert.Equal(t, "application/pdf", storage.types[view.Deck.ObjectKey])
	assert.NotEmpty(t, view.DownloadURL)

	active, err := svc.GetActive(context.Background(), w.teacher, w.class)
	require.NoError(t, err)
	assert.True(t, active.Found, "the room is still open")
	assert.Equal(t, room.ID, active.Session.ID)
}

// Covers SPEC-068 CA-02 (RN-04): an image is one slide, kept with its own type for the browser to show it, whatever page count came with it.
func TestUploadDeck_ImagesWithTheRoomOpen(t *testing.T) {
	cases := map[string]struct {
		data        []byte
		contentType string
		ext         string
		pagesSent   int
	}{
		"png":  {pngBytes, "image/png", ".png", 0},
		"jpeg": {jpegBytes, "image/jpeg", ".jpg", 9},
		"webp": {webpBytes, "image/webp", ".webp", 0},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			w, svc, storage := uploadWorld(t)
			_, _, err := svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "Aula"})
			require.NoError(t, err)

			view, err := send(t, svc, w, "Esquema", tc.pagesSent, tc.data)
			require.NoError(t, err)
			assert.Equal(t, domain.KindImage, view.Deck.Kind)
			assert.Equal(t, 1, view.Deck.PageCount)
			assert.Equal(t, "classes/"+w.class.String()+"/decks/"+view.Deck.ID.String()+tc.ext, view.Deck.ObjectKey)
			assert.Equal(t, tc.contentType, storage.types[view.Deck.ObjectKey])
			assert.Equal(t, domain.KindImage, w.repo.decks[view.Deck.ID].Kind, "and the repository keeps the kind")
			assert.Equal(t, tc.data, w.store.body[view.Deck.ObjectKey], "the whole image is stored")
		})
	}
}

// Covers SPEC-068 CA-03, CA-04, CA-05: what is not a presentation, the image over 10 MB, the class with the most presentations and who does not
// run the class are refused, and nothing is stored.
func TestUploadDeck_Refusals(t *testing.T) {
	w, svc, _ := uploadWorld(t)
	ctx := context.Background()

	_, err := send(t, svc, w, "x", 3, []byte("GIF89a not accepted"))
	assert.ErrorIs(t, err, domain.ErrInvalidFile)
	_, err = send(t, svc, w, "x", 3, []byte("PK\x03\x04 a powerpoint file"))
	assert.ErrorIs(t, err, domain.ErrInvalidFile)
	_, err = svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "x", Size: domain.MaxImageBytes + 1, File: bytes.NewReader(pngBytes)})
	assert.ErrorIs(t, err, domain.ErrFileTooLarge)
	_, err = svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "x", PageCount: 3, Size: domain.MaxDeckBytes + 1, File: bytes.NewReader(pdfBytes())})
	assert.ErrorIs(t, err, domain.ErrFileTooLarge)

	for _, who := range []service.Actor{w.student, w.other} {
		_, err = svc.UploadDeck(ctx, who, w.class, service.UploadInput{Title: "x", Size: int64(len(pngBytes)), File: bytes.NewReader(pngBytes)})
		assert.ErrorIs(t, err, domain.ErrForbidden)
	}
	assert.Empty(t, w.repo.decks)
	assert.Empty(t, w.store.puts)

	for i := 0; i < domain.MaxDecksPerClass; i++ {
		id := uuid.New()
		w.repo.decks[id] = domain.SlideDeck{Model: database.Model{ID: id}, ClassID: w.class, Kind: domain.KindPDF, PageCount: 1}
	}
	_, err = send(t, svc, w, "x", 0, pngBytes)
	assert.ErrorIs(t, err, domain.ErrDeckLimit, "an image takes one of the presentations of the class too")
	assert.Empty(t, w.store.puts)
}

// deckOf keeps a presentation of the class, as an upload would.
func deckOf(t *testing.T, svc *service.Service, w *world, title string, pages int, data []byte) domain.SlideDeck {
	t.Helper()
	view, err := send(t, svc, w, title, pages, data)
	require.NoError(t, err)
	return view.Deck
}

// Covers SPEC-068 CA-06, CA-08 (RN-05): choosing a presentation puts it on the stage at the first slide and in the slides mode, takes away what was
// drawn on the other one, and the snapshot of who comes in later has it.
func TestSelectDeck_PutsItOnTheStage(t *testing.T) {
	w, svc, _ := uploadWorld(t)
	ctx := context.Background()
	slides := deckOf(t, svc, w, "Slides", 5, pdfBytes())
	picture := deckOf(t, svc, w, "Esquema", 0, pngBytes)
	moduleID := uuid.New()
	w.repo.modules[moduleID] = true
	room, _, err := svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "Aula", DeckID: &slides.ID})
	require.NoError(t, err)
	require.NoError(t, svc.ChangeSlide(ctx, room.ID, 4))
	svc.RememberDrawing(room.ID, []byte(`{"path":[[1,2]]}`))
	require.NoError(t, svc.SwitchMode(ctx, w.teacher, room.ID, domain.ModeModule, &moduleID))

	view, err := svc.SelectDeck(ctx, w.teacher, room.ID, picture.ID)
	require.NoError(t, err)
	assert.Equal(t, picture.ID, view.Deck.ID)
	assert.Equal(t, domain.KindImage, view.Deck.Kind)
	assert.NotEmpty(t, view.DownloadURL, "with a fresh address")

	saved := w.repo.sessions[room.ID]
	require.NotNil(t, saved.DeckID)
	assert.Equal(t, picture.ID, *saved.DeckID)
	assert.Equal(t, 1, saved.CurrentSlide)
	assert.Equal(t, domain.ModeSlides, saved.DisplayMode)

	later, err := svc.GetActive(ctx, w.student, w.class)
	require.NoError(t, err)
	require.NotNil(t, later.Deck)
	assert.Equal(t, picture.ID, later.Deck.Deck.ID, "who comes in later gets the presentation that is on the stage")
	assert.Equal(t, 1, later.Session.CurrentSlide)
	assert.Empty(t, later.Drawings, "what was drawn on the other presentation is gone")

	// the slides of the new one are the ones that count from now on
	assert.ErrorIs(t, svc.ChangeSlide(ctx, room.ID, 2), domain.ErrInvalidSlide, "an image has one slide")
	back, err := svc.SelectDeck(ctx, w.teacher, room.ID, slides.ID)
	require.NoError(t, err)
	assert.Equal(t, slides.ID, back.Deck.ID)
	assert.NoError(t, svc.ChangeSlide(ctx, room.ID, 4))
}

// Covers SPEC-068 CA-07: a presentation of another class, one that does not exist, a room that ended and who does not run the class change
// nothing.
func TestSelectDeck_Refusals(t *testing.T) {
	w, svc, _ := uploadWorld(t)
	ctx := context.Background()
	mine := deckOf(t, svc, w, "Slides", 5, pdfBytes())
	elsewhere := uuid.New()
	w.repo.decks[elsewhere] = domain.SlideDeck{Model: database.Model{ID: elsewhere}, ClassID: w.archived, Kind: domain.KindPDF, PageCount: 3}
	room, _, err := svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "Aula", DeckID: &mine.ID})
	require.NoError(t, err)
	before := w.repo.sessions[room.ID]

	for name, id := range map[string]uuid.UUID{"another class": elsewhere, "unknown": uuid.New()} {
		_, err = svc.SelectDeck(ctx, w.teacher, room.ID, id)
		assert.ErrorIs(t, err, domain.ErrDeckNotFound, name)
	}
	for _, who := range []service.Actor{w.student, w.other} {
		_, err = svc.SelectDeck(ctx, who, room.ID, mine.ID)
		assert.ErrorIs(t, err, domain.ErrForbidden)
	}
	assert.Equal(t, before, w.repo.sessions[room.ID], "nothing changed")

	_, err = svc.EndSession(ctx, w.teacher, w.class, room.ID)
	require.NoError(t, err)
	_, err = svc.SelectDeck(ctx, w.teacher, room.ID, mine.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a room that ended has no stage")
}
