package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ---- test doubles ----

type fakeRepo struct {
	classes       map[uuid.UUID]service.ClassInfo
	students      map[uuid.UUID]map[uuid.UUID]bool // class -> active students
	studentNames  map[uuid.UUID]string
	classSessions map[uuid.UUID]uuid.UUID // class session -> class
	modules       map[uuid.UUID]bool

	sessions map[uuid.UUID]domain.LiveClassroomSession
	decks    map[uuid.UUID]domain.SlideDeck
	hands    []handRow
	notes    map[[2]uuid.UUID]domain.LiveClassroomNote
	// admissions are the rows of the waiting room, by (session, student) (SPEC-054).
	admissions map[[2]uuid.UUID]*domain.LiveClassroomAdmission

	// race makes the next CreateSession lose to a session that another request just created.
	race bool
}

type handRow struct {
	session, student uuid.UUID
	status           string
	at               time.Time
}

func newRepo() *fakeRepo {
	return &fakeRepo{
		classes: map[uuid.UUID]service.ClassInfo{}, students: map[uuid.UUID]map[uuid.UUID]bool{}, studentNames: map[uuid.UUID]string{},
		classSessions: map[uuid.UUID]uuid.UUID{}, modules: map[uuid.UUID]bool{},
		sessions: map[uuid.UUID]domain.LiveClassroomSession{}, decks: map[uuid.UUID]domain.SlideDeck{},
		notes: map[[2]uuid.UUID]domain.LiveClassroomNote{}, admissions: map[[2]uuid.UUID]*domain.LiveClassroomAdmission{},
	}
}

func (f *fakeRepo) FindClass(_ context.Context, id uuid.UUID) (service.ClassInfo, error) {
	c, ok := f.classes[id]
	if !ok {
		return service.ClassInfo{}, domain.ErrClassNotFound
	}
	return c, nil
}
func (f *fakeRepo) IsActiveStudent(_ context.Context, classID, userID uuid.UUID) (bool, error) {
	return f.students[classID][userID], nil
}
func (f *fakeRepo) ClassSessionBelongsToClass(_ context.Context, id, classID uuid.UUID) (bool, error) {
	c, ok := f.classSessions[id]
	return ok && c == classID, nil
}
func (f *fakeRepo) ModuleExists(_ context.Context, id uuid.UUID) (bool, error) {
	return f.modules[id], nil
}

func (f *fakeRepo) FindActiveSession(_ context.Context, classID uuid.UUID) (domain.LiveClassroomSession, error) {
	for _, s := range f.sessions {
		if s.ClassID == classID && s.IsActive() {
			return s, nil
		}
	}
	return domain.LiveClassroomSession{}, domain.ErrSessionNotFound
}
func (f *fakeRepo) FindSession(_ context.Context, id uuid.UUID) (domain.LiveClassroomSession, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.LiveClassroomSession{}, domain.ErrSessionNotFound
	}
	return s, nil
}
func (f *fakeRepo) CreateSession(_ context.Context, s *domain.LiveClassroomSession) error {
	if f.race {
		f.race = false
		winner := domain.LiveClassroomSession{Model: database.Model{ID: uuid.New()}, ClassID: s.ClassID, TeacherID: s.TeacherID, Title: "winner",
			DisplayMode: domain.ModeSlides, CurrentSlide: 1, Status: domain.StatusActive, StartedAt: s.StartedAt}
		f.sessions[winner.ID] = winner
		return domain.ErrActiveSessionExists
	}
	for _, o := range f.sessions {
		if o.ClassID == s.ClassID && o.IsActive() {
			return domain.ErrActiveSessionExists
		}
	}
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	f.sessions[s.ID] = *s
	return nil
}
func (f *fakeRepo) SaveSession(_ context.Context, s *domain.LiveClassroomSession) error {
	f.sessions[s.ID] = *s
	return nil
}
func (f *fakeRepo) TouchSession(_ context.Context, id uuid.UUID, now time.Time) error {
	s := f.sessions[id]
	s.UpdatedAt = now
	f.sessions[id] = s
	return nil
}
func (f *fakeRepo) ListSessions(_ context.Context, classID uuid.UUID, limit int) ([]domain.LiveClassroomSession, error) {
	var out []domain.LiveClassroomSession
	for _, s := range f.sessions {
		if s.ClassID == classID {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsActive() != out[j].IsActive() {
			return out[i].IsActive()
		}
		return out[i].StartedAt.After(out[j].StartedAt)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
func (f *fakeRepo) ListActiveSessions(_ context.Context) ([]domain.LiveClassroomSession, error) {
	var out []domain.LiveClassroomSession
	for _, s := range f.sessions {
		if s.IsActive() {
			out = append(out, s)
		}
	}
	return out, nil
}
func (f *fakeRepo) SessionsWithNotes(_ context.Context, studentID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	for _, id := range ids {
		if _, ok := f.notes[[2]uuid.UUID{id, studentID}]; ok {
			out[id] = true
		}
	}
	return out, nil
}

func (f *fakeRepo) CountDecks(_ context.Context, classID uuid.UUID) (int64, error) {
	var n int64
	for _, d := range f.decks {
		if d.ClassID == classID {
			n++
		}
	}
	return n, nil
}

// ListDecks lists the decks of the class, newest first (SPEC-053).
func (f *fakeRepo) ListDecks(_ context.Context, classID uuid.UUID) ([]domain.SlideDeck, error) {
	out := []domain.SlideDeck{}
	for _, d := range f.decks {
		if d.ClassID == classID {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (f *fakeRepo) CreateDeck(_ context.Context, d *domain.SlideDeck) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	f.decks[d.ID] = *d
	return nil
}
func (f *fakeRepo) FindDeck(_ context.Context, id uuid.UUID) (domain.SlideDeck, error) {
	d, ok := f.decks[id]
	if !ok {
		return domain.SlideDeck{}, domain.ErrDeckNotFound
	}
	return d, nil
}

func (f *fakeRepo) RaiseHand(_ context.Context, session, student uuid.UUID, now time.Time) error {
	for _, h := range f.hands {
		if h.session == session && h.student == student && h.status == domain.HandPending {
			return nil
		}
	}
	f.hands = append(f.hands, handRow{session, student, domain.HandPending, now})
	return nil
}
func (f *fakeRepo) ListHandRaises(_ context.Context, session uuid.UUID) ([]domain.HandRaiseEntry, error) {
	var out []domain.HandRaiseEntry
	for _, h := range f.hands {
		if h.session == session && h.status == domain.HandPending {
			out = append(out, domain.HandRaiseEntry{StudentID: h.student, Name: f.studentNames[h.student], RequestedAt: h.at})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].RequestedAt.Before(out[j].RequestedAt) })
	return out, nil
}
func (f *fakeRepo) ResolveHand(_ context.Context, session, student uuid.UUID, status string, _ time.Time) error {
	for i, h := range f.hands {
		if h.session == session && h.student == student && h.status == domain.HandPending {
			f.hands[i].status = status
		}
	}
	return nil
}
func (f *fakeRepo) ResolveAllHands(_ context.Context, session uuid.UUID, _ time.Time) error {
	for i, h := range f.hands {
		if h.session == session && h.status == domain.HandPending {
			f.hands[i].status = domain.HandLowered
		}
	}
	return nil
}

func (f *fakeRepo) SaveNote(_ context.Context, session, student uuid.UUID, content string) (domain.LiveClassroomNote, error) {
	n := domain.LiveClassroomNote{SessionID: session, StudentID: student, Content: content}
	f.notes[[2]uuid.UUID{session, student}] = n
	return n, nil
}
func (f *fakeRepo) FindNote(_ context.Context, session, student uuid.UUID) (domain.LiveClassroomNote, error) {
	n, ok := f.notes[[2]uuid.UUID{session, student}]
	if !ok {
		return domain.LiveClassroomNote{}, domain.ErrNotesNotFound
	}
	return n, nil
}

type fakeStorage struct {
	puts []string
	body map[string][]byte
	err  error
}

func (s *fakeStorage) PutObject(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	if s.err != nil {
		return s.err
	}
	b, _ := io.ReadAll(r)
	if s.body == nil {
		s.body = map[string][]byte{}
	}
	s.body[key] = b
	s.puts = append(s.puts, key)
	return nil
}
func (s *fakeStorage) PresignedGetURL(_ context.Context, key string, ttl time.Duration) (string, error) {
	return fmt.Sprintf("https://files.test/%s?ttl=%d", key, int(ttl.Seconds())), nil
}

type world struct {
	svc              *service.Service
	repo             *fakeRepo
	store            *fakeStorage
	now              time.Time
	class, archived  uuid.UUID
	teacher, other   service.Actor
	admin            service.Actor
	student, outside service.Actor
	ended            []uuid.UUID
}

func setup(t *testing.T) *world {
	t.Helper()
	w := &world{repo: newRepo(), store: &fakeStorage{}, now: time.Date(2026, 10, 14, 3, 17, 0, 0, time.UTC)}
	w.teacher = service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	w.other = service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	w.admin = service.Actor{UserID: uuid.New(), Role: authn.RoleAdmin}
	w.student = service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.outside = service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.class, w.archived = uuid.New(), uuid.New()
	w.repo.classes[w.class] = service.ClassInfo{ID: w.class, TeacherID: w.teacher.UserID}
	w.repo.classes[w.archived] = service.ClassInfo{ID: w.archived, TeacherID: w.teacher.UserID, Archived: true}
	w.repo.students[w.class] = map[uuid.UUID]bool{w.student.UserID: true}
	w.repo.studentNames[w.student.UserID] = "Ana"
	w.svc = service.New(w.repo, w.store, func() time.Time { return w.now }).WithOnEnded(func(id uuid.UUID) { w.ended = append(w.ended, id) })
	return w
}

func (w *world) start(t *testing.T) domain.LiveClassroomSession {
	t.Helper()
	s, _, err := w.svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "Aula"})
	require.NoError(t, err)
	return s
}

func pdfBytes() []byte { return append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte("x"), 100)...) }

// ---- tests ----

// Covers SPEC-051 CA-01 and RN-01: the owner starts the room; an administrator too.
func TestStartSession_OwnerAndAdminAllowed(t *testing.T) {
	w := setup(t)
	s, created, err := w.svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "  Processos  "})
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, "Processos", s.Title)
	assert.Equal(t, domain.StatusActive, s.Status)
	assert.Equal(t, domain.ModeSlides, s.DisplayMode)
	assert.Equal(t, 1, s.CurrentSlide)
	assert.Equal(t, w.teacher.UserID, s.TeacherID)
	assert.Equal(t, w.now, s.StartedAt)

	other := uuid.New()
	w.repo.classes[other] = service.ClassInfo{ID: other, TeacherID: w.other.UserID}
	_, created, err = w.svc.StartSession(context.Background(), w.admin, other, service.StartInput{Title: "Admin"})
	require.NoError(t, err)
	assert.True(t, created)
}

// Covers SPEC-051 CA-01: the room does not depend on the hour of the schedule.
func TestStartSession_AnyTimeOfDay(t *testing.T) {
	for _, hour := range []int{0, 3, 12, 23} {
		w := setup(t)
		w.now = time.Date(2026, 12, 25, hour, 5, 0, 0, time.UTC) // a holiday, with no lesson in the agenda
		_, created, err := w.svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "Aula extra"})
		require.NoError(t, err, "hour %d", hour)
		assert.True(t, created)
	}
}

// Covers SPEC-051 CA-02: who cannot start a room, and the title rule.
func TestStartSession_RejectsNonOwner(t *testing.T) {
	w := setup(t)
	for _, who := range []service.Actor{w.other, w.student, w.outside} {
		_, _, err := w.svc.StartSession(context.Background(), who, w.class, service.StartInput{Title: "x"})
		assert.ErrorIs(t, err, domain.ErrForbidden)
	}
	_, _, err := w.svc.StartSession(context.Background(), w.teacher, uuid.New(), service.StartInput{Title: "x"})
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	_, _, err = w.svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "  "})
	assert.ErrorIs(t, err, domain.ErrInvalidTitle)
	assert.Empty(t, w.repo.sessions)
}

// Covers SPEC-051 CA-16: an archived class takes no room.
func TestStartSession_ArchivedClass(t *testing.T) {
	w := setup(t)
	_, _, err := w.svc.StartSession(context.Background(), w.teacher, w.archived, service.StartInput{Title: "x"})
	assert.ErrorIs(t, err, domain.ErrClassArchived)
}

// Covers SPEC-051 CA-17 and RN-01: a second start gives back the room that is open, whatever the title.
func TestStartSession_ReturnsTheActiveOne(t *testing.T) {
	w := setup(t)
	first := w.start(t)
	again, created, err := w.svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "Outro título"})
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, first.ID, again.ID)
	assert.Equal(t, "Aula", again.Title)
	assert.Len(t, w.repo.sessions, 1)
}

// Covers SPEC-051 CA-17 and RN-01: two starts at the same time end with a single room (the loser gets the winner).
func TestStartSession_Concurrent(t *testing.T) {
	w := setup(t)
	w.repo.race = true
	s, created, err := w.svc.StartSession(context.Background(), w.teacher, w.class, service.StartInput{Title: "perdedor"})
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, "winner", s.Title)
	assert.Len(t, w.repo.sessions, 1)
}

// Covers SPEC-051 CA-20 and RN-04: the links of the room must belong to the class.
func TestStartSession_RejectsForeignLinks(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	otherClass := uuid.New()
	w.repo.classes[otherClass] = service.ClassInfo{ID: otherClass, TeacherID: w.teacher.UserID}
	foreignDeck := domain.SlideDeck{Model: database.Model{ID: uuid.New()}, ClassID: otherClass, PageCount: 3}
	w.repo.decks[foreignDeck.ID] = foreignDeck
	foreignLesson := uuid.New()
	w.repo.classSessions[foreignLesson] = otherClass
	ghost := uuid.New()

	_, _, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "x", DeckID: &foreignDeck.ID})
	assert.ErrorIs(t, err, domain.ErrDeckNotFound)
	_, _, err = w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "x", DeckID: &ghost})
	assert.ErrorIs(t, err, domain.ErrDeckNotFound)
	_, _, err = w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "x", ClassSessionID: &foreignLesson})
	assert.ErrorIs(t, err, domain.ErrClassSessionNotFound)
	_, _, err = w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "x", InitialModuleID: &ghost})
	assert.ErrorIs(t, err, domain.ErrModuleNotFound)
	assert.Empty(t, w.repo.sessions)

	// And what belongs to the class is linked; a module start opens in the module mode.
	deck := domain.SlideDeck{Model: database.Model{ID: uuid.New()}, ClassID: w.class, PageCount: 5}
	w.repo.decks[deck.ID] = deck
	lesson := uuid.New()
	w.repo.classSessions[lesson] = w.class
	module := uuid.New()
	w.repo.modules[module] = true
	s, _, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "x", DeckID: &deck.ID, ClassSessionID: &lesson, InitialModuleID: &module})
	require.NoError(t, err)
	assert.Equal(t, &deck.ID, s.DeckID)
	assert.Equal(t, &lesson, s.ClassSessionID)
	assert.Equal(t, &module, s.ActiveModuleID)
	assert.Equal(t, domain.ModeModule, s.DisplayMode)
}

// Covers SPEC-051 CA-03, CA-04 and RN-04: the deck goes to the storage, with a signed address of 15 minutes, up to 100 per class
// (SPEC-053 RN-07).
func TestUploadDeck_SuccessAndMaxLimit(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	view, err := w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: " Slides ", PageCount: 12, Size: 109, File: bytes.NewReader(pdfBytes())})
	require.NoError(t, err)
	assert.Equal(t, "Slides", view.Deck.Title)
	assert.Equal(t, 12, view.Deck.PageCount)
	assert.Equal(t, w.teacher.UserID, view.Deck.UploadedBy)
	assert.True(t, strings.HasPrefix(view.Deck.ObjectKey, "classes/"+w.class.String()+"/decks/"), view.Deck.ObjectKey)
	assert.True(t, strings.HasSuffix(view.Deck.ObjectKey, ".pdf"))
	assert.Contains(t, view.DownloadURL, "ttl=900")
	require.Len(t, w.store.puts, 1)
	assert.Equal(t, pdfBytes(), w.store.body[view.Deck.ObjectKey], "the whole file was stored")

	for i := 1; i < domain.MaxDecksPerClass; i++ {
		_, err := w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 1, Size: 109, File: bytes.NewReader(pdfBytes())})
		require.NoError(t, err)
	}
	_, err = w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 1, Size: 109, File: bytes.NewReader(pdfBytes())})
	assert.ErrorIs(t, err, domain.ErrDeckLimit, "the 101st")
	assert.Len(t, w.store.puts, 100, "nothing stored for the refused one")
	assert.Equal(t, 100, domain.MaxDecksPerClass)
}

// Covers SPEC-051 CA-02 and section 5.3: who may upload and what the server checks.
func TestUploadDeck_Rules(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	ok := service.UploadInput{Title: "d", PageCount: 3, Size: 109, File: bytes.NewReader(pdfBytes())}
	_, err := w.svc.UploadDeck(ctx, w.student, w.class, ok)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.UploadDeck(ctx, w.other, w.class, ok)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.UploadDeck(ctx, w.teacher, uuid.New(), ok)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)

	_, err = w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 3, Size: 20, File: strings.NewReader("GIF89a not a pdf")})
	assert.ErrorIs(t, err, domain.ErrInvalidPDF)
	_, err = w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 0, Size: 109, File: bytes.NewReader(pdfBytes())})
	assert.ErrorIs(t, err, domain.ErrInvalidPDF)
	_, err = w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 3, Size: domain.MaxDeckBytes + 1, File: bytes.NewReader(pdfBytes())})
	assert.ErrorIs(t, err, domain.ErrFileTooLarge)
	_, err = w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "", PageCount: 3, Size: 109, File: bytes.NewReader(pdfBytes())})
	assert.ErrorIs(t, err, domain.ErrInvalidTitle)
	assert.Empty(t, w.repo.decks)
	assert.Empty(t, w.store.puts)

	w.store.err = errors.New("storage down")
	_, err = w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 3, Size: 109, File: bytes.NewReader(pdfBytes())})
	assert.EqualError(t, err, "storage down")
	assert.Empty(t, w.repo.decks, "no record without the file")
}

// Covers SPEC-051 CA-12 and RN-02: ending records the end, tells the hub, and is final.
func TestEndSession_UpdatesTimestampAndClosesRoom(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.now = w.now.Add(70 * time.Minute)

	_, err := w.svc.EndSession(ctx, w.other, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.EndSession(ctx, w.student, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)

	ended, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.StatusFinished, ended.Status)
	require.NotNil(t, ended.EndedAt)
	assert.Equal(t, w.now, *ended.EndedAt)
	assert.Equal(t, []uuid.UUID{s.ID}, w.ended, "the hub is told to close the room")

	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "already ended")
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, uuid.New())
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)

	// Ending is final: a new start is another room.
	again, created, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "Segunda"})
	require.NoError(t, err)
	assert.True(t, created)
	assert.NotEqual(t, s.ID, again.ID)
}

// A session of another class is not found through this class.
func TestEndSession_OfAnotherClass(t *testing.T) {
	w := setup(t)
	s := w.start(t)
	otherClass := uuid.New()
	w.repo.classes[otherClass] = service.ClassInfo{ID: otherClass, TeacherID: w.teacher.UserID}
	_, err := w.svc.EndSession(context.Background(), w.teacher, otherClass, s.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
}

// Covers SPEC-051 CA-15 and RN-02: the teacher leaves and comes back and finds the same room, still open.
func TestTeacherCanLeaveAndComeBack(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	for i := 0; i < 3; i++ {
		w.now = w.now.Add(2 * time.Hour)
		require.NoError(t, w.svc.TeacherPresence(ctx, s.ID))
		again, created, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "volta"})
		require.NoError(t, err)
		assert.False(t, created)
		assert.Equal(t, s.ID, again.ID)
		assert.True(t, again.IsActive())
	}
}

// Covers SPEC-051 CA-15 and RN-03: a room without the teacher for 12 hours is ended; the others are not.
func TestSafetyNetEndsAfter12Hours(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	mk := func(class uuid.UUID, idle time.Duration) uuid.UUID {
		s := domain.LiveClassroomSession{Model: database.Model{ID: uuid.New(), UpdatedAt: w.now.Add(-idle)}, ClassID: class, TeacherID: w.teacher.UserID,
			Title: "x", DisplayMode: domain.ModeSlides, CurrentSlide: 1, Status: domain.StatusActive, StartedAt: w.now.Add(-idle)}
		w.repo.sessions[s.ID] = s
		return s.ID
	}
	classB, classC := uuid.New(), uuid.New()
	abandoned := mk(w.class, 13*time.Hour)
	recent := mk(classB, 11*time.Hour)
	connected := mk(classC, 13*time.Hour)

	n, err := w.svc.EndAbandoned(ctx, func(id uuid.UUID) bool { return id == connected })
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Equal(t, domain.StatusFinished, w.repo.sessions[abandoned].Status)
	assert.Equal(t, domain.StatusActive, w.repo.sessions[recent].Status)
	assert.Equal(t, domain.StatusActive, w.repo.sessions[connected].Status, "the teacher is there")
	assert.Equal(t, []uuid.UUID{abandoned}, w.ended)

	w.now = w.now.Add(2 * time.Hour) // the recent one is now idle for 13 hours
	n, err = w.svc.EndAbandoned(ctx, func(uuid.UUID) bool { return false })
	require.NoError(t, err)
	assert.Equal(t, 2, n, "the recent one and the one that was connected, now without the teacher")
}

// Covers SPEC-051 CA-14 and RN-07: the state of a room for who comes in, or comes back.
func TestActiveSession_ReturnsSnapshot(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	none, err := w.svc.GetActive(ctx, w.student, w.class)
	require.NoError(t, err)
	assert.False(t, none.Found)

	upload, err := w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 10, Size: 109, File: bytes.NewReader(pdfBytes())})
	require.NoError(t, err)
	s, _, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "Aula", DeckID: &upload.Deck.ID})
	require.NoError(t, err)
	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 4))
	w.svc.RememberDrawing(s.ID, json.RawMessage(`{"path":[1,2]}`))
	w.svc.SetTerminalBroadcast(s.ID, true)
	w.svc.RememberTerminalInput(s.ID, json.RawMessage(`{"line":"ls -"}`))
	w.svc.RememberTerminalSync(s.ID, json.RawMessage(`{"terminal":1,"line":"ls","output":"a b","state":{"fs":1}}`))
	w.admit(s.ID, w.student.UserID)
	_, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID)
	require.NoError(t, err)

	for _, who := range []service.Actor{w.student, w.teacher, w.admin} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		require.True(t, a.Found)
		assert.Equal(t, s.ID, a.Session.ID)
		assert.Equal(t, 4, a.Session.CurrentSlide)
		require.NotNil(t, a.Deck)
		assert.Contains(t, a.Deck.DownloadURL, "ttl=900", "a renewed address each time")
		assert.Len(t, a.Drawings, 1)
		assert.JSONEq(t, `{"line":"ls -"}`, string(a.Terminal.Input))
		require.Len(t, a.Terminal.Entries, 1)
		assert.JSONEq(t, `{"fs":1}`, string(a.Terminal.State))
		require.Len(t, a.HandRaises, 1)
		assert.Equal(t, "Ana", a.HandRaises[0].Name)
	}

	_, err = w.svc.GetActive(ctx, w.outside, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.GetActive(ctx, w.other, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.GetActive(ctx, w.student, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
}

// Covers SPEC-051 CA-14 and RN-07: the snapshot keeps the last 200 terminal entries and clears the strokes of the slide that was left.
func TestSnapshotKeepsTheTerminalHistoryAndClearsStrokes(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.svc.SetTerminalBroadcast(s.ID, true)
	for i := 1; i <= 250; i++ {
		w.svc.RememberTerminalSync(s.ID, json.RawMessage(fmt.Sprintf(`{"terminal":1,"line":"cmd %d","state":{"n":%d}}`, i, i)))
	}
	w.svc.RememberDrawing(s.ID, json.RawMessage(`{"path":[1]}`))
	w.svc.RememberDrawing(s.ID, json.RawMessage(`{"path":[2]}`))

	snap, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, snap.Terminal.Entries, 200)
	assert.Contains(t, string(snap.Terminal.Entries[199]), "cmd 250")
	assert.Contains(t, string(snap.Terminal.Entries[0]), "cmd 51")
	assert.JSONEq(t, `{"n":250}`, string(snap.Terminal.State))
	assert.Len(t, snap.Drawings, 2)

	w.svc.RememberDrawing(s.ID, json.RawMessage(`{"clear":true}`))
	snap, _ = w.svc.Snapshot(ctx, s.ID)
	assert.Empty(t, snap.Drawings, "a clear message empties the strokes")

	w.svc.RememberDrawing(s.ID, json.RawMessage(`{"path":[3]}`))
	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 2))
	snap, _ = w.svc.Snapshot(ctx, s.ID)
	assert.Empty(t, snap.Drawings, "changing the slide empties the strokes")
	assert.Equal(t, 2, snap.Session.CurrentSlide)
}

// Covers SPEC-051 CA-05 and CA-07: the canonical state (slide, mode, module) is saved, with its rules.
func TestChangeSlideAndSwitchMode(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	deck, err := w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "d", PageCount: 5, Size: 109, File: bytes.NewReader(pdfBytes())})
	require.NoError(t, err)
	s, _, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "Aula", DeckID: &deck.Deck.ID})
	require.NoError(t, err)

	require.NoError(t, w.svc.ChangeSlide(ctx, s.ID, 5))
	assert.Equal(t, 5, w.repo.sessions[s.ID].CurrentSlide)
	assert.ErrorIs(t, w.svc.ChangeSlide(ctx, s.ID, 6), domain.ErrInvalidSlide, "past the last page")
	assert.ErrorIs(t, w.svc.ChangeSlide(ctx, s.ID, 0), domain.ErrInvalidSlide)

	module := uuid.New()
	w.repo.modules[module] = true
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module))
	assert.Equal(t, domain.ModeModule, w.repo.sessions[s.ID].DisplayMode)
	assert.Equal(t, &module, w.repo.sessions[s.ID].ActiveModuleID)
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	assert.Equal(t, domain.ModeSlides, w.repo.sessions[s.ID].DisplayMode)
	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, "VIDEO", nil), domain.ErrInvalidMode)
	ghost := uuid.New()
	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &ghost), domain.ErrModuleNotFound)
	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, nil), domain.ErrModuleNotFound, "the module mode needs a module")

	w.now = w.now.Add(time.Hour)
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	assert.ErrorIs(t, w.svc.ChangeSlide(ctx, s.ID, 1), domain.ErrSessionNotFound, "a closed room takes no more changes")
}

// Covers SPEC-051 CA-14: who may connect to the realtime channel, and as what.
func TestConnect(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	_, err := w.svc.Connect(ctx, w.teacher, w.class)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "no room open")
	s := w.start(t)

	c, err := w.svc.Connect(ctx, w.teacher, w.class)
	require.NoError(t, err)
	assert.True(t, c.Controller)
	assert.Equal(t, s.ID, c.Session.ID)
	c, err = w.svc.Connect(ctx, w.admin, w.class)
	require.NoError(t, err)
	assert.True(t, c.Controller)
	c, err = w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)
	assert.False(t, c.Controller)
	assert.Equal(t, domain.AdmissionWaiting, c.Admission, "a student comes in waiting (SPEC-054 RN-01)")

	for _, who := range []service.Actor{w.other, w.outside} {
		_, err = w.svc.Connect(ctx, who, w.class)
		assert.ErrorIs(t, err, domain.ErrForbidden)
	}
}

// Covers SPEC-051 CA-08 and CA-09: the queue of raised hands is FIFO, with no duplicates, and the teacher moderates it.
func TestHandRaiseQueueAndModeration(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	second := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	third := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.repo.studentNames[second.UserID] = "Bruno"
	w.repo.studentNames[third.UserID] = "Carla"
	w.admit(s.ID, w.student.UserID, second.UserID, third.UserID)

	names := func(q []domain.HandRaiseEntry) []string {
		out := make([]string, len(q))
		for i, e := range q {
			out[i] = e.Name
		}
		return out
	}
	q, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID)
	require.NoError(t, err)
	w.now = w.now.Add(time.Second)
	_, err = w.svc.RaiseHand(ctx, s.ID, second.UserID)
	require.NoError(t, err)
	w.now = w.now.Add(time.Second)
	q, err = w.svc.RaiseHand(ctx, s.ID, third.UserID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana", "Bruno", "Carla"}, names(q), "first in, first served")

	q, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID)
	require.NoError(t, err)
	assert.Len(t, q, 3, "raising twice does not duplicate")

	q, err = w.svc.LowerHand(ctx, s.ID, second.UserID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana", "Carla"}, names(q), "a student takes back his own hand")

	q, err = w.svc.ModerateHand(ctx, s.ID, &w.student.UserID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Carla"}, names(q), "the teacher answers one")
	for _, h := range w.repo.hands {
		if h.student == w.student.UserID {
			assert.Equal(t, domain.HandAnswered, h.status)
		}
		if h.student == second.UserID {
			assert.Equal(t, domain.HandLowered, h.status)
		}
	}

	q, err = w.svc.ModerateHand(ctx, s.ID, nil)
	require.NoError(t, err)
	assert.Empty(t, q, "no id lowers every hand")
	assert.Equal(t, domain.HandLowered, w.repo.hands[2].status)
}

// Covers SPEC-051 CA-09 and CA-10: the notes are private to each student and readable after the class; the teacher does not read them.
func TestStudentNotes_SaveAndRetrieve(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)

	n, err := w.svc.SaveNote(ctx, w.student, w.class, s.ID, "processos e threads")
	require.NoError(t, err)
	assert.Equal(t, "processos e threads", n.Content)
	got, err := w.svc.GetNote(ctx, w.student, w.class, s.ID)
	require.NoError(t, err)
	assert.Equal(t, "processos e threads", got.Content)

	// Another student of the class has his own notebook.
	friend := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.repo.students[w.class][friend.UserID] = true
	w.admit(s.ID, friend.UserID)
	_, err = w.svc.GetNote(ctx, friend, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrNotesNotFound)
	_, err = w.svc.SaveNote(ctx, friend, w.class, s.ID, "do amigo")
	require.NoError(t, err)
	got, _ = w.svc.GetNote(ctx, w.student, w.class, s.ID)
	assert.Equal(t, "processos e threads", got.Content)

	// After the class.
	w.now = w.now.Add(time.Hour)
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	got, err = w.svc.GetNote(ctx, w.student, w.class, s.ID)
	require.NoError(t, err)
	assert.Equal(t, "processos e threads", got.Content)

	// Who may not.
	_, err = w.svc.GetNote(ctx, w.teacher, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "the teacher does not read the notes")
	_, err = w.svc.SaveNote(ctx, w.teacher, w.class, s.ID, "x")
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.SaveNote(ctx, w.outside, w.class, s.ID, "x")
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.SaveNote(ctx, w.student, w.class, s.ID, strings.Repeat("a", 20001))
	assert.ErrorIs(t, err, domain.ErrContentTooLong)
	_, err = w.svc.SaveNote(ctx, w.student, w.class, uuid.New(), "x")
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
	otherClass := uuid.New()
	w.repo.classes[otherClass] = service.ClassInfo{ID: otherClass, TeacherID: w.teacher.UserID}
	w.repo.students[otherClass] = map[uuid.UUID]bool{w.student.UserID: true}
	_, err = w.svc.SaveNote(ctx, w.student, otherClass, s.ID, "x")
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a room of another class is not found through this one")
}

// Covers SPEC-051 CA-18 and section 5.5: the rooms of the class, the open one first, with their details.
func TestListSessions_ActiveFirstAndDetails(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	first := w.start(t)
	w.now = w.now.Add(90 * time.Minute)
	_, err := w.svc.EndSession(ctx, w.teacher, w.class, first.ID)
	require.NoError(t, err)
	w.now = w.now.Add(24 * time.Hour)
	second := w.start(t)
	w.now = w.now.Add(30 * time.Minute)
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, second.ID)
	require.NoError(t, err)
	w.now = w.now.Add(time.Hour)
	third := w.start(t)
	_, err = w.svc.SaveNote(ctx, w.student, w.class, first.ID, "notas")
	require.NoError(t, err)

	list, err := w.svc.ListSessions(ctx, w.student, w.class)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, third.ID, list[0].Session.ID, "the open one first")
	assert.Equal(t, second.ID, list[1].Session.ID, "then the newest ended")
	assert.Equal(t, first.ID, list[2].Session.ID)
	assert.Equal(t, 30, list[1].DurationMinutes)
	assert.Equal(t, 90, list[2].DurationMinutes)
	assert.True(t, list[2].HasNotes)
	assert.False(t, list[1].HasNotes)

	forTeacher, err := w.svc.ListSessions(ctx, w.teacher, w.class)
	require.NoError(t, err)
	assert.Len(t, forTeacher, 3)
	assert.False(t, forTeacher[2].HasNotes, "the teacher is told nothing about notes")

	_, err = w.svc.ListSessions(ctx, w.outside, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.ListSessions(ctx, w.other, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.ListSessions(ctx, w.teacher, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
}

// Covers SPEC-053 RN-04 and RN-06: a presentation of the class, with a signed address of 15 minutes; one of another class is not found.
func TestDeckOfClass(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	view, err := w.svc.UploadDeck(ctx, w.teacher, w.class, service.UploadInput{Title: "Slides", PageCount: 5, Size: 109, File: bytes.NewReader(pdfBytes())})
	require.NoError(t, err)

	got, err := w.svc.DeckOfClass(ctx, w.class, view.Deck.ID)
	require.NoError(t, err)
	assert.Equal(t, "Slides", got.Deck.Title)
	assert.Equal(t, 5, got.Deck.PageCount)
	assert.Contains(t, got.DownloadURL, "ttl=900")

	_, err = w.svc.DeckOfClass(ctx, uuid.New(), view.Deck.ID)
	assert.ErrorIs(t, err, domain.ErrDeckNotFound, "a deck of another class")
	_, err = w.svc.DeckOfClass(ctx, w.class, uuid.New())
	assert.ErrorIs(t, err, domain.ErrDeckNotFound, "a deck that does not exist")
}

// Covers SPEC-053 CA-13: the owner teacher and an administrator list the presentations of the class, newest first; nobody else does.
func TestListDecks(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	addDeck := func(class uuid.UUID, title string, at time.Time) domain.SlideDeck {
		d := domain.SlideDeck{ClassID: class, UploadedBy: w.teacher.UserID, Title: title, PageCount: 3, ObjectKey: "k/" + title + ".pdf"}
		d.ID, d.CreatedAt = uuid.New(), at
		require.NoError(t, w.repo.CreateDeck(ctx, &d))
		return d
	}
	addDeck(w.class, "primeira", w.now.Add(-48*time.Hour))
	addDeck(w.class, "terceira", w.now)
	addDeck(w.class, "segunda", w.now.Add(-24*time.Hour))
	elsewhere := uuid.New()
	w.repo.classes[elsewhere] = service.ClassInfo{ID: elsewhere, TeacherID: w.teacher.UserID}
	addDeck(elsewhere, "de outra turma", w.now)

	for _, actor := range []service.Actor{w.teacher, w.admin} {
		list, err := w.svc.ListDecks(ctx, actor, w.class)
		require.NoError(t, err)
		require.Len(t, list, 3)
		assert.Equal(t, []string{"terceira", "segunda", "primeira"}, []string{list[0].Title, list[1].Title, list[2].Title})
	}

	_, err := w.svc.ListDecks(ctx, w.other, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a teacher of another class")
	_, err = w.svc.ListDecks(ctx, w.student, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a student")
	_, err = w.svc.ListDecks(ctx, w.teacher, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)

	empty := uuid.New()
	w.repo.classes[empty] = service.ClassInfo{ID: empty, TeacherID: w.teacher.UserID}
	list, err := w.svc.ListDecks(ctx, w.teacher, empty)
	require.NoError(t, err)
	assert.Empty(t, list)
}
