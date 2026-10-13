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
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, domain.Location())
}

func clk(s string) domain.Clock {
	c, err := domain.ParseClock(s)
	if err != nil {
		panic(err)
	}
	return c
}

func str(s string) *string { return &s }

type fixture struct {
	repo    *fakeRepo
	svc     *service.Service
	class   service.ClassInfo
	teacher service.Actor
	now     time.Time
	ana     service.Recipient
	bruno   service.Recipient
}

// newFixture: Tuesday 2026-10-13 10:00, a class from 2026-10-01 to 2026-10-31 with two active students.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{repo: newFakeRepo(), now: time.Date(2026, 10, 13, 10, 0, 0, 0, domain.Location())}
	f.teacher = service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	f.class = service.ClassInfo{
		ID: uuid.New(), TeacherID: f.teacher.UserID, Name: "Sistemas Operacionais", CourseCode: "SO34E",
		Color: "orange", StartDate: day(2026, 10, 1), EndDate: day(2026, 10, 31), Status: "ACTIVE",
	}
	f.repo.classes[f.class.ID] = f.class
	f.ana = service.Recipient{UserID: uuid.New(), Email: "ana@alunos.utfpr.edu.br", Name: "Ana", Reminders: true, Digest: true}
	f.bruno = service.Recipient{UserID: uuid.New(), Email: "bruno@alunos.utfpr.edu.br", Name: "Bruno", Reminders: false, Digest: false}
	f.repo.students[f.class.ID] = []service.Recipient{f.ana, f.bruno}
	f.svc = service.New(f.repo, func() time.Time { return f.now }, "http://lab.example")
	return f
}

func (f *fixture) meetings() []domain.WeeklyMeeting {
	return []domain.WeeklyMeeting{
		{Weekday: 1, StartTime: clk("08:20"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson, Room: str("B-204")},
		{Weekday: 3, StartTime: clk("13:50"), EndTime: clk("15:30"), LessonCount: 2, Mode: domain.ModeInPerson, Room: str("B-204")},
	}
}

func (f *fixture) setup(t *testing.T) []domain.ClassSession {
	t.Helper()
	_, err := f.svc.ReplaceMeetings(context.Background(), f.teacher, f.class.ID, f.meetings())
	require.NoError(t, err)
	sessions, err := f.repo.ListSessions(context.Background(), []uuid.UUID{f.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	return sessions
}

func dates(sessions []domain.ClassSession) []string {
	var out []string
	for _, s := range sessions {
		out = append(out, s.Date.Format("01-02")+" "+s.StartTime.String())
	}
	return out
}

func (f *fixture) sessionOn(t *testing.T, d time.Time) domain.ClassSession {
	t.Helper()
	for _, s := range f.repo.sessions {
		if domain.Day(s.Date).Equal(d) {
			return s
		}
	}
	t.Fatalf("no session on %s", d.Format("2006-01-02"))
	return domain.ClassSession{}
}

// Covers SPEC-042 RN-02 and CA-01: from today to the end of the validity, one session per meeting weekday.
func TestReplaceMeetings_GeneratesSessions(t *testing.T) {
	f := newFixture(t)
	sessions := f.setup(t)
	assert.Equal(t, []string{"10-14 13:50", "10-19 08:20", "10-21 13:50", "10-26 08:20", "10-28 13:50"}, dates(sessions))
	for _, s := range sessions {
		assert.Equal(t, domain.SessionScheduled, s.Status)
		assert.Equal(t, domain.OriginWeekly, s.Origin)
		assert.Equal(t, "B-204", *s.Room)
		require.NotNil(t, s.MeetingID)
	}
	assert.Empty(t, f.repo.outbox, "the regular schedule is not one of the e-mails of RN-09")

	_, err := f.svc.ReplaceMeetings(context.Background(), f.teacher, f.class.ID, []domain.WeeklyMeeting{
		{Weekday: 1, StartTime: clk("08:20"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson},
		{Weekday: 1, StartTime: clk("09:00"), EndTime: clk("11:00"), LessonCount: 2, Mode: domain.ModeInPerson},
	})
	require.ErrorIs(t, err, domain.ErrMeetingsOverlap)
}

// Covers SPEC-042 RN-02, D-08 and CA-03: changing the meetings keeps the sessions changed by hand, the extra ones and
// the past ones, and regenerates the rest.
func TestReplaceMeetings_RegeneratesOnlyFutureUntouched(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	changed := f.sessionOn(t, day(2026, 10, 19))
	_, err := f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, changed.ID, service.SessionChange{
		Status: domain.SessionScheduled, StartTime: clk("12:00"), EndTime: clk("13:40"), LessonCount: 2,
		Mode: domain.ModeInPerson, Room: str("Auditório"), Reason: str("Troca de sala"),
	})
	require.NoError(t, err)
	extra, err := f.svc.CreateExtraSession(context.Background(), f.teacher, f.class.ID, domain.ClassSession{
		Date: day(2026, 10, 30), StartTime: clk("08:20"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson,
	})
	require.NoError(t, err)

	meetings, err := f.svc.Meetings(context.Background(), f.teacher, f.class.ID)
	require.NoError(t, err)
	// Keep Monday (same id), move Wednesday to Thursday.
	monday := meetings[0]
	thursday := domain.WeeklyMeeting{Weekday: 4, StartTime: clk("13:50"), EndTime: clk("15:30"), LessonCount: 2, Mode: domain.ModeInPerson}
	_, err = f.svc.ReplaceMeetings(context.Background(), f.teacher, f.class.ID, []domain.WeeklyMeeting{monday, thursday})
	require.NoError(t, err)

	sessions, _ := f.repo.ListSessions(context.Background(), []uuid.UUID{f.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	assert.Equal(t, []string{"10-15 13:50", "10-19 12:00", "10-22 13:50", "10-26 08:20", "10-29 13:50", "10-30 08:20"}, dates(sessions))
	assert.Equal(t, changed.ID, f.sessionOn(t, day(2026, 10, 19)).ID, "the changed session is kept")
	assert.Equal(t, extra.ID, f.sessionOn(t, day(2026, 10, 30)).ID, "the extra session is kept")
}

// Covers SPEC-042 RN-03, D-02 and CA-04: a session on a holiday is flagged and not canceled.
func TestSessions_FlagHoliday(t *testing.T) {
	f := newFixture(t)
	f.repo.holidays[uuid.New()] = domain.Holiday{Date: day(2026, 10, 19), Name: "Recesso", Scope: domain.HolidayRecess, Active: true}
	f.repo.holidays[uuid.New()] = domain.Holiday{Date: day(2026, 10, 26), Name: "Inativo", Scope: domain.HolidayLocal, Active: false}
	f.setup(t)
	on := f.sessionOn(t, day(2026, 10, 19))
	assert.True(t, on.OnHoliday)
	assert.Equal(t, domain.SessionScheduled, on.Status)
	assert.False(t, f.sessionOn(t, day(2026, 10, 26)).OnHoliday, "an inactive holiday does not count")
	assert.False(t, f.sessionOn(t, day(2026, 10, 21)).OnHoliday)
}

// Covers SPEC-042 RN-04 and CA-05: a changed session keeps the reason, is marked overridden and e-mails the students.
func TestUpdateSession_OverrideAndEmail(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	target := f.sessionOn(t, day(2026, 10, 21))
	got, err := f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, target.ID, service.SessionChange{
		Status: domain.SessionScheduled, StartTime: clk("13:50"), EndTime: clk("15:30"), LessonCount: 2,
		Mode: domain.ModeOnline, OnlineURL: str("https://meet.google.com/abc"), Reason: str("Aula online hoje"),
	})
	require.NoError(t, err)
	assert.True(t, got.Overridden)
	assert.Equal(t, domain.ModeOnline, got.Mode)
	assert.Equal(t, "Aula online hoje", *got.ChangeReason)

	require.Len(t, f.repo.outbox, 2, "one e-mail per active student")
	for _, it := range f.repo.outbox {
		assert.Equal(t, service.KindChange, it.Kind)
		assert.Contains(t, it.TextBody, "21/10/2026")
		assert.Contains(t, it.TextBody, "https://meet.google.com/abc")
		assert.Contains(t, it.TextBody, "Aula online hoje")
	}
	assert.ElementsMatch(t, []string{f.ana.Email, f.bruno.Email}, []string{f.repo.outbox[0].To, f.repo.outbox[1].To},
		"changes always go, whatever the preferences (D-12)")

	_, err = f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, uuid.New(), service.SessionChange{})
	require.ErrorIs(t, err, domain.ErrSessionNotFound)
}

// Covers SPEC-042 RN-04 and CA-06.
func TestUpdateSession_CancelRequiresReason(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	target := f.sessionOn(t, day(2026, 10, 21))
	_, err := f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, target.ID, service.SessionChange{
		Status: domain.SessionCanceled, StartTime: target.StartTime, EndTime: target.EndTime, LessonCount: 2, Mode: domain.ModeInPerson,
	})
	require.ErrorIs(t, err, domain.ErrReasonRequired)
	assert.Empty(t, f.repo.outbox)

	got, err := f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, target.ID, service.SessionChange{
		Status: domain.SessionCanceled, StartTime: target.StartTime, EndTime: target.EndTime, LessonCount: 2,
		Mode: domain.ModeInPerson, Reason: str("Não haverá aula"),
	})
	require.NoError(t, err)
	assert.Equal(t, domain.SessionCanceled, got.Status)
	assert.Contains(t, f.repo.outbox[0].Subject, "cancelada")
}

// Covers SPEC-042 RN-04: undoing a change goes back to the meeting values.
func TestRevertOverride(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	target := f.sessionOn(t, day(2026, 10, 21))
	_, err := f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, target.ID, service.SessionChange{
		Status: domain.SessionCanceled, StartTime: target.StartTime, EndTime: target.EndTime, LessonCount: 2,
		Mode: domain.ModeInPerson, Reason: str("Imprevisto"),
	})
	require.NoError(t, err)

	got, err := f.svc.RevertSession(context.Background(), f.teacher, f.class.ID, target.ID)
	require.NoError(t, err)
	assert.False(t, got.Overridden)
	assert.Equal(t, domain.SessionScheduled, got.Status)
	assert.Nil(t, got.ChangeReason)
	assert.Equal(t, "B-204", *got.Room)
	assert.Len(t, f.repo.outbox, 4, "the undo is also a change for the students")
}

// Covers SPEC-042 RN-05, RN-06, D-06 and CA-07.
func TestCreateExtraSessionAndEvent_Email(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	extra, err := f.svc.CreateExtraSession(context.Background(), f.teacher, f.class.ID, domain.ClassSession{
		Date: day(2026, 10, 24), StartTime: clk("08:00"), EndTime: clk("11:40"), LessonCount: 4, Mode: domain.ModeInPerson, Room: str("Lab 3"),
	})
	require.NoError(t, err)
	assert.Equal(t, domain.OriginExtra, extra.Origin)
	assert.Nil(t, extra.MeetingID)

	_, err = f.svc.CreateExtraSession(context.Background(), f.teacher, f.class.ID, domain.ClassSession{
		Date: day(2026, 11, 3), StartTime: clk("08:00"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson,
	})
	require.ErrorIs(t, err, domain.ErrInvalidSession, "outside the validity")

	start, end := clk("19:00"), clk("21:00")
	event, err := f.svc.CreateEvent(context.Background(), f.teacher, f.class.ID, domain.ClassEvent{
		Title: "Palestra: o kernel Linux", Description: "Com a Profa. convidada", Date: day(2026, 10, 22),
		StartTime: &start, EndTime: &end, Location: str("Auditório"),
	})
	require.NoError(t, err)
	assert.Equal(t, f.class.ID, event.ClassID)

	assert.Equal(t, []string{service.KindChange, service.KindChange, service.KindChange, service.KindChange}, f.repo.kinds())
	assert.Contains(t, f.repo.outbox[2].Subject, "Palestra: o kernel Linux")

	event.Title = "Palestra adiada"
	_, err = f.svc.UpdateEvent(context.Background(), f.teacher, f.class.ID, event.ID, event)
	require.NoError(t, err)
	require.NoError(t, f.svc.DeleteEvent(context.Background(), f.teacher, f.class.ID, event.ID))
	require.NoError(t, f.svc.DeleteExtraSession(context.Background(), f.teacher, f.class.ID, extra.ID))
	assert.Len(t, f.repo.outbox, 10)

	weekly := f.sessionOn(t, day(2026, 10, 21))
	require.ErrorIs(t, f.svc.DeleteExtraSession(context.Background(), f.teacher, f.class.ID, weekly.ID), domain.ErrNotExtraSession)
}

// Covers SPEC-042 RN-07, D-07, D-15 and CA-08: a period changes every weekly session in it in one go and sends one
// e-mail per student, not one per session.
func TestApplyPeriod_ChangesAllSessionsOneEmail(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	manual := f.sessionOn(t, day(2026, 10, 21))
	_, err := f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, manual.ID, service.SessionChange{
		Status: domain.SessionScheduled, StartTime: clk("13:50"), EndTime: clk("15:30"), LessonCount: 2,
		Mode: domain.ModeInPerson, Room: str("Lab 1"), Reason: str("Laboratório"),
	})
	require.NoError(t, err)
	f.repo.outbox = nil

	period, affected, err := f.svc.ApplyPeriod(context.Background(), f.teacher, f.class.ID, domain.SpecialPeriod{
		FirstDay: day(2026, 10, 19), LastDay: day(2026, 10, 23), Action: domain.PeriodNoClasses, Label: "Semana de preparação",
	})
	require.NoError(t, err)
	assert.Equal(t, 1, affected, "the session changed by hand on the 21st is kept")
	canceled := f.sessionOn(t, day(2026, 10, 19))
	assert.Equal(t, domain.SessionCanceled, canceled.Status)
	assert.Equal(t, "Semana de preparação", *canceled.ChangeReason)
	require.NotNil(t, canceled.PeriodID)
	assert.Equal(t, period.ID, *canceled.PeriodID)
	assert.Equal(t, "Lab 1", *f.sessionOn(t, day(2026, 10, 21)).Room)
	assert.Equal(t, domain.SessionScheduled, f.sessionOn(t, day(2026, 10, 26)).Status)

	require.Len(t, f.repo.outbox, 2)
	assert.Contains(t, f.repo.outbox[0].TextBody, "19/10/2026 a 23/10/2026")

	_, _, err = f.svc.ApplyPeriod(context.Background(), f.teacher, f.class.ID, domain.SpecialPeriod{
		FirstDay: day(2026, 10, 26), LastDay: day(2026, 10, 28), Action: domain.PeriodOnline, Label: "Semana online",
		OnlineURL: str("https://meet.google.com/xyz"),
	})
	require.NoError(t, err)
	online := f.sessionOn(t, day(2026, 10, 28))
	assert.Equal(t, domain.ModeOnline, online.Mode)
	assert.Equal(t, "https://meet.google.com/xyz", *online.OnlineURL)

	_, _, err = f.svc.ApplyPeriod(context.Background(), f.teacher, f.class.ID, domain.SpecialPeriod{
		FirstDay: day(2026, 10, 30), LastDay: day(2026, 11, 2), Action: domain.PeriodNoClasses, Label: "Fora",
	})
	require.ErrorIs(t, err, domain.ErrInvalidPeriod, "the period stays inside the validity")
}

// Covers SPEC-042 RN-07 and CA-09: deleting a period gives back the meeting values to the sessions it changed.
func TestDeletePeriod_RestoresSessions(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	period, _, err := f.svc.ApplyPeriod(context.Background(), f.teacher, f.class.ID, domain.SpecialPeriod{
		FirstDay: day(2026, 10, 19), LastDay: day(2026, 10, 21), Action: domain.PeriodOnline, Label: "Online",
		OnlineURL: str("https://meet.google.com/xyz"),
	})
	require.NoError(t, err)
	require.NoError(t, f.svc.DeletePeriod(context.Background(), f.teacher, f.class.ID, period.ID))

	for _, d := range []time.Time{day(2026, 10, 19), day(2026, 10, 21)} {
		s := f.sessionOn(t, d)
		assert.Equal(t, domain.ModeInPerson, s.Mode)
		assert.Equal(t, "B-204", *s.Room)
		assert.Nil(t, s.OnlineURL)
		assert.Nil(t, s.PeriodID)
		assert.Nil(t, s.ChangeReason)
	}
	assert.Len(t, f.repo.periods, 0)
	assert.Len(t, f.repo.outbox, 4, "applying and undoing are two changes")
	require.ErrorIs(t, f.svc.DeletePeriod(context.Background(), f.teacher, f.class.ID, uuid.New()), domain.ErrPeriodNotFound)
}

// Covers SPEC-042 RN-08 and CA-12: a student reads the calendar of the classes with an active enrollment only.
func TestCalendar_StudentReadsOnlyActiveClasses(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	other := service.ClassInfo{ID: uuid.New(), TeacherID: uuid.New(), Name: "Redes", StartDate: day(2026, 10, 1), EndDate: day(2026, 10, 31)}
	f.repo.classes[other.ID] = other
	student := service.Actor{UserID: f.ana.UserID, Role: authn.RoleStudent}
	f.repo.holidays[uuid.New()] = domain.Holiday{Date: day(2026, 10, 12), Name: "Nossa Senhora Aparecida", Scope: domain.HolidayNational, Active: true}

	cal, err := f.svc.ClassCalendar(context.Background(), student, f.class.ID, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	assert.Len(t, cal.Sessions, 5)
	assert.Len(t, cal.Holidays, 1)
	require.Len(t, cal.Classes, 1)

	_, err = f.svc.ClassCalendar(context.Background(), student, other.ID, day(2026, 10, 1), day(2026, 10, 31))
	require.ErrorIs(t, err, domain.ErrClassNotFound, "the class of another enrollment is not revealed")

	mine, err := f.svc.MyCalendar(context.Background(), student, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	require.Len(t, mine.Classes, 1)
	assert.Equal(t, f.class.ID, mine.Classes[0].ID)

	teacherCal, err := f.svc.MyCalendar(context.Background(), f.teacher, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	assert.Len(t, teacherCal.Sessions, 5)

	_, err = f.svc.MyCalendar(context.Background(), student, day(2026, 10, 1), day(2026, 12, 31))
	require.ErrorIs(t, err, domain.ErrRangeTooLarge)
}

// Covers SPEC-042 RN-08 and CA-19.
func TestWriteRequiresOwnerOrAdmin(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	stranger := service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	student := service.Actor{UserID: f.ana.UserID, Role: authn.RoleStudent}
	admin := service.Actor{UserID: uuid.New(), Role: authn.RoleAdmin}
	target := f.sessionOn(t, day(2026, 10, 21))
	change := service.SessionChange{Status: domain.SessionCanceled, StartTime: target.StartTime, EndTime: target.EndTime,
		LessonCount: 2, Mode: domain.ModeInPerson, Reason: str("x")}

	for _, actor := range []service.Actor{stranger, student} {
		_, err := f.svc.ReplaceMeetings(context.Background(), actor, f.class.ID, f.meetings())
		require.ErrorIs(t, err, domain.ErrForbidden)
		_, err = f.svc.UpdateSession(context.Background(), actor, f.class.ID, target.ID, change)
		require.ErrorIs(t, err, domain.ErrForbidden)
		_, _, err = f.svc.ApplyPeriod(context.Background(), actor, f.class.ID, domain.SpecialPeriod{})
		require.ErrorIs(t, err, domain.ErrForbidden)
		_, err = f.svc.CreateEvent(context.Background(), actor, f.class.ID, domain.ClassEvent{})
		require.ErrorIs(t, err, domain.ErrForbidden)
	}
	_, err := f.svc.UpdateSession(context.Background(), admin, f.class.ID, target.ID, change)
	require.NoError(t, err)

	_, err = f.svc.ClassCalendar(context.Background(), stranger, f.class.ID, day(2026, 10, 1), day(2026, 10, 31))
	require.ErrorIs(t, err, domain.ErrForbidden)

	otherClass := uuid.New()
	_, err = f.svc.UpdateSession(context.Background(), f.teacher, otherClass, target.ID, change)
	require.ErrorIs(t, err, domain.ErrClassNotFound)
}

// Covers SPEC-042 RN-09b and CA-13: an activation gets the agenda once.
func TestEnqueueOnEnrollment(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	enrollment := uuid.New()
	f.repo.activation = []service.Activation{{EnrollmentID: enrollment, ClassID: f.class.ID, UserID: f.ana.UserID, Email: f.ana.Email, Name: "Ana"}}

	require.NoError(t, f.svc.SendEnrollmentAgendas(context.Background(), f.now))
	require.NoError(t, f.svc.SendEnrollmentAgendas(context.Background(), f.now))
	require.Len(t, f.repo.outbox, 1)
	it := f.repo.outbox[0]
	assert.Equal(t, service.KindOnEnroll, it.Kind)
	assert.Equal(t, f.ana.Email, it.To)
	assert.Contains(t, it.TextBody, "Segunda-feira, 08:20 às 10:00")
	assert.Contains(t, it.TextBody, "14/10/2026")
	assert.Contains(t, it.HTMLBody, "Sistemas Operacionais")
}

// Covers SPEC-042 RN-09c, D-10, D-12 and CA-14: the reminder goes once per session and only to who wants it.
func TestEnqueueReminders_OncePerSessionRespectsPreference(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	wednesday := f.sessionOn(t, day(2026, 10, 14)) // 13:50: reminder at 11:50 on the same day

	f.now = time.Date(2026, 10, 14, 11, 0, 0, 0, domain.Location())
	require.NoError(t, f.svc.SendReminders(context.Background(), f.now))
	assert.Empty(t, f.repo.outbox, "too early")

	f.now = time.Date(2026, 10, 14, 11, 55, 0, 0, domain.Location())
	require.NoError(t, f.svc.SendReminders(context.Background(), f.now))
	require.NoError(t, f.svc.SendReminders(context.Background(), f.now))
	require.Len(t, f.repo.outbox, 1, "Bruno turned reminders off, and the second pass sends nothing")
	assert.Equal(t, service.KindReminder, f.repo.outbox[0].Kind)
	assert.Equal(t, f.ana.Email, f.repo.outbox[0].To)
	assert.Contains(t, f.repo.outbox[0].TextBody, "13:50")

	_, err := f.svc.UpdateSession(context.Background(), f.teacher, f.class.ID, f.sessionOn(t, day(2026, 10, 19)).ID, service.SessionChange{
		Status: domain.SessionCanceled, StartTime: clk("08:20"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson, Reason: str("x"),
	})
	require.NoError(t, err)
	f.repo.outbox = nil
	f.now = time.Date(2026, 10, 18, 18, 30, 0, 0, domain.Location())
	require.NoError(t, f.svc.SendReminders(context.Background(), f.now))
	assert.Empty(t, f.repo.outbox, "no reminder for a canceled session")
	_ = wednesday
}

// Covers SPEC-042 RN-09d, D-11, D-12 and CA-15.
func TestEnqueueWeeklyDigest_RespectsPreferenceSkipsEmpty(t *testing.T) {
	f := newFixture(t)
	f.setup(t)
	f.now = time.Date(2026, 10, 18, 18, 10, 0, 0, domain.Location())
	require.NoError(t, f.svc.SendWeeklyDigest(context.Background(), f.now))
	require.NoError(t, f.svc.SendWeeklyDigest(context.Background(), f.now.Add(time.Hour)))
	require.Len(t, f.repo.outbox, 1, "only Ana wants the digest, and it goes once per week")
	it := f.repo.outbox[0]
	assert.Equal(t, service.KindDigest, it.Kind)
	assert.Contains(t, it.TextBody, "19/10/2026")
	assert.Contains(t, it.TextBody, "21/10/2026")
	assert.False(t, strings.Contains(it.TextBody, "26/10/2026"))

	f.repo.outbox = nil
	f.now = time.Date(2026, 10, 25, 18, 10, 0, 0, domain.Location()) // next week ends after the validity
	f.repo.classes[f.class.ID] = func() service.ClassInfo { c := f.class; c.EndDate = day(2026, 10, 25); return c }()
	for id, s := range f.repo.sessions {
		if s.Date.After(day(2026, 10, 25)) {
			delete(f.repo.sessions, id)
		}
	}
	require.NoError(t, f.svc.SendWeeklyDigest(context.Background(), f.now))
	assert.Empty(t, f.repo.outbox, "no digest without sessions")

	f.now = time.Date(2026, 10, 19, 18, 10, 0, 0, domain.Location()) // Monday
	require.NoError(t, f.svc.SendWeeklyDigest(context.Background(), f.now))
	assert.Empty(t, f.repo.outbox, "the digest is only on Sunday from 18:00")
}

// Covers SPEC-042 RN-11, D-17 and CA-18.
func TestHolidays_NationalLocked(t *testing.T) {
	f := newFixture(t)
	admin := service.Actor{UserID: uuid.New(), Role: authn.RoleAdmin}
	require.NoError(t, f.svc.RefreshNationalHolidays(context.Background(), f.now))
	list, err := f.svc.Holidays(context.Background(), 2027)
	require.NoError(t, err)
	assert.Len(t, list, 12, "next year is loaded too")

	var national domain.Holiday
	for _, h := range f.repo.holidays {
		if h.Scope == domain.HolidayNational {
			national = h
			break
		}
	}
	require.ErrorIs(t, f.svc.DeleteHoliday(context.Background(), admin, national.ID), domain.ErrNationalLocked)
	national.Active = false
	_, err = f.svc.UpdateHoliday(context.Background(), admin, national.ID, national)
	require.NoError(t, err, "a national holiday can be turned off")

	local, err := f.svc.CreateHoliday(context.Background(), admin, domain.Holiday{Date: day(2026, 11, 3), Name: "Recesso UTFPR", Scope: domain.HolidayRecess})
	require.NoError(t, err)
	assert.True(t, local.Active)
	_, err = f.svc.CreateHoliday(context.Background(), admin, domain.Holiday{Date: day(2026, 11, 4), Name: "X", Scope: domain.HolidayNational})
	require.ErrorIs(t, err, domain.ErrInvalidHoliday, "national holidays are not created by hand")
	require.NoError(t, f.svc.DeleteHoliday(context.Background(), admin, local.ID))

	_, err = f.svc.CreateHoliday(context.Background(), f.teacher, domain.Holiday{Date: day(2026, 11, 3), Name: "Y", Scope: domain.HolidayLocal})
	require.ErrorIs(t, err, domain.ErrForbidden)
	require.ErrorIs(t, f.svc.DeleteHoliday(context.Background(), admin, uuid.New()), domain.ErrHolidayNotFound)
}

// Covers SPEC-042 RN-10 and D-12: a student turns off the reminder and the digest.
func TestPreferences(t *testing.T) {
	f := newFixture(t)
	student := service.Actor{UserID: f.ana.UserID, Role: authn.RoleStudent}
	off := false
	got, err := f.svc.SetPreferences(context.Background(), student, service.Preferences{SessionReminders: &off})
	require.NoError(t, err)
	assert.Equal(t, service.Preferences{SessionReminders: &off, WeeklyDigest: func() *bool { b := true; return &b }()}, got)
	_, err = f.svc.SetPreferences(context.Background(), f.teacher, service.Preferences{})
	require.ErrorIs(t, err, domain.ErrForbidden)
}

var _ = database.Model{}
