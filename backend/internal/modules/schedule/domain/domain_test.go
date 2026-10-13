package domain_test

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

func clock(t *testing.T, s string) domain.Clock {
	t.Helper()
	c, err := domain.ParseClock(s)
	require.NoError(t, err)
	return c
}

func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, domain.Location())
}

func ptr(s string) *string { return &s }

func meeting(t *testing.T, weekday int, start, end string) domain.WeeklyMeeting {
	return domain.WeeklyMeeting{
		Weekday: weekday, StartTime: clock(t, start), EndTime: clock(t, end), LessonCount: 2, Mode: domain.ModeInPerson,
	}
}

func TestClock_ParseAndString(t *testing.T) {
	c := clock(t, "08:20")
	assert.Equal(t, domain.Clock(8*60+20), c)
	assert.Equal(t, "08:20", c.String())
	for _, bad := range []string{"", "8h", "24:00", "12:60", "-1:00"} {
		_, err := domain.ParseClock(bad)
		assert.Error(t, err, bad)
	}
}

// Covers SPEC-042 RN-01 and CA-02.
func TestWeeklyMeeting_Validate(t *testing.T) {
	ok := meeting(t, 1, "08:20", "10:00")
	require.NoError(t, ok.Validate())

	online := ok
	online.Mode = domain.ModeOnline
	online.OnlineURL = ptr("https://meet.google.com/abc-defg-hij")
	require.NoError(t, online.Validate())

	cases := map[string]func(m *domain.WeeklyMeeting){
		"weekday":     func(m *domain.WeeklyMeeting) { m.Weekday = 7 },
		"endTime":     func(m *domain.WeeklyMeeting) { m.EndTime = m.StartTime },
		"lessonCount": func(m *domain.WeeklyMeeting) { m.LessonCount = 9 },
		"mode":        func(m *domain.WeeklyMeeting) { m.Mode = "REMOTE" },
		"room":        func(m *domain.WeeklyMeeting) { m.Room = ptr(string(make([]byte, 61))) },
		"onlineUrl":   func(m *domain.WeeklyMeeting) { m.Mode = domain.ModeOnline },
		"onlineUrlHttp": func(m *domain.WeeklyMeeting) {
			m.Mode = domain.ModeOnline
			m.OnlineURL = ptr("http://meet.example.com")
		},
	}
	for name, change := range cases {
		m := ok
		change(&m)
		err := m.Validate()
		require.ErrorIs(t, err, domain.ErrInvalidMeeting, name)
		var verr *domain.FieldError
		require.True(t, errors.As(err, &verr), name)
		assert.NotEmpty(t, verr.Field, name)
	}
}

// Covers SPEC-042 RN-01, D-09 and CA-02: meetings on the same day may touch but not overlap.
func TestMeetings_Overlap(t *testing.T) {
	require.NoError(t, domain.ValidateMeetings([]domain.WeeklyMeeting{
		meeting(t, 1, "08:20", "10:00"), meeting(t, 1, "10:00", "11:40"), meeting(t, 3, "08:20", "10:00"),
	}))
	require.ErrorIs(t, domain.ValidateMeetings([]domain.WeeklyMeeting{
		meeting(t, 1, "08:20", "10:00"), meeting(t, 1, "09:00", "11:40"),
	}), domain.ErrMeetingsOverlap)
	require.ErrorIs(t, domain.ValidateMeetings([]domain.WeeklyMeeting{meeting(t, 8, "08:20", "10:00")}), domain.ErrInvalidMeeting)
}

// Covers SPEC-042 RN-02 and CA-01: one date per meeting weekday inside the validity, across months and years.
func TestGenerateSessionDates(t *testing.T) {
	meetings := []domain.WeeklyMeeting{
		meeting(t, 3, "13:50", "15:30"), // Wednesday
		meeting(t, 1, "10:00", "11:40"), // Monday, second slot
		meeting(t, 1, "08:20", "10:00"), // Monday, first slot
	}
	// 2026-12-28 is a Monday; the range crosses into 2027.
	got := domain.GenerateSessionDates(meetings, date(2026, 12, 28), date(2027, 1, 6))
	type pair struct {
		day   string
		index int
	}
	var pairs []pair
	for _, s := range got {
		pairs = append(pairs, pair{s.Date.Format("2006-01-02"), s.Meeting})
	}
	assert.Equal(t, []pair{
		{"2026-12-28", 2}, {"2026-12-28", 1}, {"2026-12-30", 0},
		{"2027-01-04", 2}, {"2027-01-04", 1}, {"2027-01-06", 0},
	}, pairs)
	assert.Empty(t, domain.GenerateSessionDates(meetings, date(2027, 1, 6), date(2027, 1, 5)))
}

// Covers SPEC-042 RN-11 and CA-17.
func TestEasterAndMoveableHolidays(t *testing.T) {
	easter := map[int]string{
		2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28",
		2028: "2028-04-16", 2029: "2029-04-01", 2030: "2030-04-21",
	}
	for year, want := range easter {
		assert.Equal(t, want, domain.Easter(year).Format("2006-01-02"), year)
	}

	byName := map[string]string{}
	for _, h := range domain.NationalHolidays(2026) {
		byName[h.Name] = h.Date.Format("2006-01-02")
	}
	assert.Equal(t, "2026-02-17", byName["Carnaval"])
	assert.Equal(t, "2026-04-03", byName["Sexta-feira Santa"])
	assert.Equal(t, "2026-06-04", byName["Corpus Christi"])
	assert.Equal(t, "2026-01-01", byName["Confraternização Universal"])
	assert.Equal(t, "2026-11-20", byName["Dia Nacional de Zumbi e da Consciência Negra"])
	assert.Len(t, domain.NationalHolidays(2026), 12)
}

// Covers SPEC-042 D-10 and CA-14: morning sessions on the eve at 18:00, the others 2 hours before.
func TestReminderTime(t *testing.T) {
	loc := domain.Location()
	assert.Equal(t, time.Date(2026, 10, 18, 18, 0, 0, 0, loc), domain.ReminderAt(date(2026, 10, 19), clock(t, "08:20")))
	assert.Equal(t, time.Date(2026, 10, 18, 18, 0, 0, 0, loc), domain.ReminderAt(date(2026, 10, 19), clock(t, "11:59")))
	assert.Equal(t, time.Date(2026, 10, 19, 11, 50, 0, 0, loc), domain.ReminderAt(date(2026, 10, 19), clock(t, "13:50")))
	assert.Equal(t, time.Date(2026, 10, 31, 18, 0, 0, 0, loc), domain.ReminderAt(date(2026, 11, 1), clock(t, "07:30")))
}

// Covers SPEC-042 D-11 and CA-15: the digest covers Monday to Sunday of the next week.
func TestNextWeekRange(t *testing.T) {
	loc := domain.Location()
	first, last := domain.NextWeek(time.Date(2026, 10, 18, 18, 0, 0, 0, loc)) // Sunday
	assert.Equal(t, "2026-10-19", first.Format("2006-01-02"))
	assert.Equal(t, "2026-10-25", last.Format("2006-01-02"))
	first, last = domain.NextWeek(time.Date(2026, 12, 27, 18, 0, 0, 0, loc)) // Sunday before New Year
	assert.Equal(t, "2026-12-28", first.Format("2006-01-02"))
	assert.Equal(t, "2027-01-03", last.Format("2006-01-02"))
	assert.True(t, domain.IsDigestTime(time.Date(2026, 10, 18, 18, 5, 0, 0, loc)))
	assert.False(t, domain.IsDigestTime(time.Date(2026, 10, 18, 17, 59, 0, 0, loc)))
	assert.False(t, domain.IsDigestTime(time.Date(2026, 10, 19, 18, 5, 0, 0, loc)))
}

// Covers SPEC-042 RN-07: a period has its first day before or on its last day, and ONLINE needs a link.
func TestSpecialPeriod_Validate(t *testing.T) {
	p := domain.SpecialPeriod{FirstDay: date(2026, 10, 19), LastDay: date(2026, 10, 23), Action: domain.PeriodNoClasses, Label: "Semana de preparação"}
	require.NoError(t, p.Validate())
	bad := p
	bad.LastDay = date(2026, 10, 18)
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidPeriod)
	bad = p
	bad.Action = domain.PeriodOnline
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidPeriod)
	bad = p
	bad.Label = ""
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidPeriod)
}

// Covers SPEC-042 RN-06.
func TestClassEvent_Validate(t *testing.T) {
	e := domain.ClassEvent{Title: "Palestra sobre o kernel", Date: date(2026, 10, 21), AllDay: true}
	require.NoError(t, e.Validate())
	bad := e
	bad.Title = ""
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidEvent)
	bad = e
	bad.AllDay = false
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidEvent, "a timed event needs start and end")
	start, end := clock(t, "14:00"), clock(t, "16:00")
	bad.StartTime, bad.EndTime = &start, &end
	require.NoError(t, bad.Validate())
	bad.OnlineURL = ptr("ftp://x")
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidEvent)
}

func TestClock_DatabaseRoundTrip(t *testing.T) {
	c := clock(t, "13:50")
	v, err := c.Value()
	require.NoError(t, err)
	assert.Equal(t, "13:50:00", v)

	var got domain.Clock
	require.NoError(t, got.Scan("08:20:00"))
	assert.Equal(t, clock(t, "08:20"), got)
	require.NoError(t, got.Scan([]byte("10:00:00")))
	assert.Equal(t, clock(t, "10:00"), got)
	require.NoError(t, got.Scan(time.Date(0, 1, 1, 7, 30, 0, 0, time.UTC)))
	assert.Equal(t, clock(t, "07:30"), got)
	require.Error(t, got.Scan(42))
	assert.Equal(t, time.Date(2026, 10, 19, 13, 50, 0, 0, domain.Location()), c.At(date(2026, 10, 19)))
}

// Covers SPEC-042 RN-04 and RN-05.
func TestClassSession_Validate(t *testing.T) {
	m := meeting(t, 1, "08:20", "10:00")
	s := domain.FromMeeting([16]byte{1}, m, time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC))
	assert.Equal(t, "2026-10-19", s.Date.Format("2006-01-02"))
	assert.Equal(t, domain.OriginWeekly, s.Origin)
	assert.Equal(t, domain.SessionScheduled, s.Status)
	require.NoError(t, s.Validate())

	bad := s
	bad.EndTime = bad.StartTime
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidSession)
	bad = s
	bad.LessonCount = 0
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidSession)
	bad = s
	bad.Mode = domain.ModeOnline
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidSession)
	bad = s
	bad.Status = domain.SessionCanceled
	require.ErrorIs(t, bad.Validate(), domain.ErrReasonRequired)
	bad.ChangeReason = ptr(string(make([]rune, 301)))
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidSession)
	bad.ChangeReason = ptr("Feriado")
	require.NoError(t, bad.Validate())
}

func TestHoliday_Validate(t *testing.T) {
	h := domain.Holiday{Date: date(2026, 11, 3), Name: "Recesso", Scope: domain.HolidayRecess, Active: true}
	require.NoError(t, h.Validate())
	bad := h
	bad.Name = " "
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidHoliday)
	bad = h
	bad.Scope = "STATE"
	require.ErrorIs(t, bad.Validate(), domain.ErrInvalidHoliday)
}

func TestEventAndPeriod_MoreRules(t *testing.T) {
	e := domain.ClassEvent{Title: "Visita", Date: date(2026, 10, 21), AllDay: true, Description: string(make([]rune, 1001))}
	require.ErrorIs(t, e.Validate(), domain.ErrInvalidEvent)
	e.Description = ""
	e.Location = ptr(string(make([]rune, 121)))
	require.ErrorIs(t, e.Validate(), domain.ErrInvalidEvent)

	p := domain.SpecialPeriod{FirstDay: date(2026, 10, 19), LastDay: date(2026, 10, 19), Action: "OTHER", Label: "x"}
	require.ErrorIs(t, p.Validate(), domain.ErrInvalidPeriod)
	p.Action = domain.PeriodOnline
	p.OnlineURL = ptr("https://meet.google.com/x")
	require.NoError(t, p.Validate())
	var fe *domain.FieldError
	require.True(t, errors.As(domain.SpecialPeriod{Action: domain.PeriodNoClasses}.Validate(), &fe))
	assert.Contains(t, fe.Error(), "label")
}
