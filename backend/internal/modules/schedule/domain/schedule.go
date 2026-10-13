// Package domain defines the schedule of a class (SPEC-042): weekly meetings, the sessions they generate, extra
// sessions, events, special periods, holidays and the outbox of e-mails, with their rules.
package domain

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Mode is how a session happens.
type Mode string

const (
	ModeInPerson Mode = "IN_PERSON"
	ModeOnline   Mode = "ONLINE"
)

// SessionStatus is the state of a session.
type SessionStatus string

const (
	SessionScheduled SessionStatus = "SCHEDULED"
	SessionCanceled  SessionStatus = "CANCELED"
)

// SessionOrigin tells whether a session comes from a weekly meeting or was added by hand.
type SessionOrigin string

const (
	OriginWeekly SessionOrigin = "WEEKLY"
	OriginExtra  SessionOrigin = "EXTRA"
)

// PeriodAction is what a special period does to the sessions inside it (SPEC-042 RN-07, D-15).
type PeriodAction string

const (
	PeriodNoClasses PeriodAction = "NO_CLASSES"
	PeriodOnline    PeriodAction = "ONLINE"
)

// HolidayScope is the kind of a holiday.
type HolidayScope string

const (
	HolidayNational HolidayScope = "NATIONAL"
	HolidayLocal    HolidayScope = "LOCAL"
	HolidayRecess   HolidayScope = "RECESS"
)

// Limits of the schedule (SPEC-042, sections 3.2 and 4).
const (
	MinLessons      = 1
	MaxLessons      = 8
	MaxRoomLength   = 60
	MaxReasonLength = 300
	MaxTitleLength  = 120
	MaxDescLength   = 1000
	MaxLabelLength  = 80
	MaxNameLength   = 120
)

// Domain errors.
var (
	ErrInvalidMeeting  = errors.New("invalid weekly meeting")
	ErrMeetingsOverlap = errors.New("weekly meetings on the same day overlap")
	ErrInvalidSession  = errors.New("invalid class session")
	ErrReasonRequired  = errors.New("a canceled session needs a reason")
	ErrInvalidEvent    = errors.New("invalid class event")
	ErrInvalidPeriod   = errors.New("invalid special period")
	ErrNotExtraSession = errors.New("only an extra session can be deleted")
	ErrNationalLocked  = errors.New("a national holiday cannot be deleted")
	ErrInvalidHoliday  = errors.New("invalid holiday")
	ErrRangeTooLarge   = errors.New("the calendar range is too large")
	ErrSessionNotFound = errors.New("class session not found")
	ErrEventNotFound   = errors.New("class event not found")
	ErrPeriodNotFound  = errors.New("special period not found")
	ErrHolidayNotFound = errors.New("holiday not found")
	ErrForbidden       = errors.New("you are not allowed to change this schedule")
	ErrClassNotFound   = errors.New("class not found")
)

// FieldError tells which field broke a rule. It matches the sentinel it wraps.
type FieldError struct {
	Field string
	Err   error
}

func (e *FieldError) Error() string { return e.Field + ": " + e.Err.Error() }

// Unwrap returns the sentinel error.
func (e *FieldError) Unwrap() error { return e.Err }

func fieldError(field string, err error) error { return &FieldError{Field: field, Err: err} }

var location = mustLoadLocation("America/Sao_Paulo")

func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("load time zone %s: %v", name, err))
	}
	return loc
}

// Location is the time zone of the schedule (SPEC-042 RN-13).
func Location() *time.Location { return location }

// Day returns the calendar day of t, at midnight in the schedule time zone.
func Day(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, location)
}

// Clock is a time of day in minutes since midnight, stored in a PostgreSQL time column.
type Clock int

// ParseClock reads "HH:MM" or "HH:MM:SS".
func ParseClock(s string) (Clock, error) {
	var h, m, sec int
	n, err := fmt.Sscanf(s, "%d:%d:%d", &h, &m, &sec)
	if err != nil && n < 2 {
		return 0, fmt.Errorf("invalid time of day %q", s)
	}
	if len(s) < 5 || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, fmt.Errorf("invalid time of day %q", s)
	}
	return Clock(h*60 + m), nil
}

// String returns "HH:MM".
func (c Clock) String() string { return fmt.Sprintf("%02d:%02d", int(c)/60, int(c)%60) }

// At returns the instant of this time of day on day.
func (c Clock) At(day time.Time) time.Time {
	d := Day(day)
	return time.Date(d.Year(), d.Month(), d.Day(), int(c)/60, int(c)%60, 0, 0, location)
}

// Value writes the clock as a PostgreSQL time.
func (c Clock) Value() (driver.Value, error) { return c.String() + ":00", nil }

// Scan reads a PostgreSQL time.
func (c *Clock) Scan(src any) error {
	switch v := src.(type) {
	case string:
		parsed, err := ParseClock(v)
		*c = parsed
		return err
	case []byte:
		parsed, err := ParseClock(string(v))
		*c = parsed
		return err
	case time.Time:
		*c = Clock(v.Hour()*60 + v.Minute())
		return nil
	default:
		return fmt.Errorf("cannot scan %T into Clock", src)
	}
}

func validHTTPS(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && u.Scheme == "https" && u.Host != ""
}

func validPlace(mode Mode, room, onlineURL *string) error {
	switch mode {
	case ModeInPerson:
		if room != nil && utf8.RuneCountInString(*room) > MaxRoomLength {
			return fieldError("room", ErrInvalidMeeting)
		}
	case ModeOnline:
		if onlineURL == nil || !validHTTPS(*onlineURL) {
			return fieldError("onlineUrl", ErrInvalidMeeting)
		}
	default:
		return fieldError("mode", ErrInvalidMeeting)
	}
	return nil
}

// WeeklyMeeting is a fixed time of the class on a day of the week (SPEC-042 RN-01).
type WeeklyMeeting struct {
	database.Model
	ClassID     uuid.UUID
	Weekday     int
	StartTime   Clock
	EndTime     Clock
	LessonCount int
	Mode        Mode
	Room        *string
	OnlineURL   *string `gorm:"column:online_url"`
}

// TableName maps WeeklyMeeting to its table.
func (WeeklyMeeting) TableName() string { return "class_weekly_meetings" }

// Validate checks one meeting (SPEC-042 RN-01).
func (m WeeklyMeeting) Validate() error {
	if m.Weekday < 0 || m.Weekday > 6 {
		return fieldError("weekday", ErrInvalidMeeting)
	}
	if m.EndTime <= m.StartTime {
		return fieldError("endTime", ErrInvalidMeeting)
	}
	if m.LessonCount < MinLessons || m.LessonCount > MaxLessons {
		return fieldError("lessonCount", ErrInvalidMeeting)
	}
	return validPlace(m.Mode, m.Room, m.OnlineURL)
}

// ValidateMeetings checks every meeting and that meetings on the same day do not overlap (SPEC-042 RN-01, D-09).
func ValidateMeetings(meetings []WeeklyMeeting) error {
	for i, m := range meetings {
		if err := m.Validate(); err != nil {
			return err
		}
		for _, other := range meetings[i+1:] {
			if other.Weekday == m.Weekday && other.StartTime < m.EndTime && m.StartTime < other.EndTime {
				return ErrMeetingsOverlap
			}
		}
	}
	return nil
}

// SessionDate is a date on which a meeting happens; Meeting is the index of the meeting in the input.
type SessionDate struct {
	Date    time.Time
	Meeting int
}

// GenerateSessionDates lists, from first to last (both included), each date on which a meeting happens, ordered by
// date and start time (SPEC-042 RN-02).
func GenerateSessionDates(meetings []WeeklyMeeting, first, last time.Time) []SessionDate {
	var out []SessionDate
	start, end := Day(first), Day(last)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		var today []SessionDate
		for i, m := range meetings {
			if int(d.Weekday()) == m.Weekday {
				today = append(today, SessionDate{Date: d, Meeting: i})
			}
		}
		sort.SliceStable(today, func(a, b int) bool {
			return meetings[today[a].Meeting].StartTime < meetings[today[b].Meeting].StartTime
		})
		out = append(out, today...)
	}
	return out
}

// ClassSession is one session of a class on a date (SPEC-042, section 4).
type ClassSession struct {
	database.Model
	ClassID        uuid.UUID
	MeetingID      *uuid.UUID
	Date           time.Time `gorm:"type:date"`
	StartTime      Clock
	EndTime        Clock
	LessonCount    int
	Mode           Mode
	Room           *string
	OnlineURL      *string `gorm:"column:online_url"`
	Status         SessionStatus
	Origin         SessionOrigin
	Overridden     bool
	ChangeReason   *string
	PeriodID       *uuid.UUID
	OnHoliday      bool
	ReminderSentAt *time.Time
}

// TableName maps ClassSession to its table.
func (ClassSession) TableName() string { return "class_sessions" }

// Validate checks the times, the lesson count and the place of a session (SPEC-042 RN-04, RN-05).
func (s ClassSession) Validate() error {
	if s.EndTime <= s.StartTime {
		return fieldError("endTime", ErrInvalidSession)
	}
	if s.LessonCount < MinLessons || s.LessonCount > MaxLessons {
		return fieldError("lessonCount", ErrInvalidSession)
	}
	if err := validPlace(s.Mode, s.Room, s.OnlineURL); err != nil {
		var fe *FieldError
		errors.As(err, &fe)
		return fieldError(fe.Field, ErrInvalidSession)
	}
	if s.Status == SessionCanceled && (s.ChangeReason == nil || strings.TrimSpace(*s.ChangeReason) == "") {
		return fieldError("changeReason", ErrReasonRequired)
	}
	if s.ChangeReason != nil && utf8.RuneCountInString(*s.ChangeReason) > MaxReasonLength {
		return fieldError("changeReason", ErrInvalidSession)
	}
	return nil
}

// FromMeeting returns the session a meeting generates on day.
func FromMeeting(classID uuid.UUID, m WeeklyMeeting, day time.Time) ClassSession {
	id := m.ID
	return ClassSession{
		ClassID: classID, MeetingID: &id, Date: Day(day), StartTime: m.StartTime, EndTime: m.EndTime,
		LessonCount: m.LessonCount, Mode: m.Mode, Room: m.Room, OnlineURL: m.OnlineURL,
		Status: SessionScheduled, Origin: OriginWeekly,
	}
}

// ClassEvent is a talk, visit or activity shown to the students of a class (SPEC-042 RN-06, D-16).
type ClassEvent struct {
	database.Model
	ClassID     uuid.UUID
	Title       string
	Description string
	Date        time.Time `gorm:"type:date"`
	AllDay      bool
	StartTime   *Clock
	EndTime     *Clock
	Location    *string
	OnlineURL   *string `gorm:"column:online_url"`
}

// TableName maps ClassEvent to its table.
func (ClassEvent) TableName() string { return "class_events" }

// Validate checks an event (SPEC-042 RN-06).
func (e ClassEvent) Validate() error {
	title := strings.TrimSpace(e.Title)
	if title == "" || utf8.RuneCountInString(title) > MaxTitleLength {
		return fieldError("title", ErrInvalidEvent)
	}
	if utf8.RuneCountInString(e.Description) > MaxDescLength {
		return fieldError("description", ErrInvalidEvent)
	}
	if !e.AllDay && (e.StartTime == nil || e.EndTime == nil || *e.EndTime <= *e.StartTime) {
		return fieldError("endTime", ErrInvalidEvent)
	}
	if e.Location != nil && utf8.RuneCountInString(*e.Location) > MaxTitleLength {
		return fieldError("location", ErrInvalidEvent)
	}
	if e.OnlineURL != nil && *e.OnlineURL != "" && !validHTTPS(*e.OnlineURL) {
		return fieldError("onlineUrl", ErrInvalidEvent)
	}
	return nil
}

// SpecialPeriod is a range of days whose sessions are suspended or online (SPEC-042 RN-07).
type SpecialPeriod struct {
	database.Model
	ClassID   uuid.UUID
	FirstDay  time.Time `gorm:"type:date"`
	LastDay   time.Time `gorm:"type:date"`
	Action    PeriodAction
	Label     string
	OnlineURL *string `gorm:"column:online_url"`
}

// TableName maps SpecialPeriod to its table.
func (SpecialPeriod) TableName() string { return "special_periods" }

// Validate checks a special period (SPEC-042 RN-07).
func (p SpecialPeriod) Validate() error {
	if Day(p.LastDay).Before(Day(p.FirstDay)) {
		return fieldError("lastDay", ErrInvalidPeriod)
	}
	label := strings.TrimSpace(p.Label)
	if label == "" || utf8.RuneCountInString(label) > MaxLabelLength {
		return fieldError("label", ErrInvalidPeriod)
	}
	switch p.Action {
	case PeriodNoClasses:
	case PeriodOnline:
		if p.OnlineURL == nil || !validHTTPS(*p.OnlineURL) {
			return fieldError("onlineUrl", ErrInvalidPeriod)
		}
	default:
		return fieldError("action", ErrInvalidPeriod)
	}
	return nil
}

// Holiday is a day without classes by default; sessions on it are only flagged (SPEC-042 RN-03, RN-11).
type Holiday struct {
	database.Model
	Date   time.Time `gorm:"type:date"`
	Name   string
	Scope  HolidayScope
	Active bool
}

// TableName maps Holiday to its table.
func (Holiday) TableName() string { return "holidays" }

// Validate checks a holiday.
func (h Holiday) Validate() error {
	name := strings.TrimSpace(h.Name)
	if name == "" || utf8.RuneCountInString(name) > MaxNameLength {
		return fieldError("name", ErrInvalidHoliday)
	}
	switch h.Scope {
	case HolidayNational, HolidayLocal, HolidayRecess:
	default:
		return fieldError("scope", ErrInvalidHoliday)
	}
	return nil
}

// HolidaySeed is a national holiday of a year.
type HolidaySeed struct {
	Date time.Time
	Name string
}

// Easter returns Easter Sunday of year (anonymous Gregorian algorithm, Meeus/Jones/Butcher).
func Easter(year int) time.Time {
	a := year % 19
	b := year / 100
	c := year % 100
	d := b / 4
	e := b % 4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i := c / 4
	k := c % 4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, location)
}

// NationalHolidays returns the fixed and the movable national holidays of year (SPEC-042 RN-11).
func NationalHolidays(year int) []HolidaySeed {
	on := func(m time.Month, d int) time.Time { return time.Date(year, m, d, 0, 0, 0, 0, location) }
	easter := Easter(year)
	return []HolidaySeed{
		{on(time.January, 1), "Confraternização Universal"},
		{easter.AddDate(0, 0, -47), "Carnaval"},
		{easter.AddDate(0, 0, -2), "Sexta-feira Santa"},
		{on(time.April, 21), "Tiradentes"},
		{on(time.May, 1), "Dia do Trabalhador"},
		{easter.AddDate(0, 0, 60), "Corpus Christi"},
		{on(time.September, 7), "Independência do Brasil"},
		{on(time.October, 12), "Nossa Senhora Aparecida"},
		{on(time.November, 2), "Finados"},
		{on(time.November, 15), "Proclamação da República"},
		{on(time.November, 20), "Dia Nacional de Zumbi e da Consciência Negra"},
		{on(time.December, 25), "Natal"},
	}
}

// morningEnds is the start time from which a session is reminded 2 hours before instead of on the eve (D-10).
const morningEnds = Clock(12 * 60)

// ReminderAt is when the reminder of a session starting at start on day goes out (SPEC-042 D-10).
func ReminderAt(day time.Time, start Clock) time.Time {
	if start < morningEnds {
		eve := Day(day).AddDate(0, 0, -1)
		return time.Date(eve.Year(), eve.Month(), eve.Day(), 18, 0, 0, 0, location)
	}
	return start.At(day).Add(-2 * time.Hour)
}

// NextWeek returns Monday and Sunday of the week after the one of now (SPEC-042 D-11).
func NextWeek(now time.Time) (time.Time, time.Time) {
	today := Day(now.In(location))
	// Days until next Monday: Sunday (0) gives 1, Monday (1) gives 7.
	ahead := (8 - int(today.Weekday())) % 7
	if ahead == 0 {
		ahead = 7
	}
	first := today.AddDate(0, 0, ahead)
	return first, first.AddDate(0, 0, 6)
}

// IsDigestTime tells whether the weekly digest is due: Sunday from 18:00 (SPEC-042 D-11).
func IsDigestTime(now time.Time) bool {
	local := now.In(location)
	return local.Weekday() == time.Sunday && local.Hour() >= 18
}
