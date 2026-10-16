package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ---- SPEC-071: the timeline of the class ----

func hm(h, m int) domain.Clock { return domain.Clock(h*60 + m) }

func at(y int, mo time.Month, d, h, m int) time.Time {
	return time.Date(y, mo, d, h, m, 0, 0, domain.Location())
}

// lesson makes a scheduled session on a date with a time window; the topic tells the sessions apart in the assertions.
func lesson(topic string, y int, mo time.Month, d int, start, end domain.Clock) domain.ClassSession {
	return domain.ClassSession{Model: database.Model{ID: uuid.New()}, Date: time.Date(y, mo, d, 0, 0, 0, 0, domain.Location()),
		StartTime: start, EndTime: end, Status: domain.SessionScheduled, Topic: &topic}
}

func topics(list []domain.ClassSession) []string {
	out := make([]string, len(list))
	for i, s := range list {
		out[i] = *s.Topic
	}
	return out
}

// Covers SPEC-071 CA-01 and RN-01: the past (the 3 most recent, newest first), the current (the lesson of today whose window started: 15
// minutes before the start, until the end) and the upcoming (the 5 nearest), out of the lessons that are not canceled.
func TestTimelineSplit(t *testing.T) {
	sessions := []domain.ClassSession{
		lesson("p1", 2026, time.October, 5, hm(8, 20), hm(10, 0)),
		lesson("p2", 2026, time.October, 7, hm(13, 50), hm(15, 30)),
		lesson("p3", 2026, time.October, 12, hm(8, 20), hm(10, 0)),
		lesson("p4", 2026, time.October, 14, hm(13, 50), hm(15, 30)),
		lesson("now", 2026, time.October, 19, hm(8, 20), hm(10, 0)),
		lesson("u1", 2026, time.October, 21, hm(13, 50), hm(15, 30)),
		lesson("u2", 2026, time.October, 26, hm(8, 20), hm(10, 0)),
		lesson("u3", 2026, time.October, 28, hm(13, 50), hm(15, 30)),
		lesson("u4", 2026, time.November, 2, hm(8, 20), hm(10, 0)),
		lesson("u5", 2026, time.November, 4, hm(13, 50), hm(15, 30)),
		lesson("u6", 2026, time.November, 9, hm(8, 20), hm(10, 0)),
	}
	canceled := lesson("canceled", 2026, time.October, 16, hm(8, 20), hm(10, 0))
	canceled.Status = domain.SessionCanceled
	sessions = append(sessions, canceled)

	tl := domain.SplitTimeline(sessions, at(2026, time.October, 19, 9, 0))
	assert.Equal(t, []string{"p4", "p3", "p2"}, topics(tl.Past), "the 3 most recent, newest first")
	require.NotNil(t, tl.Current)
	assert.Equal(t, "now", *tl.Current.Topic)
	assert.Equal(t, []string{"u1", "u2", "u3", "u4", "u5"}, topics(tl.Upcoming), "the 5 nearest, nearest first")
}

// Covers SPEC-071 CA-01 and D-04: the window of the current lesson opens 15 minutes before the start and closes at the end, to the minute.
func TestTimelineSplit_WindowOfFifteenMinutesBefore(t *testing.T) {
	today := lesson("today", 2026, time.October, 19, hm(8, 20), hm(10, 0))
	sessions := []domain.ClassSession{today}

	cases := []struct {
		name    string
		now     time.Time
		current bool
		past    int
		next    int
	}{
		{"16 minutes before: still upcoming", at(2026, time.October, 19, 8, 4), false, 0, 1},
		{"15 minutes before: current", at(2026, time.October, 19, 8, 5), true, 0, 0},
		{"at the start: current", at(2026, time.October, 19, 8, 20), true, 0, 0},
		{"one minute before the end: current", at(2026, time.October, 19, 9, 59), true, 0, 0},
		{"at the end: past", at(2026, time.October, 19, 10, 0), false, 1, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tl := domain.SplitTimeline(sessions, tc.now)
			assert.Equal(t, tc.current, tl.Current != nil)
			assert.Len(t, tl.Past, tc.past)
			assert.Len(t, tl.Upcoming, tc.next)
		})
	}
}

// Covers SPEC-071 RN-01: with two lessons of the day in the window at once, the one that starts earlier is the current one; the clock is read
// in the time zone of the schedule, so a lesson around midnight is on its own day.
func TestTimelineSplit_TwoLessonsADayAndMidnight(t *testing.T) {
	early := lesson("early", 2026, time.October, 19, hm(8, 20), hm(10, 0))
	late := lesson("late", 2026, time.October, 19, hm(10, 0), hm(11, 40))
	tl := domain.SplitTimeline([]domain.ClassSession{late, early}, at(2026, time.October, 19, 9, 50))
	require.NotNil(t, tl.Current)
	assert.Equal(t, "early", *tl.Current.Topic, "the window of the late one opened at 09:45, but the early one started first")
	assert.Equal(t, []string{"late"}, topics(tl.Upcoming))

	night := lesson("night", 2026, time.October, 19, hm(22, 0), hm(23, 50))
	tl = domain.SplitTimeline([]domain.ClassSession{night}, at(2026, time.October, 20, 0, 1).UTC())
	assert.Nil(t, tl.Current)
	assert.Equal(t, []string{"night"}, topics(tl.Past), "one minute past midnight, local time, the night lesson is over")
}

// Covers SPEC-071 RN-01: a lesson that was changed by hand uses its changed time; an empty schedule gives empty blocks, not nil.
func TestTimelineSplit_ChangedTimeAndEmpty(t *testing.T) {
	moved := lesson("moved", 2026, time.October, 19, hm(14, 0), hm(15, 40))
	moved.Overridden = true
	tl := domain.SplitTimeline([]domain.ClassSession{moved}, at(2026, time.October, 19, 9, 0))
	assert.Nil(t, tl.Current, "at 09:00 the lesson moved to 14:00 has not started")
	assert.Equal(t, []string{"moved"}, topics(tl.Upcoming))

	empty := domain.SplitTimeline(nil, at(2026, time.October, 19, 9, 0))
	assert.Nil(t, empty.Current)
	assert.NotNil(t, empty.Past)
	assert.NotNil(t, empty.Upcoming)
	assert.Empty(t, empty.Past)
	assert.Empty(t, empty.Upcoming)
}

// Covers SPEC-071 RN-01: the instants of a lesson, with the window of the current one.
func TestClassSession_Instants(t *testing.T) {
	s := lesson("x", 2026, time.October, 19, hm(8, 20), hm(10, 0))
	assert.Equal(t, at(2026, time.October, 19, 8, 20), s.StartsAt())
	assert.Equal(t, at(2026, time.October, 19, 10, 0), s.EndsAt())
	assert.Equal(t, at(2026, time.October, 19, 8, 5), s.WindowOpensAt())
}

// Covers SPEC-071 CA-03 and RN-03: the notes of the teacher have the limit of the description; an empty one means none.
func TestTeacherNotes_Validate(t *testing.T) {
	got, err := domain.NormalizeTeacherNotes("teacherNotes", "  <p>Hoje vimos chmod</p>  ")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "<p>Hoje vimos chmod</p>", *got)

	got, err = domain.NormalizeTeacherNotes("teacherNotes", "   ")
	require.NoError(t, err)
	assert.Nil(t, got)

	_, err = domain.NormalizeTeacherNotes("teacherPrivateNotes", "<p>"+strings.Repeat("a", domain.MaxContentDescLength+1)+"</p>")
	require.ErrorIs(t, err, domain.ErrContentTooLong)
	var fe *domain.FieldError
	require.ErrorAs(t, err, &fe)
	assert.Equal(t, "teacherPrivateNotes", fe.Field)
}
