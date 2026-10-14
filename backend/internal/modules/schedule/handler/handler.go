// Package handler exposes the schedule of a class over HTTP (SPEC-042, section 5).
package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// ScheduleService is what the handler uses from the service.
type ScheduleService interface {
	Meetings(ctx context.Context, actor service.Actor, classID uuid.UUID) ([]domain.WeeklyMeeting, error)
	ReplaceMeetings(ctx context.Context, actor service.Actor, classID uuid.UUID, meetings []domain.WeeklyMeeting) ([]domain.WeeklyMeeting, error)
	UpdateSession(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID, change service.SessionChange) (domain.ClassSession, error)
	RevertSession(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID) (domain.ClassSession, error)
	SaveContent(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID, in service.ContentInput) (service.SessionContent, error)
	Content(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID) (service.SessionContent, error)
	CreateExtraSession(ctx context.Context, actor service.Actor, classID uuid.UUID, session domain.ClassSession) (domain.ClassSession, error)
	DeleteExtraSession(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID) error
	CreateEvent(ctx context.Context, actor service.Actor, classID uuid.UUID, event domain.ClassEvent) (domain.ClassEvent, error)
	UpdateEvent(ctx context.Context, actor service.Actor, classID, eventID uuid.UUID, event domain.ClassEvent) (domain.ClassEvent, error)
	DeleteEvent(ctx context.Context, actor service.Actor, classID, eventID uuid.UUID) error
	ApplyPeriod(ctx context.Context, actor service.Actor, classID uuid.UUID, period domain.SpecialPeriod) (domain.SpecialPeriod, int, error)
	DeletePeriod(ctx context.Context, actor service.Actor, classID, periodID uuid.UUID) error
	ClassCalendar(ctx context.Context, actor service.Actor, classID uuid.UUID, from, to time.Time) (service.Calendar, error)
	MyCalendar(ctx context.Context, actor service.Actor, from, to time.Time) (service.Calendar, error)
	Holidays(ctx context.Context, year int) ([]domain.Holiday, error)
	CreateHoliday(ctx context.Context, actor service.Actor, h domain.Holiday) (domain.Holiday, error)
	UpdateHoliday(ctx context.Context, actor service.Actor, id uuid.UUID, h domain.Holiday) (domain.Holiday, error)
	DeleteHoliday(ctx context.Context, actor service.Actor, id uuid.UUID) error
	GetPreferences(ctx context.Context, actor service.Actor) (service.Preferences, error)
	SetPreferences(ctx context.Context, actor service.Actor, p service.Preferences) (service.Preferences, error)
}

// Handler serves the schedule routes.
type Handler struct {
	svc  ScheduleService
	auth authn.Validator
}

// New creates the handler.
func New(svc ScheduleService, auth authn.Validator) *Handler { return &Handler{svc: svc, auth: auth} }

// Register wires the routes under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("", authn.Required(h.auth), authn.PasswordChanged())
	g.GET("/classes/:id/meetings", h.listMeetings)
	g.PUT("/classes/:id/meetings", h.replaceMeetings)
	g.GET("/classes/:id/calendar", h.classCalendar)
	g.POST("/classes/:id/sessions", h.createSession)
	g.PATCH("/classes/:id/sessions/:sessionId", h.updateSession)
	g.DELETE("/classes/:id/sessions/:sessionId", h.deleteSession)
	g.DELETE("/classes/:id/sessions/:sessionId/override", h.revertSession)
	g.PUT("/classes/:id/sessions/:sessionId/content", h.saveContent)
	g.GET("/classes/:id/sessions/:sessionId/content", h.content)
	g.POST("/classes/:id/events", h.createEvent)
	g.PATCH("/classes/:id/events/:eventId", h.updateEvent)
	g.DELETE("/classes/:id/events/:eventId", h.deleteEvent)
	g.POST("/classes/:id/periods", h.createPeriod)
	g.DELETE("/classes/:id/periods/:periodId", h.deletePeriod)
	g.GET("/me/calendar", h.myCalendar)
	g.GET("/holidays", h.listHolidays)
	g.POST("/holidays", h.createHoliday)
	g.PATCH("/holidays/:holidayId", h.updateHoliday)
	g.DELETE("/holidays/:holidayId", h.deleteHoliday)
	g.GET("/students/me/notifications", h.getPreferences)
	g.PATCH("/students/me/notifications", h.setPreferences)
}

const dateLayout = "2006-01-02"

// ---- JSON shapes ----

type meetingJSON struct {
	ID          *uuid.UUID `json:"id,omitempty"`
	ClassID     *uuid.UUID `json:"classId,omitempty"`
	Weekday     int        `json:"weekday"`
	StartTime   string     `json:"startTime"`
	EndTime     string     `json:"endTime"`
	LessonCount int        `json:"lessonCount"`
	Mode        string     `json:"mode"`
	Room        *string    `json:"room,omitempty"`
	OnlineURL   *string    `json:"onlineUrl,omitempty"`
}

type sessionJSON struct {
	ID           uuid.UUID  `json:"id"`
	ClassID      uuid.UUID  `json:"classId"`
	MeetingID    *uuid.UUID `json:"meetingId,omitempty"`
	Date         string     `json:"date"`
	StartTime    string     `json:"startTime"`
	EndTime      string     `json:"endTime"`
	LessonCount  int        `json:"lessonCount"`
	Mode         string     `json:"mode"`
	Room         *string    `json:"room,omitempty"`
	OnlineURL    *string    `json:"onlineUrl,omitempty"`
	Status       string     `json:"status"`
	Origin       string     `json:"origin"`
	Overridden   bool       `json:"overridden"`
	ChangeReason *string    `json:"changeReason,omitempty"`
	PeriodID     *uuid.UUID `json:"periodId,omitempty"`
	OnHoliday    bool       `json:"onHoliday"`
	Topic        *string    `json:"topic,omitempty"`
	HasContent   bool       `json:"hasContent"`
}

type eventJSON struct {
	ID          uuid.UUID `json:"id"`
	ClassID     uuid.UUID `json:"classId"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Date        string    `json:"date"`
	AllDay      bool      `json:"allDay"`
	StartTime   *string   `json:"startTime,omitempty"`
	EndTime     *string   `json:"endTime,omitempty"`
	Location    *string   `json:"location,omitempty"`
	OnlineURL   *string   `json:"onlineUrl,omitempty"`
}

type periodJSON struct {
	ID        uuid.UUID `json:"id"`
	ClassID   uuid.UUID `json:"classId"`
	FirstDay  string    `json:"firstDay"`
	LastDay   string    `json:"lastDay"`
	Action    string    `json:"action"`
	Label     string    `json:"label"`
	OnlineURL *string   `json:"onlineUrl,omitempty"`
}

type holidayJSON struct {
	ID     uuid.UUID `json:"id"`
	Date   string    `json:"date"`
	Name   string    `json:"name"`
	Scope  string    `json:"scope"`
	Active bool      `json:"active"`
}

type classJSON struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	CourseCode string    `json:"courseCode"`
	Color      string    `json:"color"`
	StartDate  string    `json:"startDate"`
	EndDate    string    `json:"endDate"`
}

type calendarJSON struct {
	Classes  []classJSON   `json:"classes"`
	Sessions []sessionJSON `json:"sessions"`
	Events   []eventJSON   `json:"events"`
	Periods  []periodJSON  `json:"periods"`
	Holidays []holidayJSON `json:"holidays"`
	Meetings []meetingJSON `json:"meetings"`
}

func formatDate(t time.Time) string { return domain.Day(t).Format(dateLayout) }

func clockPtr(c *domain.Clock) *string {
	if c == nil {
		return nil
	}
	s := c.String()
	return &s
}

func toMeetingJSON(m domain.WeeklyMeeting) meetingJSON {
	id := m.ID
	var classID *uuid.UUID
	if m.ClassID != uuid.Nil {
		c := m.ClassID
		classID = &c
	}
	return meetingJSON{ID: &id, ClassID: classID, Weekday: m.Weekday, StartTime: m.StartTime.String(), EndTime: m.EndTime.String(),
		LessonCount: m.LessonCount, Mode: string(m.Mode), Room: m.Room, OnlineURL: m.OnlineURL}
}

func toSessionJSON(s domain.ClassSession) sessionJSON {
	return sessionJSON{ID: s.ID, ClassID: s.ClassID, MeetingID: s.MeetingID, Date: formatDate(s.Date), StartTime: s.StartTime.String(),
		EndTime: s.EndTime.String(), LessonCount: s.LessonCount, Mode: string(s.Mode), Room: s.Room, OnlineURL: s.OnlineURL,
		Status: string(s.Status), Origin: string(s.Origin), Overridden: s.Overridden, ChangeReason: s.ChangeReason,
		PeriodID: s.PeriodID, OnHoliday: s.OnHoliday, Topic: s.Topic, HasContent: s.HasContent}
}

func toEventJSON(e domain.ClassEvent) eventJSON {
	return eventJSON{ID: e.ID, ClassID: e.ClassID, Title: e.Title, Description: e.Description, Date: formatDate(e.Date),
		AllDay: e.AllDay, StartTime: clockPtr(e.StartTime), EndTime: clockPtr(e.EndTime), Location: e.Location, OnlineURL: e.OnlineURL}
}

func toPeriodJSON(p domain.SpecialPeriod) periodJSON {
	return periodJSON{ID: p.ID, ClassID: p.ClassID, FirstDay: formatDate(p.FirstDay), LastDay: formatDate(p.LastDay),
		Action: string(p.Action), Label: p.Label, OnlineURL: p.OnlineURL}
}

func toHolidayJSON(h domain.Holiday) holidayJSON {
	return holidayJSON{ID: h.ID, Date: formatDate(h.Date), Name: h.Name, Scope: string(h.Scope), Active: h.Active}
}

func toCalendarJSON(c service.Calendar) calendarJSON {
	out := calendarJSON{Classes: []classJSON{}, Sessions: []sessionJSON{}, Events: []eventJSON{}, Periods: []periodJSON{}, Holidays: []holidayJSON{}, Meetings: []meetingJSON{}}
	for _, x := range c.Classes {
		out.Classes = append(out.Classes, classJSON{ID: x.ID, Name: x.Name, CourseCode: x.CourseCode, Color: x.Color,
			StartDate: formatDate(x.StartDate), EndDate: formatDate(x.EndDate)})
	}
	for _, x := range c.Sessions {
		out.Sessions = append(out.Sessions, toSessionJSON(x))
	}
	for _, x := range c.Events {
		out.Events = append(out.Events, toEventJSON(x))
	}
	for _, x := range c.Periods {
		out.Periods = append(out.Periods, toPeriodJSON(x))
	}
	for _, x := range c.Holidays {
		out.Holidays = append(out.Holidays, toHolidayJSON(x))
	}
	for _, x := range c.Meetings {
		out.Meetings = append(out.Meetings, toMeetingJSON(x))
	}
	return out
}

// ---- parsing ----

var (
	errBadTime = errors.New("bad time")
	errBadDate = errors.New("bad date")
)

func parseClock(s string) (domain.Clock, error) {
	c, err := domain.ParseClock(s)
	if err != nil {
		return 0, errBadTime
	}
	return c, nil
}

func parseOptionalClock(s *string) (*domain.Clock, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	c, err := parseClock(*s)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func parseDate(s string) (time.Time, error) {
	t, err := time.ParseInLocation(dateLayout, s, domain.Location())
	if err != nil {
		return time.Time{}, errBadDate
	}
	return t, nil
}

func (m meetingJSON) toDomain() (domain.WeeklyMeeting, error) {
	start, err := parseClock(m.StartTime)
	if err != nil {
		return domain.WeeklyMeeting{}, err
	}
	end, err := parseClock(m.EndTime)
	if err != nil {
		return domain.WeeklyMeeting{}, err
	}
	out := domain.WeeklyMeeting{Weekday: m.Weekday, StartTime: start, EndTime: end, LessonCount: m.LessonCount,
		Mode: domain.Mode(m.Mode), Room: m.Room, OnlineURL: m.OnlineURL}
	if m.ID != nil {
		out.ID = *m.ID
	}
	return out, nil
}

type sessionRequest struct {
	Date        string  `json:"date"`
	Status      string  `json:"status"`
	StartTime   string  `json:"startTime"`
	EndTime     string  `json:"endTime"`
	LessonCount int     `json:"lessonCount"`
	Mode        string  `json:"mode"`
	Room        *string `json:"room"`
	OnlineURL   *string `json:"onlineUrl"`
	Reason      *string `json:"reason"`
}

type eventRequest struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Date        string  `json:"date"`
	AllDay      bool    `json:"allDay"`
	StartTime   *string `json:"startTime"`
	EndTime     *string `json:"endTime"`
	Location    *string `json:"location"`
	OnlineURL   *string `json:"onlineUrl"`
}

func (r eventRequest) toDomain() (domain.ClassEvent, error) {
	date, err := parseDate(r.Date)
	if err != nil {
		return domain.ClassEvent{}, err
	}
	start, err := parseOptionalClock(r.StartTime)
	if err != nil {
		return domain.ClassEvent{}, err
	}
	end, err := parseOptionalClock(r.EndTime)
	if err != nil {
		return domain.ClassEvent{}, err
	}
	return domain.ClassEvent{Title: r.Title, Description: r.Description, Date: date, AllDay: r.AllDay, StartTime: start,
		EndTime: end, Location: r.Location, OnlineURL: r.OnlineURL}, nil
}

type periodRequest struct {
	FirstDay  string  `json:"firstDay"`
	LastDay   string  `json:"lastDay"`
	Action    string  `json:"action"`
	Label     string  `json:"label"`
	OnlineURL *string `json:"onlineUrl"`
}

type holidayRequest struct {
	Date   string `json:"date"`
	Name   string `json:"name"`
	Scope  string `json:"scope"`
	Active bool   `json:"active"`
}

type preferencesJSON struct {
	SessionReminders *bool `json:"sessionReminders,omitempty"`
	WeeklyDigest     *bool `json:"weeklyDigest,omitempty"`
}

// ---- helpers ----

func fail(c *gin.Context, p *problem.Problem) {
	_ = c.Error(p)
	c.Abort()
}

func actorOf(c *gin.Context) (service.Actor, bool) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return service.Actor{}, false
	}
	return service.Actor{UserID: p.UserID, Role: p.Role}, true
}

func uuidParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The "+name+" parameter is invalid."))
		return uuid.Nil, false
	}
	return id, true
}

func bindJSON(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return false
	}
	return true
}

func parseFailure(c *gin.Context, err error) {
	if errors.Is(err, errBadTime) {
		fail(c, problem.BadRequest("invalid-time-format", "Times must be HH:MM."))
		return
	}
	fail(c, problem.BadRequest("invalid-date-format", "Dates must be YYYY-MM-DD."))
}

func rangeOf(c *gin.Context) (time.Time, time.Time, bool) {
	from, err1 := parseDate(c.Query("from"))
	to, err2 := parseDate(c.Query("to"))
	if err1 != nil || err2 != nil {
		parseFailure(c, errBadDate)
		return time.Time{}, time.Time{}, false
	}
	return from, to, true
}

func toProblem(err error) *problem.Problem {
	var fe *domain.FieldError
	withField := func(p *problem.Problem) *problem.Problem {
		if errors.As(err, &fe) {
			return p.WithExtension("field", fe.Field)
		}
		return p
	}
	switch {
	case errors.Is(err, domain.ErrInvalidMeeting):
		return withField(problem.BadRequest("invalid-meeting", err.Error()))
	case errors.Is(err, domain.ErrMeetingsOverlap):
		return problem.BadRequest("meetings-overlap", err.Error())
	case errors.Is(err, domain.ErrReasonRequired):
		return withField(problem.BadRequest("reason-required", err.Error()))
	case errors.Is(err, domain.ErrInvalidSession):
		return withField(problem.BadRequest("invalid-session", err.Error()))
	case errors.Is(err, domain.ErrInvalidEvent):
		return withField(problem.BadRequest("invalid-event", err.Error()))
	case errors.Is(err, domain.ErrInvalidPeriod):
		return withField(problem.BadRequest("invalid-period", err.Error()))
	case errors.Is(err, domain.ErrInvalidHoliday):
		return withField(problem.BadRequest("invalid-holiday", err.Error()))
	case errors.Is(err, domain.ErrRangeTooLarge):
		return problem.BadRequest("range-too-large", err.Error())
	case errors.Is(err, domain.ErrNotExtraSession):
		return problem.Conflict("not-extra-session", err.Error())
	case errors.Is(err, domain.ErrNationalLocked):
		return problem.Conflict("national-holiday-locked", err.Error())
	case errors.Is(err, domain.ErrInvalidSessionContent):
		return withField(problem.BadRequest("invalid-session-content", err.Error()))
	case errors.Is(err, domain.ErrContentTooLong):
		return withField(problem.BadRequest("content-too-long", err.Error()))
	case errors.Is(err, domain.ErrDeckNotFound):
		return problem.NotFound("deck-not-found", err.Error())
	case errors.Is(err, domain.ErrModuleNotFound):
		return problem.NotFound("module-not-found", err.Error())
	case errors.Is(err, domain.ErrForbidden):
		return problem.Forbidden("forbidden", err.Error())
	case errors.Is(err, domain.ErrClassNotFound):
		return problem.NotFound("class-not-found", err.Error())
	case errors.Is(err, domain.ErrSessionNotFound):
		return problem.NotFound("session-not-found", err.Error())
	case errors.Is(err, domain.ErrEventNotFound):
		return problem.NotFound("event-not-found", err.Error())
	case errors.Is(err, domain.ErrPeriodNotFound):
		return problem.NotFound("period-not-found", err.Error())
	case errors.Is(err, domain.ErrHolidayNotFound):
		return problem.NotFound("holiday-not-found", err.Error())
	default:
		return problem.Internal()
	}
}

// ---- routes ----

func (h *Handler) listMeetings(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	meetings, err := h.svc.Meetings(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	out := []meetingJSON{}
	for _, m := range meetings {
		out = append(out, toMeetingJSON(m))
	}
	c.JSON(http.StatusOK, gin.H{"meetings": out})
}

func (h *Handler) replaceMeetings(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		Meetings []meetingJSON `json:"meetings"`
	}
	if !bindJSON(c, &req) {
		return
	}
	meetings := make([]domain.WeeklyMeeting, 0, len(req.Meetings))
	for _, m := range req.Meetings {
		dm, err := m.toDomain()
		if err != nil {
			parseFailure(c, err)
			return
		}
		meetings = append(meetings, dm)
	}
	saved, err := h.svc.ReplaceMeetings(c.Request.Context(), actor, classID, meetings)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	out := []meetingJSON{}
	for _, m := range saved {
		out = append(out, toMeetingJSON(m))
	}
	c.JSON(http.StatusOK, gin.H{"meetings": out})
}

func (h *Handler) classCalendar(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	from, to, ok := rangeOf(c)
	if !ok {
		return
	}
	cal, err := h.svc.ClassCalendar(c.Request.Context(), actor, classID, from, to)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toCalendarJSON(cal))
}

func (h *Handler) myCalendar(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	from, to, ok := rangeOf(c)
	if !ok {
		return
	}
	cal, err := h.svc.MyCalendar(c.Request.Context(), actor, from, to)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toCalendarJSON(cal))
}

func (h *Handler) updateSession(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, "sessionId")
	if !ok {
		return
	}
	var req sessionRequest
	if !bindJSON(c, &req) {
		return
	}
	start, err := parseClock(req.StartTime)
	if err != nil {
		parseFailure(c, err)
		return
	}
	end, err := parseClock(req.EndTime)
	if err != nil {
		parseFailure(c, err)
		return
	}
	session, err := h.svc.UpdateSession(c.Request.Context(), actor, classID, sessionID, service.SessionChange{
		Status: domain.SessionStatus(req.Status), StartTime: start, EndTime: end, LessonCount: req.LessonCount,
		Mode: domain.Mode(req.Mode), Room: req.Room, OnlineURL: req.OnlineURL, Reason: req.Reason,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toSessionJSON(session))
}

func (h *Handler) revertSession(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, "sessionId")
	if !ok {
		return
	}
	session, err := h.svc.RevertSession(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toSessionJSON(session))
}

func (h *Handler) createSession(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var req sessionRequest
	if !bindJSON(c, &req) {
		return
	}
	date, err := parseDate(req.Date)
	if err != nil {
		parseFailure(c, err)
		return
	}
	start, err := parseClock(req.StartTime)
	if err != nil {
		parseFailure(c, err)
		return
	}
	end, err := parseClock(req.EndTime)
	if err != nil {
		parseFailure(c, err)
		return
	}
	session, err := h.svc.CreateExtraSession(c.Request.Context(), actor, classID, domain.ClassSession{
		Date: date, StartTime: start, EndTime: end, LessonCount: req.LessonCount, Mode: domain.Mode(req.Mode),
		Room: req.Room, OnlineURL: req.OnlineURL, ChangeReason: req.Reason,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, toSessionJSON(session))
}

func (h *Handler) deleteSession(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, "sessionId")
	if !ok {
		return
	}
	if err := h.svc.DeleteExtraSession(c.Request.Context(), actor, classID, sessionID); err != nil {
		fail(c, toProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) createEvent(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var req eventRequest
	if !bindJSON(c, &req) {
		return
	}
	event, err := req.toDomain()
	if err != nil {
		parseFailure(c, err)
		return
	}
	saved, err := h.svc.CreateEvent(c.Request.Context(), actor, classID, event)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, toEventJSON(saved))
}

func (h *Handler) updateEvent(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	eventID, ok := uuidParam(c, "eventId")
	if !ok {
		return
	}
	var req eventRequest
	if !bindJSON(c, &req) {
		return
	}
	event, err := req.toDomain()
	if err != nil {
		parseFailure(c, err)
		return
	}
	saved, err := h.svc.UpdateEvent(c.Request.Context(), actor, classID, eventID, event)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toEventJSON(saved))
}

func (h *Handler) deleteEvent(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	eventID, ok := uuidParam(c, "eventId")
	if !ok {
		return
	}
	if err := h.svc.DeleteEvent(c.Request.Context(), actor, classID, eventID); err != nil {
		fail(c, toProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) createPeriod(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var req periodRequest
	if !bindJSON(c, &req) {
		return
	}
	first, err := parseDate(req.FirstDay)
	if err != nil {
		parseFailure(c, err)
		return
	}
	last, err := parseDate(req.LastDay)
	if err != nil {
		parseFailure(c, err)
		return
	}
	period, affected, err := h.svc.ApplyPeriod(c.Request.Context(), actor, classID, domain.SpecialPeriod{
		FirstDay: first, LastDay: last, Action: domain.PeriodAction(req.Action), Label: req.Label, OnlineURL: req.OnlineURL,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"period": toPeriodJSON(period), "affectedSessions": affected})
}

func (h *Handler) deletePeriod(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	periodID, ok := uuidParam(c, "periodId")
	if !ok {
		return
	}
	if err := h.svc.DeletePeriod(c.Request.Context(), actor, classID, periodID); err != nil {
		fail(c, toProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) listHolidays(c *gin.Context) {
	year := time.Now().In(domain.Location()).Year()
	if raw := c.Query("year"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 2000 || parsed > 2100 {
			fail(c, problem.BadRequest("invalid-year", "year must be a number between 2000 and 2100."))
			return
		}
		year = parsed
	}
	list, err := h.svc.Holidays(c.Request.Context(), year)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	out := []holidayJSON{}
	for _, x := range list {
		out = append(out, toHolidayJSON(x))
	}
	c.JSON(http.StatusOK, gin.H{"holidays": out})
}

func (r holidayRequest) toDomain() (domain.Holiday, error) {
	date, err := parseDate(r.Date)
	if err != nil {
		return domain.Holiday{}, err
	}
	return domain.Holiday{Date: date, Name: r.Name, Scope: domain.HolidayScope(r.Scope), Active: r.Active}, nil
}

func (h *Handler) createHoliday(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	var req holidayRequest
	if !bindJSON(c, &req) {
		return
	}
	holiday, err := req.toDomain()
	if err != nil {
		parseFailure(c, err)
		return
	}
	saved, err := h.svc.CreateHoliday(c.Request.Context(), actor, holiday)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, toHolidayJSON(saved))
}

func (h *Handler) updateHoliday(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	id, ok := uuidParam(c, "holidayId")
	if !ok {
		return
	}
	var req holidayRequest
	if !bindJSON(c, &req) {
		return
	}
	holiday, err := req.toDomain()
	if err != nil {
		parseFailure(c, err)
		return
	}
	saved, err := h.svc.UpdateHoliday(c.Request.Context(), actor, id, holiday)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toHolidayJSON(saved))
}

func (h *Handler) deleteHoliday(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	id, ok := uuidParam(c, "holidayId")
	if !ok {
		return
	}
	if err := h.svc.DeleteHoliday(c.Request.Context(), actor, id); err != nil {
		fail(c, toProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) getPreferences(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	p, err := h.svc.GetPreferences(c.Request.Context(), actor)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, preferencesJSON{SessionReminders: p.SessionReminders, WeeklyDigest: p.WeeklyDigest})
}

func (h *Handler) setPreferences(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	var req preferencesJSON
	if !bindJSON(c, &req) {
		return
	}
	p, err := h.svc.SetPreferences(c.Request.Context(), actor, service.Preferences{SessionReminders: req.SessionReminders, WeeklyDigest: req.WeeklyDigest})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, preferencesJSON{SessionReminders: p.SessionReminders, WeeklyDigest: p.WeeklyDigest})
}
