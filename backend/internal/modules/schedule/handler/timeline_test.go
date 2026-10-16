package handler_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ---- SPEC-071: the timeline of the class and the diary of the lesson ----

func (f *fakeService) Timeline(_ context.Context, a service.Actor, classID uuid.UUID) (service.Timeline, error) {
	f.actor, f.classID = a, classID
	return f.timeline, f.err
}

func (f *fakeService) Diary(_ context.Context, a service.Actor, classID, sessionID uuid.UUID) (service.Diary, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	return f.diary, f.err
}

func timelinePath(classID uuid.UUID) string {
	return "/api/v1/classes/" + classID.String() + "/sessions/timeline"
}

func diaryPath(classID, sessionID uuid.UUID) string {
	return "/api/v1/classes/" + classID.String() + "/sessions/" + sessionID.String() + "/diary"
}

// aLesson is a lesson of the calendar with content, whose private notes must never leak into the timeline.
func aLesson(classID uuid.UUID, d time.Time) domain.ClassSession {
	return domain.ClassSession{Model: database.Model{ID: uuid.New()}, ClassID: classID, Date: d, StartTime: clk("08:20"), EndTime: clk("10:00"),
		LessonCount: 2, Mode: domain.ModeInPerson, Room: str("B-204"), Status: domain.SessionScheduled, Origin: domain.OriginWeekly,
		Topic: str("Permissões"), Description: str("<p>longo</p>"), HasContent: true, TeacherNotes: str("<p>público</p>"), TeacherPrivateNotes: str("<p>segredo</p>")}
}

// Covers SPEC-071 CA-01, CA-02, CA-04 and section 5: the timeline comes with the now of the server, the three blocks, the instants of each
// lesson with the offset of the schedule, the counts of the rooms and the commands, the open room, and nothing of the notes.
func TestTimelineRoute(t *testing.T) {
	srv, svc, userID := setup(authn.RoleStudent)
	defer srv.Close()
	classID, live := uuid.New(), uuid.New()
	current, past := aLesson(classID, day(2026, 10, 19)), aLesson(classID, day(2026, 10, 14))
	svc.timeline = service.Timeline{
		Now:           time.Date(2026, 10, 19, 9, 0, 0, 0, domain.Location()),
		Current:       &service.TimelineEntry{Session: current, LiveSessionCount: 1, CommandCount: 4},
		Past:          []service.TimelineEntry{{Session: past}},
		Upcoming:      []service.TimelineEntry{},
		LiveSessionID: &live,
	}

	status, body := call(t, srv, http.MethodGet, timelinePath(classID), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, "2026-10-19T09:00:00-03:00", body["now"])
	assert.Equal(t, live.String(), body["liveSessionId"])

	cur := body["current"].(map[string]any)
	assert.Equal(t, current.ID.String(), cur["id"])
	assert.Equal(t, "2026-10-19", cur["date"])
	assert.Equal(t, "08:20", cur["startTime"])
	assert.Equal(t, "10:00", cur["endTime"])
	assert.Equal(t, "2026-10-19T08:20:00-03:00", cur["startsAt"])
	assert.Equal(t, "2026-10-19T10:00:00-03:00", cur["endsAt"])
	assert.Equal(t, "IN_PERSON", cur["mode"])
	assert.Equal(t, "B-204", cur["room"])
	assert.EqualValues(t, 2, cur["lessonCount"])
	assert.Equal(t, "Permissões", cur["topic"])
	assert.Equal(t, true, cur["hasContent"])
	assert.EqualValues(t, 1, cur["liveSessionCount"])
	assert.EqualValues(t, 4, cur["commandCount"])
	assert.NotContains(t, cur, "teacherPrivateNotes", "the notes come from the diary")
	assert.NotContains(t, cur, "teacherNotes")
	assert.NotContains(t, cur, "description")

	pastList := body["past"].([]any)
	require.Len(t, pastList, 1)
	assert.Equal(t, past.ID.String(), pastList[0].(map[string]any)["id"])
	assert.EqualValues(t, 0, pastList[0].(map[string]any)["commandCount"])
	assert.Equal(t, []any{}, body["upcoming"], "an empty block is an empty list")

	// no lesson now and no open room
	svc.timeline = service.Timeline{Now: svc.timeline.Now, Past: []service.TimelineEntry{}, Upcoming: []service.TimelineEntry{}}
	status, body = call(t, srv, http.MethodGet, timelinePath(classID), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Nil(t, body["current"])
	assert.Nil(t, body["liveSessionId"])
	assert.Contains(t, body, "current")
	assert.Contains(t, body, "liveSessionId")

	for _, tc := range []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
	} {
		svc.err = tc.err
		status, out := call(t, srv, http.MethodGet, timelinePath(classID), nil)
		assert.Equal(t, tc.status, status, tc.typ)
		assert.Equal(t, tc.typ, out["type"])
	}
	svc.err = nil
	status, out := call(t, srv, http.MethodGet, "/api/v1/classes/not-a-uuid/sessions/timeline", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])
}

// Covers SPEC-071 CA-04, CA-08 and section 5: the diary brings the lesson with its counts, the content with the public notes (and the private
// ones only when the service gave them), and the rooms linked to the lesson with their commands.
func TestDiaryRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, live := uuid.New(), uuid.New()
	lesson := aLesson(classID, day(2026, 10, 14))
	started := time.Date(2026, 10, 14, 13, 50, 0, 0, domain.Location())
	ended := started.Add(95 * time.Minute)
	svc.diary = service.Diary{
		Entry:   service.TimelineEntry{Session: lesson, LiveSessionCount: 1, CommandCount: 4},
		Content: service.SessionContent{Topic: "Permissões", TeacherNotes: "<p>público</p>", TeacherPrivateNotes: str("<p>segredo</p>"), Links: []domain.SessionLink{}},
		LiveSessions: []service.LiveSummary{
			{ID: live, Title: "Aula", Status: "FINISHED", StartedAt: started, EndedAt: &ended, DurationMinutes: 95, CommandCount: 4},
		},
	}

	status, body := call(t, srv, http.MethodGet, diaryPath(classID, lesson.ID), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, lesson.ID, svc.sessionID)
	session := body["session"].(map[string]any)
	assert.Equal(t, lesson.ID.String(), session["id"])
	assert.EqualValues(t, 1, session["liveSessionCount"])
	assert.EqualValues(t, 4, session["commandCount"])
	assert.Equal(t, "2026-10-14T08:20:00-03:00", session["startsAt"])
	content := body["content"].(map[string]any)
	assert.Equal(t, "Permissões", content["topic"])
	assert.Equal(t, "<p>público</p>", content["teacherNotes"])
	assert.Equal(t, "<p>segredo</p>", content["teacherPrivateNotes"])
	assert.Equal(t, []any{}, content["links"])
	rooms := body["liveSessions"].([]any)
	require.Len(t, rooms, 1)
	room := rooms[0].(map[string]any)
	assert.Equal(t, live.String(), room["id"])
	assert.Equal(t, "Aula", room["title"])
	assert.Equal(t, "FINISHED", room["status"])
	assert.Equal(t, "2026-10-14T13:50:00-03:00", room["startedAt"])
	assert.Equal(t, "2026-10-14T15:25:00-03:00", room["endedAt"])
	assert.EqualValues(t, 95, room["durationMinutes"])
	assert.EqualValues(t, 4, room["commandCount"])

	// what a student gets: the service gave no private notes, so the field is not there at all
	svc.diary.Content.TeacherPrivateNotes = nil
	svc.diary.LiveSessions = []service.LiveSummary{}
	status, body = call(t, srv, http.MethodGet, diaryPath(classID, lesson.ID), nil)
	require.Equal(t, http.StatusOK, status, body)
	content = body["content"].(map[string]any)
	assert.Equal(t, "<p>público</p>", content["teacherNotes"])
	assert.NotContains(t, content, "teacherPrivateNotes")
	assert.Equal(t, []any{}, body["liveSessions"])

	for _, tc := range []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrSessionNotFound, http.StatusNotFound, "session-not-found"},
	} {
		svc.err = tc.err
		status, out := call(t, srv, http.MethodGet, diaryPath(classID, lesson.ID), nil)
		assert.Equal(t, tc.status, status, tc.typ)
		assert.Equal(t, tc.typ, out["type"])
	}
	svc.err = nil
	status, out := call(t, srv, http.MethodGet, "/api/v1/classes/"+classID.String()+"/sessions/not-a-uuid/diary", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])
}

// Covers SPEC-071 CA-03, CA-04 and section 5: the content takes and gives back the notes of the teacher; the private ones only when the
// service gave them, and a note over the limit points at its field.
func TestContentRoute_TeacherNotes(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	path := contentPath(uuid.New(), uuid.New())
	svc.content = service.SessionContent{Topic: "x", TeacherNotes: "<p>público</p>", TeacherPrivateNotes: str("<p>segredo</p>"), Links: []domain.SessionLink{}}

	status, body := call(t, srv, http.MethodPut, path, map[string]any{"topic": "x", "teacherNotes": "<p>público</p>", "teacherPrivateNotes": "<p>segredo</p>"})
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, "<p>público</p>", svc.savedContent.TeacherNotes)
	assert.Equal(t, "<p>segredo</p>", svc.savedContent.TeacherPrivateNotes)
	assert.Equal(t, "<p>público</p>", body["teacherNotes"])
	assert.Equal(t, "<p>segredo</p>", body["teacherPrivateNotes"])

	// the reading of a student: no private notes at all; the public ones come, even empty
	svc.content = service.SessionContent{Links: []domain.SessionLink{}}
	status, body = call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, "", body["teacherNotes"])
	assert.NotContains(t, body, "teacherPrivateNotes")

	svc.err = &domain.FieldError{Field: "teacherPrivateNotes", Err: domain.ErrContentTooLong}
	status, out := call(t, srv, http.MethodPut, path, map[string]any{"teacherPrivateNotes": "x"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "content-too-long", out["type"])
	assert.Equal(t, "teacherPrivateNotes", out["field"])
}
