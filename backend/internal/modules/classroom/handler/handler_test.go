package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
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

// ---- test doubles ----

// validator maps the value of the session cookie to who is calling.
type validator struct{ people map[string]authn.Principal }

func (v validator) Authenticate(_ context.Context, token string) (authn.Principal, error) {
	p, ok := v.people[token]
	if !ok {
		return authn.Principal{}, errors.New("unknown token")
	}
	return p, nil
}

// fakeService records the calls and answers with what the test put in it.
type fakeService struct {
	mu  sync.Mutex
	err error // returned by every REST use case when set

	session  domain.LiveClassroomSession
	created  bool
	active   service.Active
	summary  []service.SessionSummary
	deck     service.DeckView
	decks    []domain.SlideDeck
	note     domain.LiveClassroomNote
	connErr  error
	queue    []domain.HandRaiseEntry
	teacher  uuid.UUID
	calls    []string
	upload   service.UploadInput
	uploaded []byte
	actor    service.Actor
	start    service.StartInput
	slides   []int
	modes    []string
	moduleID *uuid.UUID
	drawings []string
	input    []string
	syncs    []string
	moderate []*uuid.UUID
	presence int
}

func (f *fakeService) record(s string) {
	f.mu.Lock()
	f.calls = append(f.calls, s)
	f.mu.Unlock()
}

func (f *fakeService) called(s string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if c == s {
			n++
		}
	}
	return n
}

func (f *fakeService) StartSession(_ context.Context, a service.Actor, _ uuid.UUID, in service.StartInput) (domain.LiveClassroomSession, bool, error) {
	f.actor, f.start = a, in
	return f.session, f.created, f.err
}
func (f *fakeService) EndSession(_ context.Context, a service.Actor, _, _ uuid.UUID) (domain.LiveClassroomSession, error) {
	f.actor = a
	return f.session, f.err
}
func (f *fakeService) UploadDeck(_ context.Context, a service.Actor, _ uuid.UUID, in service.UploadInput) (service.DeckView, error) {
	f.actor, f.upload = a, service.UploadInput{Title: in.Title, PageCount: in.PageCount, Size: in.Size}
	f.uploaded, _ = io.ReadAll(in.File)
	return f.deck, f.err
}
// ListDecks answers with the decks set in the test (SPEC-053).
func (f *fakeService) ListDecks(_ context.Context, a service.Actor, _ uuid.UUID) ([]domain.SlideDeck, error) {
	f.actor = a
	return f.decks, f.err
}
func (f *fakeService) GetActive(_ context.Context, a service.Actor, _ uuid.UUID) (service.Active, error) {
	f.actor = a
	return f.active, f.err
}
func (f *fakeService) ListSessions(_ context.Context, a service.Actor, _ uuid.UUID) ([]service.SessionSummary, error) {
	f.actor = a
	return f.summary, f.err
}
func (f *fakeService) SaveNote(_ context.Context, a service.Actor, _, _ uuid.UUID, content string) (domain.LiveClassroomNote, error) {
	f.actor = a
	f.note.Content = content
	return f.note, f.err
}
func (f *fakeService) GetNote(_ context.Context, a service.Actor, _, _ uuid.UUID) (domain.LiveClassroomNote, error) {
	f.actor = a
	return f.note, f.err
}
func (f *fakeService) Connect(_ context.Context, a service.Actor, _ uuid.UUID) (service.Connection, error) {
	f.actor = a
	if f.connErr != nil {
		return service.Connection{}, f.connErr
	}
	return service.Connection{Session: f.session, Controller: a.Role == authn.RoleTeacher || a.Role == authn.RoleAdmin}, nil
}
func (f *fakeService) Snapshot(context.Context, uuid.UUID) (service.Active, error) {
	return f.active, nil
}
func (f *fakeService) ChangeSlide(_ context.Context, _ uuid.UUID, slide int) error {
	f.mu.Lock()
	f.slides = append(f.slides, slide)
	f.mu.Unlock()
	return nil
}
func (f *fakeService) SwitchMode(_ context.Context, _ uuid.UUID, mode string, module *uuid.UUID) error {
	f.mu.Lock()
	f.modes = append(f.modes, mode)
	f.moduleID = module
	f.mu.Unlock()
	return nil
}
func (f *fakeService) RememberDrawing(_ uuid.UUID, raw json.RawMessage) {
	f.mu.Lock()
	f.drawings = append(f.drawings, string(raw))
	f.mu.Unlock()
}
func (f *fakeService) RememberTerminalInput(_ uuid.UUID, raw json.RawMessage) {
	f.mu.Lock()
	f.input = append(f.input, string(raw))
	f.mu.Unlock()
}
func (f *fakeService) RememberTerminalSync(_ uuid.UUID, raw json.RawMessage) {
	f.mu.Lock()
	f.syncs = append(f.syncs, string(raw))
	f.mu.Unlock()
}
func (f *fakeService) RaiseHand(_ context.Context, _ uuid.UUID, student uuid.UUID) ([]domain.HandRaiseEntry, error) {
	f.record("raise")
	f.queue = append(f.queue, domain.HandRaiseEntry{StudentID: student, Name: "Ana", RequestedAt: time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)})
	return f.queue, nil
}
func (f *fakeService) LowerHand(_ context.Context, _ uuid.UUID, _ uuid.UUID) ([]domain.HandRaiseEntry, error) {
	f.record("lower")
	f.queue = nil
	return f.queue, nil
}
func (f *fakeService) ModerateHand(_ context.Context, _ uuid.UUID, student *uuid.UUID) ([]domain.HandRaiseEntry, error) {
	f.record("moderate")
	f.mu.Lock()
	f.moderate = append(f.moderate, student)
	f.mu.Unlock()
	f.queue = nil
	return f.queue, nil
}
func (f *fakeService) TeacherPresence(context.Context, uuid.UUID) error {
	f.record("presence")
	return nil
}

type world struct {
	srv      *httptest.Server
	svc      *fakeService
	h        *handler.Handler
	logs     *observer.ObservedLogs
	class    uuid.UUID
	session  domain.LiveClassroomSession
	teacher  authn.Principal
	student  authn.Principal
	stranger authn.Principal
}

func setup(t *testing.T) *world {
	t.Helper()
	core, logs := observer.New(zap.WarnLevel)
	w := &world{svc: &fakeService{}, logs: logs, class: uuid.New()}
	w.teacher = authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher}
	w.student = authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}
	w.stranger = authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}
	val := validator{people: map[string]authn.Principal{"teacher": w.teacher, "student": w.student, "second": w.student, "teacher2": {UserID: w.teacher.UserID, Role: authn.RoleTeacher}, "stranger": w.stranger}}
	w.session = domain.LiveClassroomSession{Model: database.Model{ID: uuid.New()}, ClassID: w.class, TeacherID: w.teacher.UserID, Title: "Aula",
		DisplayMode: domain.ModeSlides, CurrentSlide: 2, Status: domain.StatusActive, StartedAt: time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)}
	w.svc.session = w.session
	w.svc.active = service.Active{Found: true, Session: w.session}
	w.h = handler.New(w.svc, val, zap.New(core), handler.Options{})
	w.srv = httptest.NewServer(server.NewEngine(zap.NewNop(), nil, w.h))
	t.Cleanup(w.srv.Close)
	return w
}

func (w *world) path(suffix string) string {
	return "/api/v1/classes/" + w.class.String() + "/live" + suffix
}

func (w *world) call(t *testing.T, token, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var raw []byte
	contentType := "application/json"
	switch b := body.(type) {
	case nil:
	case string:
		raw = []byte(b)
	case *bytes.Buffer:
		raw = b.Bytes()
	default:
		var err error
		raw, err = json.Marshal(b)
		require.NoError(t, err)
	}
	req, err := http.NewRequest(method, w.srv.URL+path, bytes.NewReader(raw))
	require.NoError(t, err)
	if buf, ok := body.(*bytes.Buffer); ok {
		_ = buf
		contentType = "multipart/form-data; boundary=" + multipartBoundary
	}
	req.Header.Set("Content-Type", contentType)
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: token})
	res, err := w.srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &out)
	}
	return res.StatusCode, out
}

const multipartBoundary = "testboundary"

func multipartBody(t *testing.T, fields map[string]string, file []byte) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	mw := multipart.NewWriter(buf)
	require.NoError(t, mw.SetBoundary(multipartBoundary))
	for k, v := range fields {
		require.NoError(t, mw.WriteField(k, v))
	}
	if file != nil {
		fw, err := mw.CreateFormFile("file", "slides.pdf")
		require.NoError(t, err)
		_, _ = fw.Write(file)
	}
	require.NoError(t, mw.Close())
	return buf
}

type obj = map[string]any

// ---- REST ----

// Covers SPEC-051 CA-01, CA-17 and section 5.1: 201 when the room is created, 200 when it was already open.
func TestStartRoute(t *testing.T) {
	w := setup(t)
	w.svc.created = true
	deck, lesson := uuid.New(), uuid.New()
	code, body := w.call(t, "teacher", http.MethodPost, w.path("/start"), obj{"title": "Aula", "deckId": deck.String(), "classSessionId": lesson.String()})
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, w.session.ID.String(), body["id"])
	assert.Equal(t, w.class.String(), body["classId"])
	assert.Equal(t, "Aula", body["title"])
	assert.Equal(t, "ACTIVE", body["status"])
	assert.Equal(t, "SLIDES", body["displayMode"])
	assert.EqualValues(t, 2, body["currentSlide"])
	assert.Equal(t, "2026-10-14T19:00:00Z", body["startedAt"])
	assert.Equal(t, w.teacher.UserID, w.svc.actor.UserID)
	assert.Equal(t, authn.RoleTeacher, w.svc.actor.Role)
	assert.Equal(t, "Aula", w.svc.start.Title)
	assert.Equal(t, &deck, w.svc.start.DeckID)
	assert.Equal(t, &lesson, w.svc.start.ClassSessionID)

	w.svc.created = false
	code, _ = w.call(t, "teacher", http.MethodPost, w.path("/start"), obj{"title": "Aula"})
	assert.Equal(t, http.StatusOK, code, "the room was already open")
}

// Covers SPEC-051 section 5: the problems of every route, in RFC 7807.
func TestRoutesAndProblems(t *testing.T) {
	w := setup(t)
	cases := []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrSessionNotFound, http.StatusNotFound, "session-not-found"},
		{domain.ErrDeckNotFound, http.StatusNotFound, "deck-not-found"},
		{domain.ErrClassSessionNotFound, http.StatusNotFound, "class-session-not-found"},
		{domain.ErrModuleNotFound, http.StatusNotFound, "module-not-found"},
		{domain.ErrClassArchived, http.StatusConflict, "class-archived"},
		{domain.ErrDeckLimit, http.StatusConflict, "deck-limit-exceeded"},
		{domain.ErrInvalidPDF, http.StatusBadRequest, "invalid-pdf"},
		{domain.ErrFileTooLarge, http.StatusRequestEntityTooLarge, "file-too-large"},
		{domain.ErrContentTooLong, http.StatusBadRequest, "content-too-long"},
		{domain.ErrNotesNotFound, http.StatusNotFound, "notes-not-found"},
		{errors.New("boom"), http.StatusInternalServerError, "internal-error"},
	}
	sid := w.session.ID.String()
	routes := []struct {
		name, method, path, token string
		body                      any
	}{
		{"start", http.MethodPost, w.path("/start"), "teacher", obj{"title": "x"}},
		{"end", http.MethodPost, w.path("/sessions/" + sid + "/end"), "teacher", nil},
		{"active", http.MethodGet, w.path("/active"), "student", nil},
		{"list", http.MethodGet, w.path("/sessions"), "student", nil},
		{"save note", http.MethodPut, w.path("/sessions/" + sid + "/notes"), "student", obj{"content": "x"}},
		{"get note", http.MethodGet, w.path("/sessions/" + sid + "/notes"), "student", nil},
	}
	for _, tc := range cases {
		w.svc.err = tc.err
		for _, r := range routes {
			code, body := w.call(t, r.token, r.method, r.path, r.body)
			assert.Equal(t, tc.status, code, "%s with %v", r.name, tc.err)
			assert.Equal(t, tc.typ, body["type"], "%s with %v", r.name, tc.err)
		}
	}

	// The title error points at its field.
	w.svc.err = &domain.FieldError{Field: "title", Err: domain.ErrInvalidTitle}
	code, body := w.call(t, "teacher", http.MethodPost, w.path("/start"), obj{"title": " "})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "validation-error", body["type"])
	assert.Equal(t, "title", body["field"])
	w.svc.err = &domain.FieldError{Field: "pageCount", Err: domain.ErrInvalidPDF}
	code, body = w.call(t, "teacher", http.MethodPost, w.path("/decks"), multipartBody(t, map[string]string{"title": "x", "pageCount": "0"}, []byte("%PDF-1")))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-pdf", body["type"])
	assert.Equal(t, "pageCount", body["field"])
}

// Covers SPEC-051 section 5: ids, bodies and sessions are checked before the service is called.
func TestRoutesCheckTheRequest(t *testing.T) {
	w := setup(t)
	code, body := w.call(t, "teacher", http.MethodPost, "/api/v1/classes/not-a-uuid/live/start", obj{"title": "x"})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-uuid", body["type"])
	code, body = w.call(t, "teacher", http.MethodPost, w.path("/sessions/not-a-uuid/end"), nil)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-uuid", body["type"])
	code, body = w.call(t, "teacher", http.MethodPost, w.path("/start"), "{broken")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "malformed-request", body["type"])
	code, body = w.call(t, "teacher", http.MethodPost, w.path("/start"), obj{"title": "x", "deckId": "nope"})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-uuid", body["type"])
	code, body = w.call(t, "student", http.MethodPut, w.path("/sessions/"+w.session.ID.String()+"/notes"), obj{})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "malformed-request", body["type"], "content is required")

	req, _ := http.NewRequest(http.MethodGet, w.srv.URL+w.path("/active"), nil)
	res, err := w.srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode, "no cookie, no access")
}

// Covers SPEC-051 CA-12 and section 5.2.
func TestEndRoute(t *testing.T) {
	w := setup(t)
	ended := time.Date(2026, 10, 14, 21, 0, 0, 0, time.UTC)
	w.svc.session.Status = domain.StatusFinished
	w.svc.session.EndedAt = &ended
	code, body := w.call(t, "teacher", http.MethodPost, w.path("/sessions/"+w.session.ID.String()+"/end"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, w.session.ID.String(), body["id"])
	assert.Equal(t, "FINISHED", body["status"])
	assert.Equal(t, "2026-10-14T21:00:00Z", body["endedAt"])
}

// Covers SPEC-051 CA-03 and section 5.3: the multipart upload.
func TestUploadRoute(t *testing.T) {
	w := setup(t)
	deckID := uuid.New()
	w.svc.deck = service.DeckView{Deck: domain.SlideDeck{Model: database.Model{ID: deckID, CreatedAt: time.Date(2026, 10, 14, 18, 0, 0, 0, time.UTC)}, Title: "Slides", PageCount: 12}, DownloadURL: "https://files.test/x?ttl=900"}
	pdf := append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte("x"), 500)...)
	code, body := w.call(t, "teacher", http.MethodPost, w.path("/decks"), multipartBody(t, map[string]string{"title": "Slides", "pageCount": "12"}, pdf))
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, deckID.String(), body["id"])
	assert.Equal(t, "Slides", body["title"])
	assert.EqualValues(t, 12, body["pageCount"])
	assert.Equal(t, "https://files.test/x?ttl=900", body["downloadUrl"])
	assert.Equal(t, "2026-10-14T18:00:00Z", body["createdAt"])
	assert.Equal(t, "Slides", w.svc.upload.Title)
	assert.Equal(t, 12, w.svc.upload.PageCount)
	assert.EqualValues(t, len(pdf), w.svc.upload.Size)
	assert.Equal(t, pdf, w.svc.uploaded, "the whole file reaches the service")

	code, body = w.call(t, "teacher", http.MethodPost, w.path("/decks"), multipartBody(t, map[string]string{"title": "x", "pageCount": "12"}, nil))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-pdf", body["type"], "no file")
	code, body = w.call(t, "teacher", http.MethodPost, w.path("/decks"), multipartBody(t, map[string]string{"title": "x", "pageCount": "abc"}, pdf))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-pdf", body["type"], "the page count is not a number")
}

// Covers SPEC-051 CA-14 and section 5.4: the active room with its snapshot, or the answer that there is none.
func TestActiveRoute(t *testing.T) {
	w := setup(t)
	deckID := uuid.New()
	w.svc.active = service.Active{
		Found:      true,
		Session:    w.session,
		Deck:       &service.DeckView{Deck: domain.SlideDeck{Model: database.Model{ID: deckID}, Title: "Slides", PageCount: 9}, DownloadURL: "https://files.test/d?ttl=900"},
		Drawings:   []json.RawMessage{json.RawMessage(`{"path":[1,2]}`)},
		Terminal:   service.TerminalState{Input: json.RawMessage(`{"line":"ls"}`), Entries: []json.RawMessage{json.RawMessage(`{"line":"pwd"}`)}, State: json.RawMessage(`{"fs":1}`)},
		HandRaises: []domain.HandRaiseEntry{{StudentID: w.student.UserID, Name: "Ana", RequestedAt: time.Date(2026, 10, 14, 19, 5, 0, 0, time.UTC)}},
	}
	code, body := w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, true, body["hasActiveSession"])
	assert.Equal(t, "SLIDES", body["displayMode"])
	assert.EqualValues(t, 2, body["currentSlide"])
	assert.Nil(t, body["activeModuleId"])
	assert.EqualValues(t, 0, body["onlineCount"])
	session := body["session"].(map[string]any)
	assert.Equal(t, w.session.ID.String(), session["id"])
	assert.Equal(t, "Aula", session["title"])
	activeDeck := body["activeDeck"].(map[string]any)
	assert.Equal(t, deckID.String(), activeDeck["id"])
	assert.EqualValues(t, 9, activeDeck["pageCount"])
	assert.Equal(t, "https://files.test/d?ttl=900", activeDeck["downloadUrl"])
	assert.Len(t, body["recentDrawings"], 1)
	terminal := body["terminal"].(map[string]any)
	assert.JSONEq(t, `{"line":"ls"}`, mustJSON(terminal["input"]))
	assert.Len(t, terminal["entries"], 1)
	assert.JSONEq(t, `{"fs":1}`, mustJSON(terminal["state"]))
	hands := body["handRaises"].([]any)
	require.Len(t, hands, 1)
	assert.Equal(t, "Ana", hands[0].(map[string]any)["name"])
	assert.Equal(t, w.student.UserID.String(), hands[0].(map[string]any)["studentId"])

	w.svc.active = service.Active{}
	code, body = w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, false, body["hasActiveSession"])
	assert.NotContains(t, body, "session")
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

// Covers SPEC-051 CA-18 and section 5.5.
func TestSessionsRoute(t *testing.T) {
	w := setup(t)
	ended := time.Date(2026, 10, 13, 20, 30, 0, 0, time.UTC)
	lesson := uuid.New()
	finished := domain.LiveClassroomSession{Model: database.Model{ID: uuid.New()}, ClassID: w.class, Title: "Ontem", Status: domain.StatusFinished,
		StartedAt: time.Date(2026, 10, 13, 19, 0, 0, 0, time.UTC), EndedAt: &ended, ClassSessionID: &lesson}
	w.svc.summary = []service.SessionSummary{{Session: w.session}, {Session: finished, DurationMinutes: 90, HasNotes: true}}
	code, body := w.call(t, "student", http.MethodGet, w.path("/sessions"), nil)
	require.Equal(t, http.StatusOK, code)
	list := body["sessions"].([]any)
	require.Len(t, list, 2)
	first, second := list[0].(map[string]any), list[1].(map[string]any)
	assert.Equal(t, "ACTIVE", first["status"])
	assert.Nil(t, first["endedAt"])
	assert.Equal(t, "FINISHED", second["status"])
	assert.Equal(t, "Ontem", second["title"])
	assert.EqualValues(t, 90, second["durationMinutes"])
	assert.Equal(t, true, second["hasNotes"])
	assert.Equal(t, lesson.String(), second["classSessionId"])
	assert.Equal(t, "2026-10-13T20:30:00Z", second["endedAt"])
}

// Covers SPEC-051 CA-10 and CA-16, sections 5.6 and 5.7: the student writes and reads his notes.
func TestNotesRoutes(t *testing.T) {
	w := setup(t)
	sid := w.session.ID.String()
	updated := time.Date(2026, 10, 14, 20, 0, 0, 0, time.UTC)
	w.svc.note = domain.LiveClassroomNote{Model: database.Model{UpdatedAt: updated}, SessionID: w.session.ID, StudentID: w.student.UserID}

	code, body := w.call(t, "student", http.MethodPut, w.path("/sessions/"+sid+"/notes"), obj{"content": "threads e processos"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, sid, body["sessionId"])
	assert.EqualValues(t, len("threads e processos"), body["savedLength"])
	assert.Equal(t, "2026-10-14T20:00:00Z", body["updatedAt"])
	assert.Equal(t, w.student.UserID, w.svc.actor.UserID)
	assert.Equal(t, authn.RoleStudent, w.svc.actor.Role)

	w.svc.note.Content = "threads e processos"
	code, body = w.call(t, "student", http.MethodGet, w.path("/sessions/"+sid+"/notes"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "threads e processos", body["content"])
	assert.Equal(t, sid, body["sessionId"])
	assert.Equal(t, "2026-10-14T20:00:00Z", body["updatedAt"])
}

// ---- WebSocket ----

func (w *world) dial(t *testing.T, token string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(w.srv.URL, "http") + w.path("/ws")
	hdr := http.Header{"Cookie": []string{authn.CookieName + "=" + token}}
	c, _, err := websocket.DefaultDialer.Dial(url, hdr)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

type message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func readMsg(t *testing.T, c *websocket.Conn) message {
	t.Helper()
	require.NoError(t, c.SetReadDeadline(time.Now().Add(2*time.Second)))
	var m message
	require.NoError(t, c.ReadJSON(&m))
	return m
}

// readUntil reads until a message of the type arrives, skipping presence and the other noise.
func readUntil(t *testing.T, c *websocket.Conn, typ string) message {
	t.Helper()
	for i := 0; i < 20; i++ {
		if m := readMsg(t, c); m.Type == typ {
			return m
		}
	}
	require.FailNow(t, "message not received", typ)
	return message{}
}

func nothingMore(t *testing.T, c *websocket.Conn, types ...string) {
	t.Helper()
	deadline := time.Now().Add(150 * time.Millisecond)
	for time.Now().Before(deadline) {
		require.NoError(t, c.SetReadDeadline(deadline))
		var m message
		if err := c.ReadJSON(&m); err != nil {
			return
		}
		for _, typ := range types {
			require.NotEqual(t, typ, m.Type, "unexpected %s", m.Type)
		}
	}
}

func sendMsg(t *testing.T, c *websocket.Conn, typ, data string) {
	t.Helper()
	require.NoError(t, c.WriteJSON(obj{"type": typ, "data": json.RawMessage(data)}))
}

func eventually(t *testing.T, cond func() bool) {
	t.Helper()
	require.Eventually(t, cond, 2*time.Second, 5*time.Millisecond)
}

// Covers SPEC-051 CA-14, RN-07 and section 5.8: the first message of a connection is the snapshot of the room.
func TestSnapshotComesFirst(t *testing.T) {
	w := setup(t)
	w.svc.active = service.Active{Found: true, Session: w.session, Terminal: service.TerminalState{State: json.RawMessage(`{"fs":7}`)},
		Drawings: []json.RawMessage{json.RawMessage(`{"path":[9]}`)}}
	c := w.dial(t, "student")
	m := readMsg(t, c)
	assert.Equal(t, "live:snapshot", m.Type)
	var snap map[string]any
	require.NoError(t, json.Unmarshal(m.Data, &snap))
	assert.Equal(t, "SLIDES", snap["displayMode"])
	assert.EqualValues(t, 2, snap["currentSlide"])
	assert.Len(t, snap["recentDrawings"], 1)
	assert.JSONEq(t, `{"fs":7}`, mustJSON(snap["terminal"].(map[string]any)["state"]))
	assert.EqualValues(t, 1, snap["onlineCount"], "the student counts himself")
}

// Covers SPEC-051 CA-02: who cannot see the room is refused before the upgrade, with the problem of the service.
func TestWebSocketRefusals(t *testing.T) {
	w := setup(t)
	url := "ws" + strings.TrimPrefix(w.srv.URL, "http") + w.path("/ws")
	for _, tc := range []struct {
		err    error
		status int
	}{{domain.ErrForbidden, http.StatusForbidden}, {domain.ErrSessionNotFound, http.StatusNotFound}, {domain.ErrClassNotFound, http.StatusNotFound}} {
		w.svc.connErr = tc.err
		_, res, err := websocket.DefaultDialer.Dial(url, http.Header{"Cookie": []string{authn.CookieName + "=stranger"}})
		require.Error(t, err)
		require.NotNil(t, res)
		assert.Equal(t, tc.status, res.StatusCode, "%v", tc.err)
	}
	w.svc.connErr = nil
	_, res, err := websocket.DefaultDialer.Dial(url, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}

// Covers SPEC-051 CA-05, CA-06, CA-07 and section 5.8: what the teacher sends is saved when it must be and reaches the students.
func TestTeacherControlsAreBroadcast(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	student := w.dial(t, "student")
	readUntil(t, teacher, "live:snapshot")
	readUntil(t, student, "live:snapshot")
	module := uuid.New()

	sendMsg(t, teacher, "live:slide:change", `{"slide":3}`)
	assert.JSONEq(t, `{"slide":3}`, string(readUntil(t, student, "live:slide:change").Data))
	eventually(t, func() bool { w.svc.mu.Lock(); defer w.svc.mu.Unlock(); return len(w.svc.slides) == 1 })
	assert.Equal(t, []int{3}, w.svc.slides)

	sendMsg(t, teacher, "live:cursor:move", `{"x":10,"y":20,"laser":true}`)
	assert.JSONEq(t, `{"x":10,"y":20,"laser":true}`, string(readUntil(t, student, "live:cursor:move").Data))

	sendMsg(t, teacher, "live:canvas:draw", `{"path":[[1,2],[3,4]]}`)
	assert.JSONEq(t, `{"path":[[1,2],[3,4]]}`, string(readUntil(t, student, "live:canvas:draw").Data))
	eventually(t, func() bool { w.svc.mu.Lock(); defer w.svc.mu.Unlock(); return len(w.svc.drawings) == 1 })

	sendMsg(t, teacher, "live:mode:switch", `{"mode":"MODULE","moduleId":"`+module.String()+`"}`)
	assert.JSONEq(t, `{"mode":"MODULE","moduleId":"`+module.String()+`"}`, string(readUntil(t, student, "live:mode:switch").Data))
	eventually(t, func() bool { w.svc.mu.Lock(); defer w.svc.mu.Unlock(); return len(w.svc.modes) == 1 })
	assert.Equal(t, []string{"MODULE"}, w.svc.modes)
	assert.Equal(t, &module, w.svc.moduleID)

	sendMsg(t, teacher, "live:terminal:input", `{"terminal":1,"line":"ls -l"}`)
	assert.JSONEq(t, `{"terminal":1,"line":"ls -l"}`, string(readUntil(t, student, "live:terminal:input").Data))
	sendMsg(t, teacher, "live:terminal:sync", `{"terminal":1,"line":"ls -l","output":"total 0","state":{"fs":2}}`)
	assert.JSONEq(t, `{"terminal":1,"line":"ls -l","output":"total 0","state":{"fs":2}}`, string(readUntil(t, student, "live:terminal:sync").Data))
	eventually(t, func() bool {
		w.svc.mu.Lock()
		defer w.svc.mu.Unlock()
		return len(w.svc.syncs) == 1 && len(w.svc.input) >= 1
	})

	nothingMore(t, teacher, "live:slide:change", "live:cursor:move", "live:terminal:sync")
}

// Covers SPEC-051 CA-02 and RN-06: a student cannot control the room, and the attempt is logged.
func TestStudentControlMessagesAreDropped(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	student := w.dial(t, "student")
	readUntil(t, teacher, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, student, "live:slide:change", `{"slide":9}`)
	sendMsg(t, student, "live:terminal:sync", `{"terminal":1,"state":{}}`)
	sendMsg(t, student, "live:cursor:move", `{"x":1,"y":1}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 3 })
	nothingMore(t, teacher, "live:slide:change", "live:terminal:sync", "live:cursor:move")
	assert.Empty(t, w.svc.slides)
	assert.Empty(t, w.svc.syncs)
	entry := w.logs.FilterMessage("classroom message dropped").All()[0].ContextMap()
	assert.Equal(t, "live:slide:change", entry["type"])
	assert.Equal(t, "not-controller", entry["reason"])
	assert.Equal(t, w.student.UserID.String(), entry["userId"])
}

// Covers SPEC-051 CA-08 and CA-09: raising, lowering and moderating the queue, seen by the whole room.
func TestHandRaiseAndModeration(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	student := w.dial(t, "student")
	readUntil(t, teacher, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, student, "live:hand:raise", `{}`)
	for _, c := range []*websocket.Conn{teacher, student} {
		var q struct {
			Queue []map[string]any `json:"queue"`
		}
		require.NoError(t, json.Unmarshal(readUntil(t, c, "live:hand:queue").Data, &q))
		require.Len(t, q.Queue, 1)
		assert.Equal(t, "Ana", q.Queue[0]["name"])
		assert.Equal(t, w.student.UserID.String(), q.Queue[0]["studentId"])
	}
	assert.Equal(t, 1, w.svc.called("raise"))

	sendMsg(t, teacher, "live:hand:moderate", `{"studentId":"`+w.student.UserID.String()+`"}`)
	for _, c := range []*websocket.Conn{teacher, student} {
		var q struct {
			Queue []map[string]any `json:"queue"`
		}
		require.NoError(t, json.Unmarshal(readUntil(t, c, "live:hand:queue").Data, &q))
		assert.Empty(t, q.Queue)
	}
	require.Len(t, w.svc.moderate, 1)
	assert.Equal(t, w.student.UserID, *w.svc.moderate[0])

	sendMsg(t, student, "live:hand:raise", `{}`)
	readUntil(t, teacher, "live:hand:queue")
	sendMsg(t, teacher, "live:hand:moderate", `{"all":true}`)
	readUntil(t, teacher, "live:hand:queue")
	eventually(t, func() bool { w.svc.mu.Lock(); defer w.svc.mu.Unlock(); return len(w.svc.moderate) == 2 })
	assert.Nil(t, w.svc.moderate[1], "no student id lowers every hand")

	sendMsg(t, student, "live:hand:raise", `{}`)
	readUntil(t, teacher, "live:hand:queue")
	sendMsg(t, student, "live:hand:lower", `{}`)
	readUntil(t, teacher, "live:hand:queue")
	assert.Equal(t, 1, w.svc.called("lower"))

	// A student cannot moderate.
	sendMsg(t, student, "live:hand:moderate", `{"all":true}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 1 })
	assert.Len(t, w.svc.moderate, 2)
}

// Covers SPEC-051 CA-11 and RN-06: a second tab of the teacher takes the control and the first one is told.
func TestSecondTeacherTabTakesOver(t *testing.T) {
	w := setup(t)
	first := w.dial(t, "teacher")
	readUntil(t, first, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:snapshot")
	second := w.dial(t, "teacher2")
	readUntil(t, second, "live:snapshot")

	readUntil(t, first, "live:control:revoked")
	sendMsg(t, first, "live:slide:change", `{"slide":8}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 1 })
	assert.Empty(t, w.svc.slides)

	sendMsg(t, second, "live:slide:change", `{"slide":4}`)
	assert.JSONEq(t, `{"slide":4}`, string(readUntil(t, student, "live:slide:change").Data))
	assert.Equal(t, []int{4}, w.svc.slides)
}

// Covers SPEC-051 CA-12: closing the room tells everyone and disconnects.
func TestRoomEndedIsSent(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	student := w.dial(t, "student")
	readUntil(t, teacher, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	w.h.CloseRoom(w.session.ID)
	readUntil(t, student, "live:ended")
	readUntil(t, teacher, "live:ended")
	require.NoError(t, student.SetReadDeadline(time.Now().Add(2*time.Second)))
	var m message
	assert.Error(t, student.ReadJSON(&m))
	eventually(t, func() bool { return !w.h.ControllerConnected(w.session.ID) })
}

// Covers SPEC-051 RN-07, CA-15: the presence is announced, and the teacher leaving is recorded for the safety net.
func TestPresenceAndTeacherLeaving(t *testing.T) {
	w := setup(t)
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	assert.True(t, w.h.ControllerConnected(w.session.ID))

	student := w.dial(t, "student")
	readUntil(t, student, "live:snapshot")
	assert.JSONEq(t, `{"online":1}`, string(readUntil(t, teacher, "live:presence").Data))
	_ = student.Close()
	assert.JSONEq(t, `{"online":0}`, string(readUntil(t, teacher, "live:presence").Data))

	_ = teacher.Close()
	eventually(t, func() bool { return w.svc.called("presence") >= 1 })
	eventually(t, func() bool { return !w.h.ControllerConnected(w.session.ID) })
}

// Covers SPEC-053 CA-13 and section 5: the list of the presentations of the class, without the address to download.
func TestListDecksRoute(t *testing.T) {
	w := setup(t)
	first, second := uuid.New(), uuid.New()
	w.svc.decks = []domain.SlideDeck{
		{Model: database.Model{ID: first, CreatedAt: time.Date(2026, 10, 14, 18, 0, 0, 0, time.UTC)}, Title: "Slides", PageCount: 12, ObjectKey: "classes/x/decks/a.pdf"},
		{Model: database.Model{ID: second, CreatedAt: time.Date(2026, 10, 13, 18, 0, 0, 0, time.UTC)}, Title: "Antiga", PageCount: 3, ObjectKey: "classes/x/decks/b.pdf"},
	}
	code, body := w.call(t, "teacher", http.MethodGet, w.path("/decks"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, w.teacher.UserID, w.svc.actor.UserID)
	decks := body["decks"].([]any)
	require.Len(t, decks, 2)
	head := decks[0].(map[string]any)
	assert.Equal(t, first.String(), head["id"])
	assert.Equal(t, "Slides", head["title"])
	assert.EqualValues(t, 12, head["pageCount"])
	assert.Equal(t, "2026-10-14T18:00:00Z", head["createdAt"])
	assert.NotContains(t, head, "downloadUrl", "the list has no address to download")
	assert.NotContains(t, head, "objectKey")
	assert.Equal(t, second.String(), decks[1].(map[string]any)["id"])

	w.svc.decks = nil
	code, body = w.call(t, "teacher", http.MethodGet, w.path("/decks"), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []any{}, body["decks"], "an empty list, not null")

	w.svc.err = domain.ErrForbidden
	code, body = w.call(t, "student", http.MethodGet, w.path("/decks"), nil)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", body["type"])
	w.svc.err = domain.ErrClassNotFound
	code, body = w.call(t, "teacher", http.MethodGet, w.path("/decks"), nil)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "class-not-found", body["type"])
}
