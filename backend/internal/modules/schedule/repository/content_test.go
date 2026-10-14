package repository_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// twoSessions creates the weekly lessons of Mondays 19 and 26 of October and returns them.
func twoSessions(t *testing.T, e env) []domain.ClassSession {
	t.Helper()
	m := e.meeting(t)
	sessions := []domain.ClassSession{domain.FromMeeting(e.class.ID, m, day(2026, 10, 19)), domain.FromMeeting(e.class.ID, m, day(2026, 10, 26))}
	require.NoError(t, e.repo.ReplaceMeetings(e.ctx, e.class.ID, []domain.WeeklyMeeting{m}, day(2026, 10, 13), sessions))
	list, err := e.repo.ListSessions(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	require.Len(t, list, 2)
	return list
}

func (e env) deck(t *testing.T) uuid.UUID {
	t.Helper()
	id := uuid.New()
	require.NoError(t, e.db.Conn(e.ctx).Exec(`INSERT INTO slide_decks (id, class_id, uploaded_by, title, object_key, page_count, created_at, updated_at)
		VALUES (?, ?, ?, 'Slides', 'classes/x/decks/x.pdf', 12, NOW(), NOW())`, id, e.class.ID, e.teacher.ID).Error)
	return id
}

func links(t *testing.T, session uuid.UUID, names ...string) []domain.SessionLink {
	t.Helper()
	in := make([]domain.LinkInput, len(names))
	for i, n := range names {
		in[i] = domain.LinkInput{Name: n, URL: "https://example.com/" + n}
	}
	out, err := domain.BuildSessionLinks(session, in)
	require.NoError(t, err)
	return out
}

// Covers SPEC-053 CA-01 and RN-01: the content goes to the lesson, and the links come back in order.
func TestRepository_SaveContent(t *testing.T) {
	e := newEnv(t)
	sessions := twoSessions(t, e)
	target, other := sessions[0], sessions[1]
	deck := e.deck(t)

	target.Topic, target.Description, target.DeckID, target.HasContent = str("Permissões"), str("<p>chmod</p>"), &deck, true
	require.NoError(t, e.repo.SaveContent(e.ctx, &target, links(t, target.ID, "meet", "video", "slides")))

	found, err := e.repo.FindSession(e.ctx, target.ID)
	require.NoError(t, err)
	require.NotNil(t, found.Topic)
	assert.Equal(t, "Permissões", *found.Topic)
	assert.Equal(t, "<p>chmod</p>", *found.Description)
	assert.Equal(t, &deck, found.DeckID)
	assert.True(t, found.HasContent)

	list, err := e.repo.ListSessionLinks(e.ctx, target.ID)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []string{"meet", "video", "slides"}, []string{list[0].Name, list[1].Name, list[2].Name})
	assert.Equal(t, []int{0, 1, 2}, []int{list[0].Position, list[1].Position, list[2].Position})

	untouched, err := e.repo.FindSession(e.ctx, other.ID)
	require.NoError(t, err)
	assert.Nil(t, untouched.Topic)
	assert.False(t, untouched.HasContent, "the other lesson has no content")
	none, err := e.repo.ListSessionLinks(e.ctx, other.ID)
	require.NoError(t, err)
	assert.Empty(t, none)
}

// Covers SPEC-053 section 4: the links that are replaced are soft deleted, and the list is read in order.
func TestRepository_SaveContentReplacesLinksSoftly(t *testing.T) {
	e := newEnv(t)
	target := twoSessions(t, e)[0]
	target.HasContent = true
	require.NoError(t, e.repo.SaveContent(e.ctx, &target, links(t, target.ID, "a", "b")))
	require.NoError(t, e.repo.SaveContent(e.ctx, &target, links(t, target.ID, "c")))

	list, err := e.repo.ListSessionLinks(e.ctx, target.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "c", list[0].Name)

	var total, alive int64
	require.NoError(t, e.db.Conn(e.ctx).Table("class_session_links").Where("session_id = ?", target.ID).Count(&total).Error)
	require.NoError(t, e.db.Conn(e.ctx).Table("class_session_links").Where("session_id = ? AND deleted_at IS NULL", target.ID).Count(&alive).Error)
	assert.EqualValues(t, 3, total, "the replaced links stay in the history")
	assert.EqualValues(t, 1, alive)

	target.HasContent = false
	require.NoError(t, e.repo.SaveContent(e.ctx, &target, nil))
	list, err = e.repo.ListSessionLinks(e.ctx, target.ID)
	require.NoError(t, err)
	assert.Empty(t, list)
}

// Covers SPEC-053 CA-01: the lesson and its links are saved all or nothing.
func TestRepository_SaveContentIsAtomic(t *testing.T) {
	e := newEnv(t)
	target := twoSessions(t, e)[0]
	target.Topic, target.HasContent = str("Antigo"), true
	require.NoError(t, e.repo.SaveContent(e.ctx, &target, links(t, target.ID, "antigo")))

	changed := target
	changed.Topic = str("Novo")
	broken := links(t, target.ID, "a", "b")
	broken[1].ID = broken[0].ID // the same primary key: the second insert fails
	require.Error(t, e.repo.SaveContent(e.ctx, &changed, broken))

	found, err := e.repo.FindSession(e.ctx, target.ID)
	require.NoError(t, err)
	assert.Equal(t, "Antigo", *found.Topic, "the lesson is as it was")
	list, err := e.repo.ListSessionLinks(e.ctx, target.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "antigo", list[0].Name)
}

// Covers SPEC-053 CA-06 and RN-05: regenerating the weekly lessons keeps the ones with content, even without their meeting.
func TestRepository_ReplaceMeetingsKeepsSessionsWithContent(t *testing.T) {
	e := newEnv(t)
	sessions := twoSessions(t, e)
	keep := sessions[0]
	keep.Topic, keep.HasContent = str("Fica"), true
	require.NoError(t, e.repo.SaveContent(e.ctx, &keep, nil))

	// The meeting goes away: no meetings, and no sessions generated.
	require.NoError(t, e.repo.ReplaceMeetings(e.ctx, e.class.ID, nil, day(2026, 10, 13), nil))

	list, err := e.repo.ListSessions(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	require.Len(t, list, 1, "only the lesson with content stays")
	assert.Equal(t, keep.ID, list[0].ID)
	assert.Equal(t, "Fica", *list[0].Topic)
}

// Covers SPEC-053 CA-07: the calendar reads the topic and the flag with the lessons.
func TestRepository_ListSessionsBringsTheTopicAndTheFlag(t *testing.T) {
	e := newEnv(t)
	sessions := twoSessions(t, e)
	first := sessions[0]
	first.Topic, first.HasContent = str("Permissões"), true
	require.NoError(t, e.repo.SaveContent(e.ctx, &first, nil))

	list, err := e.repo.ListSessions(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	require.Len(t, list, 2)
	assert.Equal(t, "Permissões", *list[0].Topic)
	assert.True(t, list[0].HasContent)
	assert.Nil(t, list[1].Topic)
	assert.False(t, list[1].HasContent)
}
