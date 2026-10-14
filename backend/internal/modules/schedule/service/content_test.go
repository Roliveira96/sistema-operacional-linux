package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// fakeDecks answers for the presentations of the classes, like the classroom service does.
type fakeDecks struct {
	decks map[uuid.UUID]struct {
		class uuid.UUID
		deck  service.Deck
	}
}

func (d fakeDecks) Deck(_ context.Context, classID, deckID uuid.UUID) (service.Deck, error) {
	found, ok := d.decks[deckID]
	if !ok || found.class != classID {
		return service.Deck{}, domain.ErrDeckNotFound
	}
	return found.deck, nil
}

// fakeModules answers for the teaching modules; a hidden one is refused to students, like the course module service does.
type fakeModules struct {
	titles map[uuid.UUID]string
	hidden map[uuid.UUID]bool
}

func (m fakeModules) Module(_ context.Context, actor service.Actor, id uuid.UUID) (service.Module, error) {
	title, ok := m.titles[id]
	if !ok || (m.hidden[id] && actor.Role == authn.RoleStudent) {
		return service.Module{}, domain.ErrModuleNotFound
	}
	return service.Module{ID: id, Title: title}, nil
}

type contentFixture struct {
	*fixture
	sessions []domain.ClassSession
	deck     uuid.UUID
	module   uuid.UUID
	admin    service.Actor
	student  service.Actor
}

func newContentFixture(t *testing.T) *contentFixture {
	t.Helper()
	f := newFixture(t)
	c := &contentFixture{fixture: f, sessions: f.setup(t), deck: uuid.New(), module: uuid.New()}
	c.admin = service.Actor{UserID: uuid.New(), Role: authn.RoleAdmin}
	c.student = service.Actor{UserID: f.ana.UserID, Role: authn.RoleStudent}
	decks := fakeDecks{decks: map[uuid.UUID]struct {
		class uuid.UUID
		deck  service.Deck
	}{
		c.deck: {class: f.class.ID, deck: service.Deck{ID: c.deck, Title: "Slides da aula", PageCount: 12, DownloadURL: "https://files.example/deck.pdf?ttl=900"}},
	}}
	modules := fakeModules{titles: map[uuid.UUID]string{c.module: "Permissões"}, hidden: map[uuid.UUID]bool{}}
	f.svc.WithContentRefs(decks, modules)
	return c
}

func (c *contentFixture) full() service.ContentInput {
	return service.ContentInput{
		Topic:       "  Permissões de arquivos  ",
		Description: "<p>Veremos <strong>chmod</strong>.</p>",
		ModuleID:    &c.module,
		DeckID:      &c.deck,
		Links: []domain.LinkInput{
			{Name: "Meet", URL: "https://meet.google.com/abc"},
			{Name: "Vídeo", URL: "https://example.com/video"},
		},
	}
}

// Covers SPEC-053 CA-01 and RN-01, RN-02: the owner teacher and an administrator save the content of a lesson.
func TestSaveContent_OwnerAndAdmin(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	got, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, c.sessions[0].ID, c.full())
	require.NoError(t, err)
	assert.Equal(t, "Permissões de arquivos", got.Topic)
	assert.Contains(t, got.Description, "<strong>chmod</strong>")
	require.NotNil(t, got.Module)
	assert.Equal(t, "Permissões", got.Module.Title)
	require.NotNil(t, got.Deck)
	assert.Equal(t, 12, got.Deck.PageCount)
	require.Len(t, got.Links, 2)
	assert.Equal(t, []string{"Meet", "Vídeo"}, []string{got.Links[0].Name, got.Links[1].Name})

	stored := c.repo.sessions[c.sessions[0].ID]
	require.NotNil(t, stored.Topic)
	assert.Equal(t, "Permissões de arquivos", *stored.Topic)
	assert.True(t, stored.HasContent)
	assert.Equal(t, &c.deck, stored.DeckID)
	assert.Equal(t, &c.module, stored.ModuleID)
	assert.Len(t, c.repo.links[stored.ID], 2)

	// An administrator saves in any class and replaces the content as a whole.
	got, err = c.svc.SaveContent(ctx, c.admin, c.class.ID, c.sessions[0].ID, service.ContentInput{Topic: "Outro tema"})
	require.NoError(t, err)
	assert.Equal(t, "Outro tema", got.Topic)
	assert.Nil(t, got.Deck)
	assert.Empty(t, got.Links)
	assert.Empty(t, c.repo.links[c.sessions[0].ID], "the links of before are replaced")
}

// Covers SPEC-053 CA-01: each date has its own content.
func TestSaveContent_OnlyThatSession(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	_, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, c.sessions[0].ID, c.full())
	require.NoError(t, err)
	_, err = c.svc.SaveContent(ctx, c.teacher, c.class.ID, c.sessions[1].ID, service.ContentInput{Topic: "Processos"})
	require.NoError(t, err)

	first, second, third := c.repo.sessions[c.sessions[0].ID], c.repo.sessions[c.sessions[1].ID], c.repo.sessions[c.sessions[2].ID]
	assert.Equal(t, "Permissões de arquivos", *first.Topic)
	assert.Equal(t, "Processos", *second.Topic)
	assert.Nil(t, second.DeckID)
	assert.False(t, third.HasContent, "the other lessons are untouched")
	assert.Nil(t, third.Topic)
}

// Covers SPEC-053 CA-02 and RN-03: saving the content is not changing the lesson: no change mark, no reason, no e-mail.
func TestSaveContent_DoesNotMarkAsChangedNorMail(t *testing.T) {
	c := newContentFixture(t)
	before := c.repo.sessions[c.sessions[0].ID]
	require.False(t, before.Overridden)
	_, err := c.svc.SaveContent(context.Background(), c.teacher, c.class.ID, before.ID, c.full())
	require.NoError(t, err)

	after := c.repo.sessions[before.ID]
	assert.False(t, after.Overridden)
	assert.Nil(t, after.ChangeReason)
	assert.Equal(t, before.Status, after.Status)
	assert.Equal(t, before.StartTime, after.StartTime)
	assert.Empty(t, c.repo.outbox, "no e-mail")
}

// Covers SPEC-053 RN-02: the content of a canceled lesson and of a lesson in the past can be saved too.
func TestSaveContent_CanceledAndPastLessons(t *testing.T) {
	c := newContentFixture(t)
	canceled := c.repo.sessions[c.sessions[0].ID]
	canceled.Status = domain.SessionCanceled
	c.repo.sessions[canceled.ID] = canceled
	_, err := c.svc.SaveContent(context.Background(), c.teacher, c.class.ID, canceled.ID, service.ContentInput{Topic: "Cancelada"})
	assert.NoError(t, err)

	past := c.repo.sessions[c.sessions[1].ID]
	past.Date = day(2026, 10, 5)
	c.repo.sessions[past.ID] = past
	_, err = c.svc.SaveContent(context.Background(), c.teacher, c.class.ID, past.ID, service.ContentInput{Topic: "Passada"})
	assert.NoError(t, err)
}

// Covers SPEC-053 CA-03: a bad topic, link or description saves nothing.
func TestSaveContent_Invalid(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	id := c.sessions[0].ID
	elevenLinks := make([]domain.LinkInput, 11)
	for i := range elevenLinks {
		elevenLinks[i] = domain.LinkInput{Name: "l", URL: "https://a.com"}
	}
	cases := []struct {
		name  string
		in    service.ContentInput
		err   error
		field string
	}{
		{"long topic", service.ContentInput{Topic: strings.Repeat("a", 121)}, domain.ErrInvalidSessionContent, "topic"},
		{"http link", service.ContentInput{Links: []domain.LinkInput{{Name: "x", URL: "http://a.com"}}}, domain.ErrInvalidSessionContent, "links[0].url"},
		{"too many links", service.ContentInput{Links: elevenLinks}, domain.ErrInvalidSessionContent, "links"},
		{"long description", service.ContentInput{Description: "<p>" + strings.Repeat("a", 20001) + "</p>"}, domain.ErrContentTooLong, "description"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, id, tc.in)
			require.ErrorIs(t, err, tc.err)
			assert.Equal(t, tc.field, contentField(err))
			assert.False(t, c.repo.sessions[id].HasContent, "nothing was saved")
			assert.Empty(t, c.repo.links[id])
		})
	}
}

func contentField(err error) string {
	var fe *domain.FieldError
	if errors.As(err, &fe) {
		return fe.Field
	}
	return ""
}

// Covers SPEC-053 RN-01: the description goes through the same filter as the syllabus.
func TestSaveContent_SanitizesTheDescription(t *testing.T) {
	c := newContentFixture(t)
	got, err := c.svc.SaveContent(context.Background(), c.teacher, c.class.ID, c.sessions[0].ID,
		service.ContentInput{Description: `<p onclick="x()">Texto</p><script>alert(1)</script>`})
	require.NoError(t, err)
	assert.Contains(t, got.Description, "Texto")
	assert.NotContains(t, got.Description, "script")
	assert.NotContains(t, got.Description, "onclick")
}

// Covers SPEC-053 CA-04 and RN-04: the presentation must be of the class and the module must exist.
func TestSaveContent_ForeignDeckOrMissingModule(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	id := c.sessions[0].ID
	other, missing := uuid.New(), uuid.New()
	_, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, id, service.ContentInput{DeckID: &other})
	assert.ErrorIs(t, err, domain.ErrDeckNotFound)
	_, err = c.svc.SaveContent(ctx, c.teacher, c.class.ID, id, service.ContentInput{ModuleID: &missing})
	assert.ErrorIs(t, err, domain.ErrModuleNotFound)
	assert.False(t, c.repo.sessions[id].HasContent, "nothing was saved")
}

// Covers SPEC-053 CA-05: who writes and who reads.
func TestContent_Permissions(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	id := c.sessions[0].ID
	_, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, id, c.full())
	require.NoError(t, err)

	// A student reads, and does not write.
	got, err := c.svc.Content(ctx, c.student, c.class.ID, id)
	require.NoError(t, err)
	assert.Equal(t, "Permissões de arquivos", got.Topic)
	_, err = c.svc.SaveContent(ctx, c.student, c.class.ID, id, c.full())
	assert.ErrorIs(t, err, domain.ErrForbidden)

	// A student without an active enrollment does not even see the class; a teacher of another class is refused.
	outsider := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	_, err = c.svc.Content(ctx, outsider, c.class.ID, id)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	other := service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	_, err = c.svc.Content(ctx, other, c.class.ID, id)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = c.svc.SaveContent(ctx, other, c.class.ID, id, c.full())
	assert.ErrorIs(t, err, domain.ErrForbidden)

	// A lesson of another class is not found.
	_, err = c.svc.Content(ctx, c.teacher, c.class.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
	otherClass := service.ClassInfo{ID: uuid.New(), TeacherID: c.teacher.UserID, StartDate: day(2026, 10, 1), EndDate: day(2026, 10, 31)}
	c.repo.classes[otherClass.ID] = otherClass
	_, err = c.svc.Content(ctx, c.teacher, otherClass.ID, id)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
}

// Covers SPEC-053 CA-07: the reading brings the presentation with its signed address and the module; a module that the reader
// cannot see is left out instead of failing.
func TestContent_ReadsDeckAndModule(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	id := c.sessions[0].ID
	_, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, id, c.full())
	require.NoError(t, err)

	got, err := c.svc.Content(ctx, c.student, c.class.ID, id)
	require.NoError(t, err)
	require.NotNil(t, got.Deck)
	assert.Equal(t, "https://files.example/deck.pdf?ttl=900", got.Deck.DownloadURL)
	require.NotNil(t, got.Module)
	assert.Equal(t, c.module, got.Module.ID)

	c.svc.WithContentRefs(fakeDecks{decks: nil}, fakeModules{titles: map[uuid.UUID]string{c.module: "Permissões"}, hidden: map[uuid.UUID]bool{c.module: true}})
	got, err = c.svc.Content(ctx, c.student, c.class.ID, id)
	require.NoError(t, err)
	assert.Nil(t, got.Module, "a module the student cannot see is left out")
	assert.Nil(t, got.Deck, "a presentation that is gone is left out")
	assert.Equal(t, "Permissões de arquivos", got.Topic)
	assert.Len(t, got.Links, 2)
}

// Covers SPEC-053 CA-07: a lesson without content reads as empty.
func TestContent_EmptyLesson(t *testing.T) {
	c := newContentFixture(t)
	got, err := c.svc.Content(context.Background(), c.student, c.class.ID, c.sessions[0].ID)
	require.NoError(t, err)
	assert.Empty(t, got.Topic)
	assert.Empty(t, got.Description)
	assert.Nil(t, got.Module)
	assert.Nil(t, got.Deck)
	assert.Empty(t, got.Links)
}

// Covers SPEC-053 RN-01: saving an empty content clears the lesson, which is no longer a lesson with content.
func TestSaveContent_ClearsWhenEmpty(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	id := c.sessions[0].ID
	_, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, id, c.full())
	require.NoError(t, err)
	_, err = c.svc.SaveContent(ctx, c.teacher, c.class.ID, id, service.ContentInput{})
	require.NoError(t, err)

	cleared := c.repo.sessions[id]
	assert.False(t, cleared.HasContent)
	assert.Nil(t, cleared.Topic)
	assert.Nil(t, cleared.Description)
	assert.Nil(t, cleared.DeckID)
	assert.Nil(t, cleared.ModuleID)
	assert.Empty(t, c.repo.links[id])
}

// Covers SPEC-053 CA-06 and RN-05: when the weekly lessons are regenerated, the ones with content stay, even if their meeting is gone.
func TestRegenerationKeepsSessionsWithContent(t *testing.T) {
	c := newContentFixture(t)
	ctx := context.Background()
	var monday domain.ClassSession
	for _, s := range c.sessions {
		if s.Date.Equal(day(2026, 10, 19)) {
			monday = s
		}
	}
	require.NotEqual(t, uuid.Nil, monday.ID)
	_, err := c.svc.SaveContent(ctx, c.teacher, c.class.ID, monday.ID, service.ContentInput{Topic: "Fica"})
	require.NoError(t, err)

	// The Monday meeting is removed: only Wednesday is left.
	wednesdayOnly := c.meetings()[1:]
	_, err = c.svc.ReplaceMeetings(ctx, c.teacher, c.class.ID, wednesdayOnly)
	require.NoError(t, err)

	after, err := c.repo.ListSessions(ctx, []uuid.UUID{c.class.ID}, day(2026, 10, 14), day(2026, 10, 31))
	require.NoError(t, err)
	var mondays []string
	for _, s := range after {
		if s.Date.Weekday() == 1 {
			mondays = append(mondays, s.Date.Format("01-02"))
		}
	}
	assert.Equal(t, []string{"10-19"}, mondays, "only the Monday with content stays; the others go with their meeting")
	assert.Equal(t, "Fica", *c.repo.sessions[monday.ID].Topic)
}
