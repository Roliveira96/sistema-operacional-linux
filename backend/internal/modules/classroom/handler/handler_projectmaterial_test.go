package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// ---- SPEC-074 CA-16: the route that puts a material of a lesson on the list of presentations of the class ----

type projection struct {
	actor    service.Actor
	class    uuid.UUID
	material uuid.UUID
}

// projectService answers ProjectMaterial with what the test put in it, and records the calls.
type projectService struct {
	*fakeService
	mu      sync.Mutex
	view    service.DeckView
	created bool
	err     error
	calls   []projection
}

func (p *projectService) ProjectMaterial(_ context.Context, a service.Actor, class, material uuid.UUID) (service.DeckView, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls = append(p.calls, projection{actor: a, class: class, material: material})
	return p.view, p.created, p.err
}

// ProjectMaterial keeps the fake service whole for the tests that have no use for it.
func (f *fakeService) ProjectMaterial(context.Context, service.Actor, uuid.UUID, uuid.UUID) (service.DeckView, bool, error) {
	return service.DeckView{}, false, nil
}

func setupProjection(t *testing.T) (*world, *projectService) {
	t.Helper()
	w := setup(t)
	svc := &projectService{fakeService: w.svc}
	core, logs := observer.New(zap.WarnLevel)
	w.logs = logs
	w.h = handler.New(svc, validator{people: w.people}, zap.New(core), handler.Options{})
	w.srv = httptest.NewServer(server.NewEngine(zap.NewNop(), nil, w.h))
	t.Cleanup(w.srv.Close)
	return w, svc
}

func TestProjectMaterialRoute(t *testing.T) {
	w, svc := setupProjection(t)
	material, deckID := uuid.New(), uuid.New()
	svc.view = service.DeckView{
		Deck: domain.SlideDeck{
			Model:     database.Model{ID: deckID, CreatedAt: time.Date(2026, 10, 19, 14, 0, 0, 0, time.UTC)},
			Title:     "Slides 01",
			PageCount: 12,
			Kind:      domain.KindPDF,
			ObjectKey: "classes/c/sessions/s/materials/m.pdf",
		},
		DownloadURL: "https://files.example/m.pdf?ttl=900",
	}

	// a new presentation: 201, as the upload of the room answers
	svc.created = true
	code, body := w.call(t, "teacher", http.MethodPost, w.path("/decks/from-material"), map[string]any{"materialId": material.String()})
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, deckID.String(), body["id"])
	assert.Equal(t, "Slides 01", body["title"])
	assert.EqualValues(t, 12, body["pageCount"])
	assert.Equal(t, "PDF", body["kind"])
	assert.Equal(t, "https://files.example/m.pdf?ttl=900", body["downloadUrl"])
	assert.Equal(t, "2026-10-19T14:00:00Z", body["createdAt"])
	assert.NotContains(t, body, "objectKey")
	require.Len(t, svc.calls, 1)
	assert.Equal(t, projection{actor: service.Actor{UserID: w.teacher.UserID, Role: w.teacher.Role}, class: w.class, material: material}, svc.calls[0])

	// the one that was already there: 200
	svc.created = false
	code, body = w.call(t, "teacher", http.MethodPost, w.path("/decks/from-material"), map[string]any{"materialId": material.String()})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, deckID.String(), body["id"])
}

func TestProjectMaterialRouteErrors(t *testing.T) {
	w, svc := setupProjection(t)
	material := map[string]any{"materialId": uuid.NewString()}
	cases := []struct {
		err    error
		status int
		kind   string
	}{
		{domain.ErrMaterialNotProjectable, http.StatusBadRequest, "material-not-projectable"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrMaterialNotFound, http.StatusNotFound, "material-not-found"},
		{domain.ErrDeckLimit, http.StatusConflict, "deck-limit-exceeded"},
	}
	for _, c := range cases {
		svc.err = c.err
		code, body := w.call(t, "teacher", http.MethodPost, w.path("/decks/from-material"), material)
		assert.Equal(t, c.status, code, c.err.Error())
		assert.Equal(t, c.kind, body["type"], c.err.Error())
	}

	// the request is checked before the service is asked
	svc.err = nil
	before := len(svc.calls)
	for _, bad := range []any{map[string]any{}, map[string]any{"materialId": "not-a-uuid"}, "{"} {
		code, _ := w.call(t, "teacher", http.MethodPost, w.path("/decks/from-material"), bad)
		assert.Equal(t, http.StatusBadRequest, code)
	}
	assert.Len(t, svc.calls, before, "a bad request never reaches the service")

	// no login, no route
	code, _ := w.call(t, "nobody", http.MethodPost, w.path("/decks/from-material"), material)
	assert.Equal(t, http.StatusUnauthorized, code)
}
