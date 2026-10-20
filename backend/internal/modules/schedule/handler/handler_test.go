package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeValidator struct{ principal authn.Principal }

func (f *fakeValidator) Authenticate(ctx context.Context, token string) (authn.Principal, error) {
	return f.principal, nil
}

// fakeService records the last call and returns err when set.
type fakeService struct {
	err      error
	actor    service.Actor
	classID  uuid.UUID
	meetings []domain.WeeklyMeeting
	change   service.SessionChange
	session  domain.ClassSession
	event    domain.ClassEvent
	period   domain.SpecialPeriod
	holiday  domain.Holiday
	from, to time.Time
	prefs    service.Preferences
	year     int
	calendar service.Calendar
	// SPEC-053
	sessionID    uuid.UUID
	savedContent service.ContentInput
	content      service.SessionContent
	// SPEC-073
	timeline service.Timeline
	diary    service.Diary
	// SPEC-074
	mat materialCalls
}

func (f *fakeService) Meetings(ctx context.Context, a service.Actor, classID uuid.UUID) ([]domain.WeeklyMeeting, error) {
	f.actor, f.classID = a, classID
	return f.meetings, f.err
}

func (f *fakeService) ReplaceMeetings(ctx context.Context, a service.Actor, classID uuid.UUID, m []domain.WeeklyMeeting) ([]domain.WeeklyMeeting, error) {
	f.actor, f.classID, f.meetings = a, classID, m
	return m, f.err
}

func (f *fakeService) UpdateSession(ctx context.Context, a service.Actor, classID, sessionID uuid.UUID, c service.SessionChange) (domain.ClassSession, error) {
	f.actor, f.classID, f.change = a, classID, c
	return f.session, f.err
}

// SaveContent records the content sent and answers with the content set in the test (SPEC-053).
func (f *fakeService) SaveContent(ctx context.Context, a service.Actor, classID, sessionID uuid.UUID, in service.ContentInput) (service.SessionContent, error) {
	f.actor, f.classID, f.sessionID, f.savedContent = a, classID, sessionID, in
	return f.content, f.err
}

func (f *fakeService) Content(ctx context.Context, a service.Actor, classID, sessionID uuid.UUID) (service.SessionContent, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	return f.content, f.err
}

func (f *fakeService) RevertSession(ctx context.Context, a service.Actor, classID, sessionID uuid.UUID) (domain.ClassSession, error) {
	return f.session, f.err
}

func (f *fakeService) CreateExtraSession(ctx context.Context, a service.Actor, classID uuid.UUID, s domain.ClassSession) (domain.ClassSession, error) {
	f.session = s
	return s, f.err
}

func (f *fakeService) DeleteExtraSession(ctx context.Context, a service.Actor, classID, sessionID uuid.UUID) error {
	return f.err
}

func (f *fakeService) CreateEvent(ctx context.Context, a service.Actor, classID uuid.UUID, e domain.ClassEvent) (domain.ClassEvent, error) {
	f.event = e
	return e, f.err
}

func (f *fakeService) UpdateEvent(ctx context.Context, a service.Actor, classID, eventID uuid.UUID, e domain.ClassEvent) (domain.ClassEvent, error) {
	f.event = e
	return e, f.err
}

func (f *fakeService) DeleteEvent(ctx context.Context, a service.Actor, classID, eventID uuid.UUID) error {
	return f.err
}

func (f *fakeService) ApplyPeriod(ctx context.Context, a service.Actor, classID uuid.UUID, p domain.SpecialPeriod) (domain.SpecialPeriod, int, error) {
	f.period = p
	return p, 3, f.err
}

func (f *fakeService) DeletePeriod(ctx context.Context, a service.Actor, classID, periodID uuid.UUID) error {
	return f.err
}

func (f *fakeService) ClassCalendar(ctx context.Context, a service.Actor, classID uuid.UUID, from, to time.Time) (service.Calendar, error) {
	f.actor, f.classID, f.from, f.to = a, classID, from, to
	return f.calendar, f.err
}

func (f *fakeService) MyCalendar(ctx context.Context, a service.Actor, from, to time.Time) (service.Calendar, error) {
	f.actor, f.from, f.to = a, from, to
	return f.calendar, f.err
}

func (f *fakeService) Holidays(ctx context.Context, year int) ([]domain.Holiday, error) {
	f.year = year
	return []domain.Holiday{f.holiday}, f.err
}

func (f *fakeService) CreateHoliday(ctx context.Context, a service.Actor, h domain.Holiday) (domain.Holiday, error) {
	f.holiday = h
	return h, f.err
}

func (f *fakeService) UpdateHoliday(ctx context.Context, a service.Actor, id uuid.UUID, h domain.Holiday) (domain.Holiday, error) {
	f.holiday = h
	return h, f.err
}

func (f *fakeService) DeleteHoliday(ctx context.Context, a service.Actor, id uuid.UUID) error {
	return f.err
}

func (f *fakeService) GetPreferences(ctx context.Context, a service.Actor) (service.Preferences, error) {
	return f.prefs, f.err
}

func (f *fakeService) SetPreferences(ctx context.Context, a service.Actor, p service.Preferences) (service.Preferences, error) {
	f.prefs = p
	return p, f.err
}

func setup(role string) (*httptest.Server, *fakeService, uuid.UUID) {
	userID := uuid.New()
	svc := &fakeService{}
	h := handler.New(svc, &fakeValidator{principal: authn.Principal{UserID: userID, Role: role}})
	return httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h)), svc, userID
}

func call(t *testing.T, srv *httptest.Server, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var raw []byte
	switch b := body.(type) {
	case nil:
	case string:
		raw = []byte(b)
	default:
		var err error
		raw, err = json.Marshal(b)
		require.NoError(t, err)
	}
	req, err := http.NewRequest(method, srv.URL+path, bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "session"})
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &out)
	}
	return res.StatusCode, out
}

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, domain.Location())
}

func clk(s string) domain.Clock {
	c, _ := domain.ParseClock(s)
	return c
}

func str(s string) *string { return &s }

// Covers SPEC-042 section 5 (meetings), CA-01, CA-02 and CA-19.
func TestMeetingsRoute(t *testing.T) {
	srv, svc, userID := setup(authn.RoleTeacher)
	defer srv.Close()
	classID := uuid.New()
	path := "/api/v1/classes/" + classID.String() + "/meetings"

	status, body := call(t, srv, http.MethodPut, path, map[string]any{"meetings": []map[string]any{
		{"weekday": 1, "startTime": "08:20", "endTime": "10:00", "lessonCount": 2, "mode": "IN_PERSON", "room": "B-204"},
		{"weekday": 3, "startTime": "13:50", "endTime": "15:30", "lessonCount": 2, "mode": "ONLINE", "onlineUrl": "https://meet.google.com/x"},
	}})
	require.Equal(t, http.StatusOK, status, body)
	require.Len(t, svc.meetings, 2)
	assert.Equal(t, clk("13:50"), svc.meetings[1].StartTime)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	list := body["meetings"].([]any)
	assert.Equal(t, "08:20", list[0].(map[string]any)["startTime"])
	assert.Equal(t, "B-204", list[0].(map[string]any)["room"])

	status, body = call(t, srv, http.MethodPut, path, map[string]any{"meetings": []map[string]any{{"weekday": 1, "startTime": "8h"}}})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-time-format", body["type"])

	status, body = call(t, srv, http.MethodPut, path, "{")
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "malformed-request", body["type"])

	for err, want := range map[error][2]any{
		&domain.FieldError{Field: "onlineUrl", Err: domain.ErrInvalidMeeting}: {http.StatusBadRequest, "invalid-meeting"},
		domain.ErrMeetingsOverlap: {http.StatusBadRequest, "meetings-overlap"},
		domain.ErrForbidden:       {http.StatusForbidden, "forbidden"},
		domain.ErrClassNotFound:   {http.StatusNotFound, "class-not-found"},
	} {
		svc.err = err
		status, body = call(t, srv, http.MethodPut, path, map[string]any{"meetings": []any{}})
		assert.Equal(t, want[0], status, want[1])
		assert.Equal(t, want[1], body["type"])
	}
	svc.err = &domain.FieldError{Field: "onlineUrl", Err: domain.ErrInvalidMeeting}
	_, body = call(t, srv, http.MethodPut, path, map[string]any{"meetings": []any{}})
	assert.Equal(t, "onlineUrl", body["field"])

	svc.err = nil
	svc.meetings = []domain.WeeklyMeeting{{Weekday: 2, StartTime: clk("19:00"), EndTime: clk("22:30"), LessonCount: 4, Mode: domain.ModeInPerson}}
	status, body = call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "22:30", body["meetings"].([]any)[0].(map[string]any)["endTime"])

	status, _ = call(t, srv, http.MethodGet, "/api/v1/classes/abc/meetings", nil)
	assert.Equal(t, http.StatusBadRequest, status)
}

// Covers SPEC-042 section 5 (calendar), CA-10 and CA-12.
func TestCalendarRoute_RangeAndRoles(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	classID := uuid.New()
	sessionID := uuid.New()
	meetingID := uuid.New()
	svc.calendar = service.Calendar{
		Classes: []service.ClassInfo{{ID: classID, Name: "SO", CourseCode: "SO34E", Color: "blue", StartDate: day(2026, 10, 1), EndDate: day(2026, 10, 31)}},
		Sessions: []domain.ClassSession{{Model: database.Model{ID: sessionID}, ClassID: classID, MeetingID: &meetingID, Date: day(2026, 10, 19),
			StartTime: clk("08:20"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson, Status: domain.SessionCanceled,
			Origin: domain.OriginWeekly, Overridden: true, ChangeReason: str("Recesso"), OnHoliday: true}},
		Events:   []domain.ClassEvent{{ClassID: classID, Title: "Palestra", Date: day(2026, 10, 22), AllDay: true}},
		Periods:  []domain.SpecialPeriod{{ClassID: classID, FirstDay: day(2026, 10, 19), LastDay: day(2026, 10, 23), Action: domain.PeriodNoClasses, Label: "Semana"}},
		Holidays: []domain.Holiday{{Date: day(2026, 10, 12), Name: "Nossa Senhora Aparecida", Scope: domain.HolidayNational, Active: true}},
		Meetings: []domain.WeeklyMeeting{{ClassID: classID, Weekday: 1, StartTime: clk("08:20"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson}},
	}
	status, body := call(t, srv, http.MethodGet, "/api/v1/classes/"+classID.String()+"/calendar?from=2026-10-01&to=2026-10-31", nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, "2026-10-01", svc.from.Format("2006-01-02"))
	assert.Equal(t, authn.RoleStudent, svc.actor.Role)
	class := body["classes"].([]any)[0].(map[string]any)
	assert.Equal(t, "blue", class["color"])
	assert.Equal(t, "2026-10-31", class["endDate"])
	session := body["sessions"].([]any)[0].(map[string]any)
	assert.Equal(t, "2026-10-19", session["date"])
	assert.Equal(t, "CANCELED", session["status"])
	assert.Equal(t, "Recesso", session["changeReason"])
	assert.Equal(t, true, session["onHoliday"])
	assert.Equal(t, meetingID.String(), session["meetingId"])
	assert.Equal(t, true, body["events"].([]any)[0].(map[string]any)["allDay"])
	assert.Equal(t, "2026-10-23", body["periods"].([]any)[0].(map[string]any)["lastDay"])
	assert.Equal(t, "NATIONAL", body["holidays"].([]any)[0].(map[string]any)["scope"])
	meeting := body["meetings"].([]any)[0].(map[string]any)
	assert.Equal(t, classID.String(), meeting["classId"])
	assert.Equal(t, float64(2), meeting["lessonCount"])

	status, body = call(t, srv, http.MethodGet, "/api/v1/classes/"+classID.String()+"/calendar?from=2026-10-01", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-date-format", body["type"])

	svc.err = domain.ErrRangeTooLarge
	status, body = call(t, srv, http.MethodGet, "/api/v1/classes/"+classID.String()+"/calendar?from=2026-01-01&to=2026-12-31", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "range-too-large", body["type"])
}

// Covers SPEC-042 section 5 (sessions), CA-05, CA-06 and CA-07.
func TestSessionRoutes(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, sessionID := uuid.New(), uuid.New()
	base := "/api/v1/classes/" + classID.String() + "/sessions"
	svc.session = domain.ClassSession{Model: database.Model{ID: sessionID}, ClassID: classID, Date: day(2026, 10, 21), StartTime: clk("13:50"),
		EndTime: clk("15:30"), LessonCount: 2, Mode: domain.ModeOnline, OnlineURL: str("https://meet.google.com/x"),
		Status: domain.SessionScheduled, Origin: domain.OriginWeekly, Overridden: true}

	status, body := call(t, srv, http.MethodPatch, base+"/"+sessionID.String(), map[string]any{
		"status": "SCHEDULED", "startTime": "13:50", "endTime": "15:30", "lessonCount": 2, "mode": "ONLINE",
		"onlineUrl": "https://meet.google.com/x", "reason": "Aula online hoje",
	})
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, "Aula online hoje", *svc.change.Reason)
	assert.Equal(t, domain.ModeOnline, svc.change.Mode)
	assert.Equal(t, "https://meet.google.com/x", body["onlineUrl"])

	svc.err = domain.ErrReasonRequired
	status, body = call(t, srv, http.MethodPatch, base+"/"+sessionID.String(), map[string]any{"status": "CANCELED", "startTime": "13:50", "endTime": "15:30"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "reason-required", body["type"])
	svc.err = domain.ErrSessionNotFound
	status, body = call(t, srv, http.MethodDelete, base+"/"+sessionID.String()+"/override", nil)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, "session-not-found", body["type"])
	svc.err = nil
	status, _ = call(t, srv, http.MethodDelete, base+"/"+sessionID.String()+"/override", nil)
	assert.Equal(t, http.StatusOK, status)

	status, body = call(t, srv, http.MethodPost, base, map[string]any{
		"date": "2026-10-24", "startTime": "08:00", "endTime": "11:40", "lessonCount": 4, "mode": "IN_PERSON", "room": "Lab 3",
	})
	require.Equal(t, http.StatusCreated, status, body)
	assert.Equal(t, "2026-10-24", svc.session.Date.Format("2006-01-02"))
	assert.Equal(t, "Lab 3", *svc.session.Room)
	status, body = call(t, srv, http.MethodPost, base, map[string]any{"date": "24/10/2026", "startTime": "08:00", "endTime": "10:00"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-date-format", body["type"])

	svc.err = domain.ErrNotExtraSession
	status, body = call(t, srv, http.MethodDelete, base+"/"+sessionID.String(), nil)
	assert.Equal(t, http.StatusConflict, status)
	assert.Equal(t, "not-extra-session", body["type"])
	svc.err = &domain.FieldError{Field: "date", Err: domain.ErrInvalidSession}
	status, body = call(t, srv, http.MethodPost, base, map[string]any{"date": "2026-11-03", "startTime": "08:00", "endTime": "10:00"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-session", body["type"])
	svc.err = nil
	status, _ = call(t, srv, http.MethodDelete, base+"/"+sessionID.String(), nil)
	assert.Equal(t, http.StatusNoContent, status)
}

// Covers SPEC-042 section 5 (events), CA-07.
func TestEventRoutes(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, eventID := uuid.New(), uuid.New()
	base := "/api/v1/classes/" + classID.String() + "/events"

	status, body := call(t, srv, http.MethodPost, base, map[string]any{
		"title": "Palestra: o kernel", "description": "Convidada", "date": "2026-10-22", "startTime": "19:00", "endTime": "21:00",
		"location": "Auditório",
	})
	require.Equal(t, http.StatusCreated, status, body)
	assert.Equal(t, "Palestra: o kernel", svc.event.Title)
	assert.Equal(t, clk("21:00"), *svc.event.EndTime)
	assert.Equal(t, "19:00", body["startTime"])

	status, _ = call(t, srv, http.MethodPatch, base+"/"+eventID.String(), map[string]any{"title": "Adiada", "date": "2026-10-23", "allDay": true})
	require.Equal(t, http.StatusOK, status)
	assert.True(t, svc.event.AllDay)

	svc.err = &domain.FieldError{Field: "title", Err: domain.ErrInvalidEvent}
	status, body = call(t, srv, http.MethodPost, base, map[string]any{"title": "", "date": "2026-10-22", "allDay": true})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-event", body["type"])
	svc.err = domain.ErrEventNotFound
	status, body = call(t, srv, http.MethodDelete, base+"/"+eventID.String(), nil)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, "event-not-found", body["type"])
	svc.err = nil
	status, _ = call(t, srv, http.MethodDelete, base+"/"+eventID.String(), nil)
	assert.Equal(t, http.StatusNoContent, status)
}

// Covers SPEC-042 section 5 (periods), CA-08 and CA-09.
func TestPeriodRoutes(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, periodID := uuid.New(), uuid.New()
	base := "/api/v1/classes/" + classID.String() + "/periods"

	status, body := call(t, srv, http.MethodPost, base, map[string]any{
		"firstDay": "2026-10-19", "lastDay": "2026-10-23", "action": "NO_CLASSES", "label": "Semana de preparação",
	})
	require.Equal(t, http.StatusCreated, status, body)
	assert.Equal(t, domain.PeriodNoClasses, svc.period.Action)
	assert.Equal(t, float64(3), body["affectedSessions"])
	assert.Equal(t, "2026-10-23", body["period"].(map[string]any)["lastDay"])

	svc.err = &domain.FieldError{Field: "lastDay", Err: domain.ErrInvalidPeriod}
	status, body = call(t, srv, http.MethodPost, base, map[string]any{"firstDay": "2026-10-19", "lastDay": "2026-10-23", "action": "NO_CLASSES"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-period", body["type"])
	assert.Equal(t, "lastDay", body["field"])
	svc.err = domain.ErrPeriodNotFound
	status, body = call(t, srv, http.MethodDelete, base+"/"+periodID.String(), nil)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, "period-not-found", body["type"])
	svc.err = nil
	status, _ = call(t, srv, http.MethodDelete, base+"/"+periodID.String(), nil)
	assert.Equal(t, http.StatusNoContent, status)
}

// Covers SPEC-042 section 5 (my calendar), D-05 and CA-12.
func TestMyCalendarRoute(t *testing.T) {
	srv, svc, userID := setup(authn.RoleStudent)
	defer srv.Close()
	status, body := call(t, srv, http.MethodGet, "/api/v1/me/calendar?from=2026-10-01&to=2026-10-31", nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, []any{}, body["sessions"])
	assert.Equal(t, "2026-10-31", svc.to.Format("2006-01-02"))
}

// Covers SPEC-042 section 5 (holidays), D-17 and CA-18.
func TestHolidayRoutes(t *testing.T) {
	srv, svc, _ := setup(authn.RoleAdmin)
	defer srv.Close()
	svc.holiday = domain.Holiday{Date: day(2026, 11, 3), Name: "Recesso", Scope: domain.HolidayRecess, Active: true}
	status, body := call(t, srv, http.MethodGet, "/api/v1/holidays?year=2026", nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, 2026, svc.year)
	assert.Equal(t, "2026-11-03", body["holidays"].([]any)[0].(map[string]any)["date"])

	status, body = call(t, srv, http.MethodGet, "/api/v1/holidays?year=abc", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-year", body["type"])

	status, _ = call(t, srv, http.MethodPost, "/api/v1/holidays", map[string]any{"date": "2026-11-03", "name": "Recesso", "scope": "RECESS"})
	require.Equal(t, http.StatusCreated, status)
	assert.Equal(t, domain.HolidayRecess, svc.holiday.Scope)
	status, _ = call(t, srv, http.MethodPatch, "/api/v1/holidays/"+uuid.New().String(), map[string]any{"date": "2026-11-03", "name": "Recesso", "scope": "RECESS", "active": false})
	require.Equal(t, http.StatusOK, status)
	assert.False(t, svc.holiday.Active)

	svc.err = domain.ErrNationalLocked
	status, body = call(t, srv, http.MethodDelete, "/api/v1/holidays/"+uuid.New().String(), nil)
	assert.Equal(t, http.StatusConflict, status)
	assert.Equal(t, "national-holiday-locked", body["type"])
	svc.err = &domain.FieldError{Field: "scope", Err: domain.ErrInvalidHoliday}
	status, body = call(t, srv, http.MethodPost, "/api/v1/holidays", map[string]any{"date": "2026-11-03", "name": "X", "scope": "NATIONAL"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-holiday", body["type"])
	svc.err = domain.ErrHolidayNotFound
	status, body = call(t, srv, http.MethodDelete, "/api/v1/holidays/"+uuid.New().String(), nil)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, "holiday-not-found", body["type"])
	svc.err = nil
	status, _ = call(t, srv, http.MethodDelete, "/api/v1/holidays/"+uuid.New().String(), nil)
	assert.Equal(t, http.StatusNoContent, status)
}

// Covers SPEC-042 section 5 (preferences), RN-10 and D-12.
func TestNotificationPreferencesRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	on, off := true, false
	svc.prefs = service.Preferences{SessionReminders: &on, WeeklyDigest: &on}
	status, body := call(t, srv, http.MethodGet, "/api/v1/students/me/notifications", nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, true, body["sessionReminders"])

	status, body = call(t, srv, http.MethodPatch, "/api/v1/students/me/notifications", map[string]any{"weeklyDigest": false})
	require.Equal(t, http.StatusOK, status, body)
	require.NotNil(t, svc.prefs.WeeklyDigest)
	assert.Equal(t, off, *svc.prefs.WeeklyDigest)
	assert.Nil(t, svc.prefs.SessionReminders)

	svc.err = domain.ErrForbidden
	status, _ = call(t, srv, http.MethodPatch, "/api/v1/students/me/notifications", map[string]any{})
	assert.Equal(t, http.StatusForbidden, status)
}

// Covers SPEC-042 section 5: malformed ids, dates, times and bodies are refused before reaching the service.
func TestRoutes_RefuseMalformedInput(t *testing.T) {
	srv, _, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id := uuid.New().String(), uuid.New().String()
	cases := []struct {
		method, path string
		body         any
		want         string
	}{
		{http.MethodPatch, "/api/v1/classes/" + classID + "/sessions/x", map[string]any{}, "invalid-uuid"},
		{http.MethodPatch, "/api/v1/classes/" + classID + "/sessions/" + id, map[string]any{"startTime": "x"}, "invalid-time-format"},
		{http.MethodPatch, "/api/v1/classes/" + classID + "/sessions/" + id, map[string]any{"startTime": "08:00", "endTime": "y"}, "invalid-time-format"},
		{http.MethodPatch, "/api/v1/classes/" + classID + "/sessions/" + id, "{", "malformed-request"},
		{http.MethodPost, "/api/v1/classes/" + classID + "/sessions", map[string]any{"date": "2026-10-24", "startTime": "x"}, "invalid-time-format"},
		{http.MethodPost, "/api/v1/classes/" + classID + "/sessions", map[string]any{"date": "2026-10-24", "startTime": "08:00", "endTime": "x"}, "invalid-time-format"},
		{http.MethodDelete, "/api/v1/classes/x/sessions/" + id, nil, "invalid-uuid"},
		{http.MethodDelete, "/api/v1/classes/" + classID + "/sessions/x/override", nil, "invalid-uuid"},
		{http.MethodPost, "/api/v1/classes/" + classID + "/events", map[string]any{"date": "x"}, "invalid-date-format"},
		{http.MethodPost, "/api/v1/classes/" + classID + "/events", map[string]any{"date": "2026-10-22", "startTime": "x"}, "invalid-time-format"},
		{http.MethodPost, "/api/v1/classes/" + classID + "/events", map[string]any{"date": "2026-10-22", "endTime": "x"}, "invalid-time-format"},
		{http.MethodPatch, "/api/v1/classes/" + classID + "/events/x", map[string]any{}, "invalid-uuid"},
		{http.MethodPatch, "/api/v1/classes/" + classID + "/events/" + id, map[string]any{"date": "x"}, "invalid-date-format"},
		{http.MethodDelete, "/api/v1/classes/" + classID + "/events/x", nil, "invalid-uuid"},
		{http.MethodPost, "/api/v1/classes/" + classID + "/periods", map[string]any{"firstDay": "x"}, "invalid-date-format"},
		{http.MethodPost, "/api/v1/classes/" + classID + "/periods", map[string]any{"firstDay": "2026-10-19", "lastDay": "x"}, "invalid-date-format"},
		{http.MethodDelete, "/api/v1/classes/" + classID + "/periods/x", nil, "invalid-uuid"},
		{http.MethodGet, "/api/v1/me/calendar?from=x&to=y", nil, "invalid-date-format"},
		{http.MethodPost, "/api/v1/holidays", map[string]any{"date": "x"}, "invalid-date-format"},
		{http.MethodPatch, "/api/v1/holidays/x", map[string]any{}, "invalid-uuid"},
		{http.MethodPatch, "/api/v1/holidays/" + id, map[string]any{"date": "x"}, "invalid-date-format"},
		{http.MethodDelete, "/api/v1/holidays/x", nil, "invalid-uuid"},
		{http.MethodPatch, "/api/v1/students/me/notifications", "{", "malformed-request"},
		{http.MethodPut, "/api/v1/classes/" + classID + "/meetings", map[string]any{"meetings": []map[string]any{{"startTime": "08:00", "endTime": "x"}}}, "invalid-time-format"},
	}
	for _, tc := range cases {
		status, body := call(t, srv, tc.method, tc.path, tc.body)
		assert.Equal(t, http.StatusBadRequest, status, tc.method+" "+tc.path)
		assert.Equal(t, tc.want, body["type"], tc.method+" "+tc.path)
	}
}

func TestRoutes_ServiceErrors(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id := uuid.New().String(), uuid.New().String()
	svc.err = domain.ErrForbidden
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/classes/" + classID + "/meetings"},
		{http.MethodGet, "/api/v1/me/calendar?from=2026-10-01&to=2026-10-31"},
		{http.MethodGet, "/api/v1/holidays"},
		{http.MethodPatch, "/api/v1/holidays/" + id},
		{http.MethodGet, "/api/v1/students/me/notifications"},
		{http.MethodPatch, "/api/v1/classes/" + classID + "/events/" + id},
	} {
		var body any
		if tc.method == http.MethodPatch {
			body = map[string]any{"date": "2026-10-22", "name": "x", "allDay": true}
		}
		status, _ := call(t, srv, tc.method, tc.path, body)
		assert.Equal(t, http.StatusForbidden, status, tc.path)
	}
	svc.err = errors.New("database down")
	status, body := call(t, srv, http.MethodGet, "/api/v1/classes/"+classID+"/meetings", nil)
	assert.Equal(t, http.StatusInternalServerError, status)
	assert.NotEmpty(t, body["type"])
}
