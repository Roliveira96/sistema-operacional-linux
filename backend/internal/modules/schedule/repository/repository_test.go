package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
)

type env struct {
	ctx     context.Context
	db      *database.DB
	repo    *repository.Repository
	teacher userdomain.User
	student userdomain.User
	class   classdomain.ClassGroup
}

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, domain.Location())
}

func clk(s string) domain.Clock {
	c, _ := domain.ParseClock(s)
	return c
}

func str(s string) *string { return &s }

func newEnv(t *testing.T) env {
	t.Helper()
	db := dbtest.Open(t)
	e := env{ctx: context.Background(), db: db, repo: repository.New(db)}
	users := userrepository.New(db)
	name := "Profa. Sediane"
	e.teacher = userdomain.User{Name: &name, Email: "prof@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(e.ctx, &e.teacher))
	ra, sname := "1000001", "Ana"
	e.student = userdomain.User{Name: &sname, Email: "ana@alunos.utfpr.edu.br", AcademicID: &ra, Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(e.ctx, &e.student))
	now := time.Now()
	e.class = classdomain.ClassGroup{TeacherID: e.teacher.ID, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: day(2026, 10, 1), EndDate: day(2026, 10, 31), Status: classdomain.ClassStatusActive}
	require.NoError(t, classrepository.New(db).CreateClass(e.ctx, &e.class, []uuid.UUID{e.student.ID}, now))
	return e
}

func (e env) meeting(t *testing.T) domain.WeeklyMeeting {
	t.Helper()
	id, _ := uuid.NewV7()
	return domain.WeeklyMeeting{Model: database.Model{ID: id}, ClassID: e.class.ID, Weekday: 1, StartTime: clk("08:20"),
		EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson, Room: str("B-204")}
}

// Covers SPEC-042 RN-02, D-08 and CA-01: one session per meeting and date; regenerating keeps the touched ones.
func TestRepository_SessionUniqueness(t *testing.T) {
	e := newEnv(t)
	m := e.meeting(t)
	first := []domain.ClassSession{domain.FromMeeting(e.class.ID, m, day(2026, 10, 19)), domain.FromMeeting(e.class.ID, m, day(2026, 10, 26))}
	require.NoError(t, e.repo.ReplaceMeetings(e.ctx, e.class.ID, []domain.WeeklyMeeting{m}, day(2026, 10, 13), first))

	sessions, err := e.repo.ListSessions(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	require.Len(t, sessions, 2)
	assert.Equal(t, clk("08:20"), sessions[0].StartTime)
	assert.Equal(t, "2026-10-19", sessions[0].Date.Format("2006-01-02"))

	changed := sessions[0]
	changed.Overridden = true
	changed.Room = str("Auditório")
	require.NoError(t, e.repo.SaveSession(e.ctx, &changed))

	// Regenerating with the same meeting: the changed session stays, the other is rebuilt, nothing is duplicated.
	again := []domain.ClassSession{domain.FromMeeting(e.class.ID, m, day(2026, 10, 19)), domain.FromMeeting(e.class.ID, m, day(2026, 10, 26))}
	require.NoError(t, e.repo.ReplaceMeetings(e.ctx, e.class.ID, []domain.WeeklyMeeting{m}, day(2026, 10, 13), again))
	sessions, err = e.repo.ListSessions(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	require.Len(t, sessions, 2)
	assert.Equal(t, changed.ID, sessions[0].ID)
	assert.Equal(t, "Auditório", *sessions[0].Room)

	meetings, err := e.repo.ListMeetings(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, meetings, 1)
	assert.Equal(t, m.ID, meetings[0].ID)

	// Removing the meeting drops its untouched future sessions.
	require.NoError(t, e.repo.ReplaceMeetings(e.ctx, e.class.ID, nil, day(2026, 10, 13), nil))
	sessions, _ = e.repo.ListSessions(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 1), day(2026, 10, 31))
	require.Len(t, sessions, 1)
	all, err := e.repo.ListAllSessions(e.ctx, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	assert.Len(t, all, 1)
}

// Covers SPEC-042 RN-07 and CA-08, CA-09: the period and its sessions are written together.
func TestRepository_PeriodTransaction(t *testing.T) {
	e := newEnv(t)
	m := e.meeting(t)
	require.NoError(t, e.repo.ReplaceMeetings(e.ctx, e.class.ID, []domain.WeeklyMeeting{m}, day(2026, 10, 1),
		[]domain.ClassSession{domain.FromMeeting(e.class.ID, m, day(2026, 10, 19))}))
	sessions, _ := e.repo.ListSessions(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 19), day(2026, 10, 19))
	require.Len(t, sessions, 1)

	id, _ := uuid.NewV7()
	period := domain.SpecialPeriod{Model: database.Model{ID: id}, ClassID: e.class.ID, FirstDay: day(2026, 10, 19), LastDay: day(2026, 10, 23),
		Action: domain.PeriodNoClasses, Label: "Semana de preparação"}
	s := sessions[0]
	s.Status = domain.SessionCanceled
	s.PeriodID = &period.ID
	s.ChangeReason = str(period.Label)
	require.NoError(t, e.repo.SavePeriod(e.ctx, &period, []domain.ClassSession{s}))

	got, err := e.repo.FindPeriod(e.ctx, period.ID)
	require.NoError(t, err)
	assert.Equal(t, "2026-10-23", got.LastDay.Format("2006-01-02"))
	saved, err := e.repo.FindSession(e.ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.SessionCanceled, saved.Status)
	periods, err := e.repo.ListPeriods(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 20), day(2026, 10, 20))
	require.NoError(t, err)
	assert.Len(t, periods, 1)

	saved.Status = domain.SessionScheduled
	saved.PeriodID = nil
	saved.ChangeReason = nil
	require.NoError(t, e.repo.DeletePeriod(e.ctx, period.ID, []domain.ClassSession{saved}))
	_, err = e.repo.FindPeriod(e.ctx, period.ID)
	require.ErrorIs(t, err, domain.ErrPeriodNotFound)
	restored, _ := e.repo.FindSession(e.ctx, s.ID)
	assert.Equal(t, domain.SessionScheduled, restored.Status)
	assert.Nil(t, restored.PeriodID)
}

// Covers SPEC-042 CA-10, CA-12 and RN-08: the calendar reads by range, and the class data the service needs.
func TestRepository_CalendarRange(t *testing.T) {
	e := newEnv(t)
	start, end := clk("19:00"), clk("21:00")
	event := domain.ClassEvent{ClassID: e.class.ID, Title: "Palestra", Date: day(2026, 10, 22), StartTime: &start, EndTime: &end}
	require.NoError(t, e.repo.SaveEvent(e.ctx, &event))
	extra := domain.ClassSession{ClassID: e.class.ID, Date: day(2026, 10, 24), StartTime: clk("08:00"), EndTime: clk("10:00"),
		LessonCount: 2, Mode: domain.ModeOnline, OnlineURL: str("https://meet.google.com/x"), Status: domain.SessionScheduled, Origin: domain.OriginExtra}
	require.NoError(t, e.repo.SaveSession(e.ctx, &extra))

	events, err := e.repo.ListEvents(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 22), day(2026, 10, 22))
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, clk("19:00"), *events[0].StartTime)
	none, _ := e.repo.ListEvents(e.ctx, []uuid.UUID{e.class.ID}, day(2026, 10, 23), day(2026, 10, 31))
	assert.Empty(t, none)
	foundEvent, err := e.repo.FindEvent(e.ctx, event.ID)
	require.NoError(t, err)
	assert.Equal(t, "Palestra", foundEvent.Title)
	require.NoError(t, e.repo.DeleteEvent(e.ctx, event.ID))
	_, err = e.repo.FindEvent(e.ctx, event.ID)
	require.ErrorIs(t, err, domain.ErrEventNotFound)
	require.NoError(t, e.repo.DeleteSession(e.ctx, extra.ID))
	_, err = e.repo.FindSession(e.ctx, extra.ID)
	require.ErrorIs(t, err, domain.ErrSessionNotFound)

	class, err := e.repo.FindClass(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Equal(t, "orange", class.Color)
	assert.Equal(t, "2026-10-31", class.EndDate.In(domain.Location()).Format("2006-01-02"))
	_, err = e.repo.FindClass(e.ctx, uuid.New())
	require.ErrorIs(t, err, domain.ErrClassNotFound)
	list, err := e.repo.ListClasses(e.ctx, []uuid.UUID{e.class.ID})
	require.NoError(t, err)
	assert.Len(t, list, 1)

	teacherIDs, err := e.repo.TeacherClassIDs(e.ctx, e.teacher.ID)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{e.class.ID}, teacherIDs)
	studentIDs, err := e.repo.StudentClassIDs(e.ctx, e.student.ID)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{e.class.ID}, studentIDs)

	students, err := e.repo.ActiveStudents(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, students, 1)
	assert.Equal(t, service.Recipient{UserID: e.student.ID, Email: e.student.Email, Name: "Ana", Reminders: true, Digest: true}, students[0])

	require.NoError(t, e.repo.SetPreferences(e.ctx, e.student.ID, false, true))
	reminders, digest, err := e.repo.Preferences(e.ctx, e.student.ID)
	require.NoError(t, err)
	assert.False(t, reminders)
	assert.True(t, digest)

	activations, err := e.repo.RecentActivations(e.ctx, time.Now().Add(-time.Hour))
	require.NoError(t, err)
	require.Len(t, activations, 1)
	assert.Equal(t, e.student.ID, activations[0].UserID)
	assert.Equal(t, e.class.ID, activations[0].ClassID)
}

// Covers SPEC-042 RN-11 and CA-17: the migration loads the fixed national holidays and the movable ones are added once.
func TestMigration00026_NationalHolidays(t *testing.T) {
	e := newEnv(t)
	list, err := e.repo.ListHolidays(e.ctx, day(2026, 1, 1), day(2026, 12, 31))
	require.NoError(t, err)
	assert.Len(t, list, 9, "the nine fixed national holidays of 2026")
	for _, h := range list {
		assert.Equal(t, domain.HolidayNational, h.Scope)
		assert.True(t, h.Active)
	}

	require.NoError(t, e.repo.EnsureNationalHolidays(e.ctx, domain.NationalHolidays(2026)))
	require.NoError(t, e.repo.EnsureNationalHolidays(e.ctx, domain.NationalHolidays(2026)))
	list, _ = e.repo.ListHolidays(e.ctx, day(2026, 1, 1), day(2026, 12, 31))
	assert.Len(t, list, 12, "the movable ones are added once")

	local := domain.Holiday{Date: day(2026, 11, 3), Name: "Recesso", Scope: domain.HolidayRecess, Active: true}
	require.NoError(t, e.repo.SaveHoliday(e.ctx, &local))
	found, err := e.repo.FindHoliday(e.ctx, local.ID)
	require.NoError(t, err)
	assert.Equal(t, "Recesso", found.Name)
	require.NoError(t, e.repo.DeleteHoliday(e.ctx, local.ID))
	_, err = e.repo.FindHoliday(e.ctx, local.ID)
	require.ErrorIs(t, err, domain.ErrHolidayNotFound)
}

// Covers SPEC-042 RN-09 and CA-14 to CA-16: the outbox keeps the e-mails, ignores repeated keys and records attempts.
func TestRepository_Outbox(t *testing.T) {
	e := newEnv(t)
	now := time.Now().UTC().Truncate(time.Second)
	item := service.OutboxItem{RecipientUserID: e.student.ID, To: e.student.Email, Kind: service.KindReminder,
		Subject: "Lembrete", TextBody: "texto", HTMLBody: "<p>texto</p>", DedupeKey: "reminder:1", SendAfter: now}
	require.NoError(t, e.repo.Enqueue(e.ctx, []service.OutboxItem{item, item}))
	require.NoError(t, e.repo.Enqueue(e.ctx, []service.OutboxItem{item}))

	store := mailer.NewOutboxStore(e.db)
	due, err := store.Due(e.ctx, now, 10)
	require.NoError(t, err)
	require.Len(t, due, 1, "a repeated key is queued once")
	assert.Equal(t, e.student.Email, due[0].To)

	require.NoError(t, store.MarkRetry(e.ctx, due[0].ID, 1, now.Add(time.Minute), "smtp down"))
	due, _ = store.Due(e.ctx, now, 10)
	assert.Empty(t, due, "not due before its next try")
	due, _ = store.Due(e.ctx, now.Add(time.Minute), 10)
	require.Len(t, due, 1)
	assert.Equal(t, 1, due[0].Attempts)
	require.NoError(t, store.MarkSent(e.ctx, due[0].ID, now))
	due, _ = store.Due(e.ctx, now.Add(time.Hour), 10)
	assert.Empty(t, due)

	other := item
	other.DedupeKey = ""
	require.NoError(t, e.repo.Enqueue(e.ctx, []service.OutboxItem{other}))
	due, _ = store.Due(e.ctx, now, 10)
	require.Len(t, due, 1)
	require.NoError(t, store.MarkFailed(e.ctx, due[0].ID, 4, "smtp down"))
	due, _ = store.Due(e.ctx, now.Add(time.Hour), 10)
	assert.Empty(t, due)
}
