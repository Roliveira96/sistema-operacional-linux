package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
)

// ---- SPEC-071: the timeline of the class and the diary of the lesson ----

// fakeLive answers for the live classroom, like the classroom service does through the port in cmd/api: the rooms linked to each lesson,
// with their commands, and the open room of the class.
type fakeLive struct {
	linked map[uuid.UUID][]service.LiveSummary // by lesson
	active *service.ActiveLive
	calls  int
}

func (l *fakeLive) LinkedSessions(_ context.Context, lessons []uuid.UUID) (map[uuid.UUID][]service.LiveSummary, error) {
	l.calls++
	out := map[uuid.UUID][]service.LiveSummary{}
	for _, id := range lessons {
		if rooms, ok := l.linked[id]; ok {
			out[id] = rooms
		}
	}
	return out, nil
}

func (l *fakeLive) ActiveSession(_ context.Context, _ uuid.UUID) (service.ActiveLive, bool, error) {
	if l.active == nil {
		return service.ActiveLive{}, false, nil
	}
	return *l.active, true, nil
}

type timelineFixture struct {
	*contentFixture
	live *fakeLive
}

func newTimelineFixture(t *testing.T) *timelineFixture {
	t.Helper()
	c := newContentFixture(t)
	live := &fakeLive{linked: map[uuid.UUID][]service.LiveSummary{}}
	c.svc.WithLiveSessions(live)
	return &timelineFixture{contentFixture: c, live: live}
}

func at(y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, domain.Location())
}

// on finds the lesson of the fixture on a day.
func (f *timelineFixture) on(t *testing.T, d time.Time) domain.ClassSession {
	t.Helper()
	for _, s := range f.sessions {
		if domain.Day(s.Date).Equal(domain.Day(d)) {
			return s
		}
	}
	require.FailNow(t, "no lesson on "+d.Format("2006-01-02"))
	return domain.ClassSession{}
}

func entryIDs(list []service.TimelineEntry) []uuid.UUID {
	out := make([]uuid.UUID, len(list))
	for i, e := range list {
		out[i] = e.Session.ID
	}
	return out
}

// Covers SPEC-071 CA-01 and RN-01, RN-04: the owner teacher, an administrator and a student with an active enrollment read the timeline:
// the past (newest first), the current lesson (the window of 15 minutes before the start, until the end) and the upcoming ones, each with
// how many rooms were linked to it and how many commands they have, from one reading of the live classroom.
func TestTimeline_Roles(t *testing.T) {
	f := newTimelineFixture(t)
	ctx := context.Background()
	// the lessons of the fixture start on 14/10 (Wed); Monday 26/10 at 09:00 is inside the window of its 08:20 lesson
	f.now = at(2026, time.October, 26, 9, 0)
	s14, s19, s21, s26, s28 := f.on(t, day(2026, 10, 14)), f.on(t, day(2026, 10, 19)), f.on(t, day(2026, 10, 21)), f.on(t, day(2026, 10, 26)), f.on(t, day(2026, 10, 28))
	f.live.linked[s21.ID] = []service.LiveSummary{
		{ID: uuid.New(), Title: "Aula de quarta", Status: "FINISHED", CommandCount: 12},
		{ID: uuid.New(), Title: "Tira-dúvidas", Status: "FINISHED", CommandCount: 3},
	}

	for _, actor := range []service.Actor{f.teacher, f.admin, f.student} {
		tl, err := f.svc.Timeline(ctx, actor, f.class.ID)
		require.NoError(t, err, actor.Role)
		assert.Equal(t, f.now, tl.Now)
		require.NotNil(t, tl.Current, actor.Role)
		assert.Equal(t, s26.ID, tl.Current.Session.ID)
		assert.Equal(t, []uuid.UUID{s21.ID, s19.ID, s14.ID}, entryIDs(tl.Past), "the past, newest first")
		assert.Equal(t, []uuid.UUID{s28.ID}, entryIDs(tl.Upcoming))
		assert.Nil(t, tl.LiveSessionID)
		assert.Equal(t, 2, tl.Past[0].LiveSessionCount)
		assert.Equal(t, 15, tl.Past[0].CommandCount)
		assert.Equal(t, 0, tl.Past[1].LiveSessionCount)
		assert.Equal(t, 0, tl.Current.CommandCount)
	}
	assert.Equal(t, 3, f.live.calls, "the rooms of every lesson come in one reading of the live classroom")

	outsider := service.Actor{UserID: uuid.New(), Role: f.student.Role}
	_, err := f.svc.Timeline(ctx, outsider, f.class.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	other := service.Actor{UserID: uuid.New(), Role: f.teacher.Role}
	_, err = f.svc.Timeline(ctx, other, f.class.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

// Covers SPEC-071 CA-01: a canceled lesson is in no block; without the live classroom plugged in, the timeline still reads.
func TestTimeline_CanceledOutAndNoLivePort(t *testing.T) {
	f := newTimelineFixture(t)
	f.now = at(2026, time.October, 26, 9, 0)
	canceled := f.repo.sessions[f.on(t, day(2026, 10, 21)).ID]
	canceled.Status = domain.SessionCanceled
	f.repo.sessions[canceled.ID] = canceled

	tl, err := f.svc.Timeline(context.Background(), f.teacher, f.class.ID)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{f.on(t, day(2026, 10, 19)).ID, f.on(t, day(2026, 10, 14)).ID}, entryIDs(tl.Past))

	plain := newContentFixture(t)
	plain.now = at(2026, time.October, 26, 9, 0)
	tl, err = plain.svc.Timeline(context.Background(), plain.teacher, plain.class.ID)
	require.NoError(t, err)
	require.NotNil(t, tl.Current)
	assert.Nil(t, tl.LiveSessionID)
}

// Covers SPEC-071 CA-02 and RN-02: the lesson linked to the open room is the current one, whatever the hour, and leaves the other blocks;
// the lesson that was current by the clock goes to the front of the upcoming ones.
func TestTimeline_LiveLinkedWins(t *testing.T) {
	f := newTimelineFixture(t)
	f.now = at(2026, time.October, 26, 9, 0)
	s26, s28 := f.on(t, day(2026, 10, 26)), f.on(t, day(2026, 10, 28))
	room := uuid.New()
	linked := s28.ID
	f.live.active = &service.ActiveLive{ID: room, ClassSessionID: &linked}
	f.live.linked[s28.ID] = []service.LiveSummary{{ID: room, Title: "Antecipada", Status: "ACTIVE", CommandCount: 2}}

	tl, err := f.svc.Timeline(context.Background(), f.student, f.class.ID)
	require.NoError(t, err)
	require.NotNil(t, tl.Current)
	assert.Equal(t, s28.ID, tl.Current.Session.ID, "the lesson of the open room, two days ahead")
	assert.Equal(t, 1, tl.Current.LiveSessionCount)
	assert.Equal(t, 2, tl.Current.CommandCount)
	assert.Equal(t, []uuid.UUID{s26.ID}, entryIDs(tl.Upcoming), "the lesson of the hour waits in the upcoming")
	assert.Len(t, tl.Past, 3)
	require.NotNil(t, tl.LiveSessionID)
	assert.Equal(t, room, *tl.LiveSessionID)

	// the linked room ended: the clock rules again
	f.live.active = nil
	tl, err = f.svc.Timeline(context.Background(), f.student, f.class.ID)
	require.NoError(t, err)
	assert.Equal(t, s26.ID, tl.Current.Session.ID)
	assert.Nil(t, tl.LiveSessionID)
}

// Covers SPEC-071 CA-02 and RN-02: an open room that is not linked to a lesson changes no block, and is told so the button of the room shows.
func TestTimeline_LiveUnlinkedKeepsBlocks(t *testing.T) {
	f := newTimelineFixture(t)
	f.now = at(2026, time.October, 26, 9, 0)
	room := uuid.New()
	f.live.active = &service.ActiveLive{ID: room}

	tl, err := f.svc.Timeline(context.Background(), f.student, f.class.ID)
	require.NoError(t, err)
	require.NotNil(t, tl.Current)
	assert.Equal(t, f.on(t, day(2026, 10, 26)).ID, tl.Current.Session.ID)
	assert.Equal(t, []uuid.UUID{f.on(t, day(2026, 10, 28)).ID}, entryIDs(tl.Upcoming))
	require.NotNil(t, tl.LiveSessionID)
	assert.Equal(t, room, *tl.LiveSessionID)

	// at an hour with no lesson, the unlinked room gives no current lesson either
	f.now = at(2026, time.October, 27, 9, 0)
	tl, err = f.svc.Timeline(context.Background(), f.student, f.class.ID)
	require.NoError(t, err)
	assert.Nil(t, tl.Current)
	assert.Equal(t, room, *tl.LiveSessionID)
}

// Covers SPEC-071 CA-03 and RN-03: the notes of the teacher are saved with the content, through the same filter as the description, and
// saving them is not a change of the lesson: no change mark, no reason, no e-mail. A lesson with notes alone is a lesson with content.
func TestSaveContent_TeacherNotes_NotAnOverrideNoMail(t *testing.T) {
	f := newTimelineFixture(t)
	ctx := context.Background()
	id := f.sessions[0].ID
	before := f.repo.sessions[id]

	got, err := f.svc.SaveContent(ctx, f.teacher, f.class.ID, id, service.ContentInput{
		TeacherNotes:        `  <p>Vimos <strong>chmod</strong></p><script>x()</script>  `,
		TeacherPrivateNotes: `<p onclick="y()">Rever o fork</p>`,
	})
	require.NoError(t, err)
	assert.Equal(t, "<p>Vimos <strong>chmod</strong></p>", got.TeacherNotes)
	require.NotNil(t, got.TeacherPrivateNotes)
	assert.Equal(t, "<p>Rever o fork</p>", *got.TeacherPrivateNotes)

	after := f.repo.sessions[id]
	require.NotNil(t, after.TeacherNotes)
	assert.Equal(t, "<p>Vimos <strong>chmod</strong></p>", *after.TeacherNotes)
	require.NotNil(t, after.TeacherPrivateNotes)
	assert.Equal(t, "<p>Rever o fork</p>", *after.TeacherPrivateNotes)
	assert.True(t, after.HasContent, "notes alone make a lesson with content")
	assert.False(t, after.Overridden)
	assert.Nil(t, after.ChangeReason)
	assert.Equal(t, before.StartTime, after.StartTime)
	assert.Empty(t, f.repo.outbox, "no e-mail")

	// an empty content clears the notes too
	_, err = f.svc.SaveContent(ctx, f.admin, f.class.ID, id, service.ContentInput{})
	require.NoError(t, err)
	cleared := f.repo.sessions[id]
	assert.Nil(t, cleared.TeacherNotes)
	assert.Nil(t, cleared.TeacherPrivateNotes)
	assert.False(t, cleared.HasContent)
}

// Covers SPEC-071 CA-03: notes over the limit are refused, pointing at the field, and nothing is saved.
func TestSaveContent_TeacherNotes_TooLong(t *testing.T) {
	f := newTimelineFixture(t)
	id := f.sessions[0].ID
	long := "<p>" + strings.Repeat("a", domain.MaxContentDescLength+1) + "</p>"
	for _, field := range []string{"teacherNotes", "teacherPrivateNotes"} {
		in := service.ContentInput{Topic: "x"}
		if field == "teacherNotes" {
			in.TeacherNotes = long
		} else {
			in.TeacherPrivateNotes = long
		}
		_, err := f.svc.SaveContent(context.Background(), f.teacher, f.class.ID, id, in)
		require.ErrorIs(t, err, domain.ErrContentTooLong, field)
		assert.Equal(t, field, contentField(err))
		assert.False(t, f.repo.sessions[id].HasContent, "nothing was saved")
	}
}

// Covers SPEC-071 CA-04 and RN-03: the private notes come back to the owner teacher and to an administrator, and never to a student; the
// public notes come back to everybody.
func TestContent_PrivateNotesOnlyTeacherAndAdmin(t *testing.T) {
	f := newTimelineFixture(t)
	ctx := context.Background()
	id := f.sessions[0].ID
	_, err := f.svc.SaveContent(ctx, f.teacher, f.class.ID, id, service.ContentInput{TeacherNotes: "<p>público</p>", TeacherPrivateNotes: "<p>privado</p>"})
	require.NoError(t, err)

	for _, actor := range []service.Actor{f.teacher, f.admin} {
		got, err := f.svc.Content(ctx, actor, f.class.ID, id)
		require.NoError(t, err)
		assert.Equal(t, "<p>público</p>", got.TeacherNotes)
		require.NotNil(t, got.TeacherPrivateNotes, actor.Role)
		assert.Equal(t, "<p>privado</p>", *got.TeacherPrivateNotes)
	}
	got, err := f.svc.Content(ctx, f.student, f.class.ID, id)
	require.NoError(t, err)
	assert.Equal(t, "<p>público</p>", got.TeacherNotes)
	assert.Nil(t, got.TeacherPrivateNotes, "the student never gets the private notes")

	// a teacher with no private notes gets an empty text, not nothing: the field is his
	_, err = f.svc.SaveContent(ctx, f.teacher, f.class.ID, id, service.ContentInput{TeacherNotes: "<p>público</p>"})
	require.NoError(t, err)
	got, err = f.svc.Content(ctx, f.teacher, f.class.ID, id)
	require.NoError(t, err)
	require.NotNil(t, got.TeacherPrivateNotes)
	assert.Equal(t, "", *got.TeacherPrivateNotes)
}

// Covers SPEC-071 CA-04, CA-08 and RN-04: the diary brings the lesson with its counts, the content (the private notes only to who may see
// them) and the rooms linked to the lesson; who reads is who reads the calendar.
func TestDiary_StudentGetsNoPrivateNotes(t *testing.T) {
	f := newTimelineFixture(t)
	ctx := context.Background()
	s := f.sessions[0]
	in := f.full()
	in.TeacherNotes, in.TeacherPrivateNotes = "<p>Vimos chmod</p>", "<p>Ana foi mal</p>"
	_, err := f.svc.SaveContent(ctx, f.teacher, f.class.ID, s.ID, in)
	require.NoError(t, err)
	started := at(2026, time.October, 14, 13, 50)
	ended := started.Add(95 * time.Minute)
	room := service.LiveSummary{ID: uuid.New(), Title: "Aula", Status: "FINISHED", StartedAt: started, EndedAt: &ended, DurationMinutes: 95, CommandCount: 7}
	f.live.linked[s.ID] = []service.LiveSummary{room}

	d, err := f.svc.Diary(ctx, f.student, f.class.ID, s.ID)
	require.NoError(t, err)
	assert.Equal(t, s.ID, d.Entry.Session.ID)
	assert.Equal(t, 1, d.Entry.LiveSessionCount)
	assert.Equal(t, 7, d.Entry.CommandCount)
	assert.Equal(t, "Permissões de arquivos", d.Content.Topic)
	assert.Equal(t, "<p>Vimos chmod</p>", d.Content.TeacherNotes)
	assert.Nil(t, d.Content.TeacherPrivateNotes)
	assert.Len(t, d.Content.Links, 2)
	require.Len(t, d.LiveSessions, 1)
	assert.Equal(t, room, d.LiveSessions[0])

	for _, actor := range []service.Actor{f.teacher, f.admin} {
		d, err := f.svc.Diary(ctx, actor, f.class.ID, s.ID)
		require.NoError(t, err)
		require.NotNil(t, d.Content.TeacherPrivateNotes, actor.Role)
		assert.Equal(t, "<p>Ana foi mal</p>", *d.Content.TeacherPrivateNotes)
	}

	// a lesson with nothing reads as empty, with empty lists
	empty, err := f.svc.Diary(ctx, f.student, f.class.ID, f.sessions[1].ID)
	require.NoError(t, err)
	assert.Empty(t, empty.Content.Topic)
	assert.NotNil(t, empty.LiveSessions)
	assert.Empty(t, empty.LiveSessions)

	outsider := service.Actor{UserID: uuid.New(), Role: f.student.Role}
	_, err = f.svc.Diary(ctx, outsider, f.class.ID, s.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	otherClass := service.ClassInfo{ID: uuid.New(), TeacherID: f.teacher.UserID, StartDate: day(2026, 10, 1), EndDate: day(2026, 10, 31)}
	f.repo.classes[otherClass.ID] = otherClass
	_, err = f.svc.Diary(ctx, f.teacher, otherClass.ID, s.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
}
