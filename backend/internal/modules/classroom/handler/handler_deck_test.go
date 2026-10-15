package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// ---- SPEC-068: images as presentations, and the teacher choosing what is on the stage ----

// deckChoice is a call of SelectDeck.
type deckChoice struct {
	actor   service.Actor
	session uuid.UUID
	deck    uuid.UUID
}

// deckService answers the choice of a presentation with what the test put in it, and records the calls.
type deckService struct {
	*fakeService
	mu      sync.Mutex
	view    service.DeckView
	err     error
	choices []deckChoice
}

func (d *deckService) SelectDeck(_ context.Context, a service.Actor, session, deck uuid.UUID) (service.DeckView, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.choices = append(d.choices, deckChoice{actor: a, session: session, deck: deck})
	return d.view, d.err
}

func (d *deckService) chosen() []deckChoice {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]deckChoice(nil), d.choices...)
}

// SelectDeck keeps the fake service whole for the tests that have no use for it; deckService answers for the tests that do.
func (f *fakeService) SelectDeck(context.Context, service.Actor, uuid.UUID, uuid.UUID) (service.DeckView, error) {
	return service.DeckView{}, nil
}

// setupDecks is the world of setup with a service that takes the choice of a presentation.
func setupDecks(t *testing.T) (*world, *deckService) {
	t.Helper()
	w := setup(t)
	svc := &deckService{fakeService: w.svc}
	core, logs := observer.New(zap.WarnLevel)
	w.logs = logs
	w.h = handler.New(svc, validator{people: w.people}, zap.New(core), handler.Options{})
	w.srv = httptest.NewServer(server.NewEngine(zap.NewNop(), nil, w.h))
	t.Cleanup(w.srv.Close)
	return w, svc
}

const (
	deckSelectMessage  = "live:deck:select"
	deckChangedMessage = "live:deck:changed"
)

// Covers SPEC-068 section 5: the answer of the upload and the items of the list say the kind of the presentation; an image needs no page count.
func TestUploadRoute_Image(t *testing.T) {
	w := setup(t)
	deckID := uuid.New()
	w.svc.deck = service.DeckView{Deck: domain.SlideDeck{Model: database.Model{ID: deckID, CreatedAt: time.Date(2026, 10, 15, 18, 0, 0, 0, time.UTC)}, Title: "Esquema", PageCount: 1, Kind: domain.KindImage}, DownloadURL: "https://files.test/e.png?ttl=900"}
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, make([]byte, 100)...)

	code, body := w.call(t, "teacher", http.MethodPost, w.path("/decks"), multipartBody(t, map[string]string{"title": "Esquema"}, png))
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, "IMAGE", body["kind"])
	assert.EqualValues(t, 1, body["pageCount"])
	assert.Equal(t, "https://files.test/e.png?ttl=900", body["downloadUrl"])
	assert.Equal(t, 0, w.svc.upload.PageCount, "no page count was sent, and the handler does not make one up")
	assert.Equal(t, png, w.svc.uploaded)

	code, body = w.call(t, "teacher", http.MethodPost, w.path("/decks"), multipartBody(t, map[string]string{"title": "x", "pageCount": "abc"}, png))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-pdf", body["type"], "a page count that is there must be a number")
}

// Covers SPEC-068 section 5: the list tells the kind of each presentation.
func TestDecksRoute_TellsTheKind(t *testing.T) {
	w := setup(t)
	w.svc.decks = []domain.SlideDeck{
		{Model: database.Model{ID: uuid.New()}, Title: "Esquema", PageCount: 1, Kind: domain.KindImage},
		{Model: database.Model{ID: uuid.New()}, Title: "Slides", PageCount: 10, Kind: domain.KindPDF},
	}
	code, body := w.call(t, "teacher", http.MethodGet, w.path("/decks"), nil)
	require.Equal(t, http.StatusOK, code)
	decks := body["decks"].([]any)
	require.Len(t, decks, 2)
	assert.Equal(t, "IMAGE", decks[0].(map[string]any)["kind"])
	assert.Equal(t, "PDF", decks[1].(map[string]any)["kind"])
}

// Covers SPEC-068 CA-03: content that is not an accepted format is 400 invalid-file, with the field.
func TestUploadRoute_InvalidFile(t *testing.T) {
	w := setup(t)
	w.svc.err = &domain.FieldError{Field: "file", Err: domain.ErrInvalidFile}
	code, body := w.call(t, "teacher", http.MethodPost, w.path("/decks"), multipartBody(t, map[string]string{"title": "x"}, []byte("GIF89a")))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-file", body["type"])
	assert.Equal(t, "file", body["field"])
}

// Covers SPEC-068 CA-06 (RN-05, RN-06): the panel chooses a presentation; the service decides, and everybody admitted in the room gets the new
// stage (the panel, the presenter window and the students), but not who waits to be admitted.
func TestDeckSelect_ReachesEverybodyAdmitted(t *testing.T) {
	w, svc := setupDecks(t)
	deckID := uuid.New()
	svc.view = service.DeckView{Deck: domain.SlideDeck{Model: database.Model{ID: deckID}, Title: "Esquema", PageCount: 1, Kind: domain.KindImage}, DownloadURL: "https://files.test/e.png?ttl=900"}
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	for _, c := range []*websocket.Conn{panel, presenter, student} {
		readUntil(t, c, "live:snapshot")
	}
	w.svc.waiting = true
	waiting := w.dial(t, "stranger")
	readUntil(t, waiting, "live:admission:state")

	sendMsg(t, panel, deckSelectMessage, `{"deckId":"`+deckID.String()+`"}`)

	for name, c := range map[string]*websocket.Conn{"panel": panel, "presenter": presenter, "student": student} {
		var got struct {
			ActiveDeck   map[string]any `json:"activeDeck"`
			DisplayMode  string         `json:"displayMode"`
			CurrentSlide int            `json:"currentSlide"`
		}
		require.NoError(t, json.Unmarshal(readUntil(t, c, deckChangedMessage).Data, &got), name)
		assert.Equal(t, deckID.String(), got.ActiveDeck["id"], name)
		assert.Equal(t, "IMAGE", got.ActiveDeck["kind"], name)
		assert.Equal(t, "https://files.test/e.png?ttl=900", got.ActiveDeck["downloadUrl"], name)
		assert.EqualValues(t, 1, got.ActiveDeck["pageCount"], name)
		assert.Equal(t, "SLIDES", got.DisplayMode, name)
		assert.Equal(t, 1, got.CurrentSlide, name)
	}
	nothingMore(t, waiting, deckChangedMessage)

	require.Len(t, svc.chosen(), 1)
	choice := svc.chosen()[0]
	assert.Equal(t, deckID, choice.deck)
	assert.Equal(t, w.session.ID, choice.session)
	assert.Equal(t, authn.RoleTeacher, choice.actor.Role)
	assert.Equal(t, w.teacher.UserID, choice.actor.UserID)
}

// Covers SPEC-068 CA-07: the service refuses (another class, no such presentation), and nothing goes out; a message that is not from the panel, or
// that has no presentation, is dropped or rejected before the service is asked.
func TestDeckSelect_Refusals(t *testing.T) {
	w, svc := setupDecks(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	student := w.dial(t, "student")
	watcher := w.dial(t, "second")
	for _, c := range []*websocket.Conn{panel, presenter, student, watcher} {
		readUntil(t, c, "live:snapshot")
	}
	deckID := uuid.New().String()

	svc.err = domain.ErrDeckNotFound
	sendMsg(t, panel, deckSelectMessage, `{"deckId":"`+deckID+`"}`)
	eventually(t, func() bool { return len(svc.chosen()) == 1 })
	eventually(t, func() bool { return len(w.logs.FilterMessage("classroom message rejected").All()) == 1 })

	svc.err = nil
	sendMsg(t, presenter, deckSelectMessage, `{"deckId":"`+deckID+`"}`) // the presenter window is not the panel
	sendMsg(t, student, deckSelectMessage, `{"deckId":"`+deckID+`"}`)   // nor is a student the teacher
	eventually(t, func() bool { return len(droppedReasons(w)) == 2 })
	assert.ElementsMatch(t, []string{deckSelectMessage + ":wrong-view", deckSelectMessage + ":not-controller"}, droppedReasons(w))

	sendMsg(t, panel, deckSelectMessage, `{}`)
	sendMsg(t, panel, deckSelectMessage, `{"deckId":"not-a-uuid"}`)
	eventually(t, func() bool { return len(w.logs.FilterMessage("classroom message rejected").All()) == 3 })

	assert.Len(t, svc.chosen(), 1, "only the first message got to the service")
	nothingMore(t, watcher, deckChangedMessage)
}

// Covers SPEC-068 section 5: the message of the choice has a small limit, like the other messages of the teacher.
func TestDeckSelect_IsSmall(t *testing.T) {
	w, svc := setupDecks(t)
	panel := w.dialView(t, "teacher", "panel")
	readUntil(t, panel, "live:snapshot")
	big := make([]byte, 2048)
	for i := range big {
		big[i] = 'x'
	}
	require.NoError(t, panel.WriteJSON(obj{"type": deckSelectMessage, "data": obj{"deckId": uuid.NewString(), "pad": string(big)}}))
	eventually(t, func() bool { return len(w.logs.FilterMessage("classroom message rejected").All()) == 1 })
	assert.Equal(t, "too-large", w.logs.FilterMessage("classroom message rejected").All()[0].ContextMap()["reason"])
	assert.Empty(t, svc.chosen())
}
