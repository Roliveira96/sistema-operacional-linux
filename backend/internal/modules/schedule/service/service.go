// Package service implements the schedule of a class (SPEC-042): weekly meetings and the sessions they generate,
// changes to one session, extra sessions, events, special periods, holidays, the calendars and the e-mails.
package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/htmlsafe"
)

// MaxCalendarDays is the longest range a calendar request covers (SPEC-042, section 5).
const MaxCalendarDays = 62

// Kinds of the e-mails of the schedule (SPEC-042 RN-09).
const (
	KindChange   = "SCHEDULE_CHANGE"
	KindOnEnroll = "SCHEDULE_ON_ENROLL"
	KindReminder = "SESSION_REMINDER"
	KindDigest   = "WEEKLY_DIGEST"
)

// activationWindow is how far back the agenda job looks for new enrollments.
const activationWindow = 7 * 24 * time.Hour

// ClassInfo is what the schedule needs from a class.
type ClassInfo struct {
	ID         uuid.UUID
	TeacherID  uuid.UUID
	Name       string
	CourseCode string
	Color      string
	StartDate  time.Time
	EndDate    time.Time
	Status     string
}

// Recipient is a student with an ACTIVE enrollment and an active account, with the e-mail preferences.
type Recipient struct {
	UserID    uuid.UUID
	Email     string
	Name      string
	Reminders bool
	Digest    bool
}

// Activation is an enrollment that became ACTIVE.
type Activation struct {
	EnrollmentID uuid.UUID
	ClassID      uuid.UUID
	UserID       uuid.UUID
	Email        string
	Name         string
}

// Actor is who makes a request.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// OutboxItem is an e-mail to put in the outbox. DedupeKey, when set, keeps the same e-mail from being queued twice.
type OutboxItem struct {
	RecipientUserID uuid.UUID
	To              string
	Kind            string
	Subject         string
	TextBody        string
	HTMLBody        string
	DedupeKey       string
	SendAfter       time.Time
}

// SessionChange is the new state of one session (SPEC-042 RN-04).
type SessionChange struct {
	Status      domain.SessionStatus
	StartTime   domain.Clock
	EndTime     domain.Clock
	LessonCount int
	Mode        domain.Mode
	Room        *string
	OnlineURL   *string
	Reason      *string
}

// Preferences are the optional e-mails a student can turn off (SPEC-042 RN-10).
type Preferences struct {
	SessionReminders *bool
	WeeklyDigest     *bool
}

// Calendar is everything shown on a calendar for a range of days.
type Calendar struct {
	Classes  []ClassInfo
	Sessions []domain.ClassSession
	Events   []domain.ClassEvent
	Periods  []domain.SpecialPeriod
	Holidays []domain.Holiday
	Meetings []domain.WeeklyMeeting
}

// Repository is the persistence the service needs.
type Repository interface {
	FindClass(ctx context.Context, id uuid.UUID) (ClassInfo, error)
	ListClasses(ctx context.Context, ids []uuid.UUID) ([]ClassInfo, error)
	TeacherClassIDs(ctx context.Context, teacherID uuid.UUID) ([]uuid.UUID, error)
	StudentClassIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error)
	ActiveStudents(ctx context.Context, classID uuid.UUID) ([]Recipient, error)

	ListMeetings(ctx context.Context, classID uuid.UUID) ([]domain.WeeklyMeeting, error)
	ReplaceMeetings(ctx context.Context, classID uuid.UUID, meetings []domain.WeeklyMeeting, from time.Time, sessions []domain.ClassSession) error

	ListSessions(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.ClassSession, error)
	ListAllSessions(ctx context.Context, from, to time.Time) ([]domain.ClassSession, error)
	FindSession(ctx context.Context, id uuid.UUID) (domain.ClassSession, error)
	SaveSession(ctx context.Context, s *domain.ClassSession) error
	DeleteSession(ctx context.Context, id uuid.UUID) error
	// SaveContent saves the lesson and replaces its links in one transaction (SPEC-053).
	SaveContent(ctx context.Context, s *domain.ClassSession, links []domain.SessionLink) error
	ListSessionLinks(ctx context.Context, sessionID uuid.UUID) ([]domain.SessionLink, error)
	// The materials of the lessons (SPEC-074): ListMaterials gives, in the order of the teacher, the ones not deleted of each lesson in one reading.
	ListMaterials(ctx context.Context, sessionIDs []uuid.UUID) (map[uuid.UUID][]domain.ClassSessionMaterial, error)
	FindMaterial(ctx context.Context, id uuid.UUID) (domain.ClassSessionMaterial, error)
	CreateMaterial(ctx context.Context, m *domain.ClassSessionMaterial) error
	// SaveMaterials updates the title, kind, phase, release and position of the materials in one transaction.
	SaveMaterials(ctx context.Context, list []domain.ClassSessionMaterial) error
	DeleteMaterial(ctx context.Context, id uuid.UUID) error
	// SetHasContent sets the flag of content of a lesson alone, so it is kept (or not) when the weekly lessons are regenerated.
	SetHasContent(ctx context.Context, sessionID uuid.UUID, has bool) error

	ListEvents(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.ClassEvent, error)
	FindEvent(ctx context.Context, id uuid.UUID) (domain.ClassEvent, error)
	SaveEvent(ctx context.Context, e *domain.ClassEvent) error
	DeleteEvent(ctx context.Context, id uuid.UUID) error

	ListPeriods(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.SpecialPeriod, error)
	FindPeriod(ctx context.Context, id uuid.UUID) (domain.SpecialPeriod, error)
	SavePeriod(ctx context.Context, p *domain.SpecialPeriod, sessions []domain.ClassSession) error
	DeletePeriod(ctx context.Context, id uuid.UUID, sessions []domain.ClassSession) error

	ListHolidays(ctx context.Context, from, to time.Time) ([]domain.Holiday, error)
	FindHoliday(ctx context.Context, id uuid.UUID) (domain.Holiday, error)
	SaveHoliday(ctx context.Context, h *domain.Holiday) error
	DeleteHoliday(ctx context.Context, id uuid.UUID) error
	EnsureNationalHolidays(ctx context.Context, seeds []domain.HolidaySeed) error

	Enqueue(ctx context.Context, items []OutboxItem) error
	RecentActivations(ctx context.Context, since time.Time) ([]Activation, error)
	Preferences(ctx context.Context, userID uuid.UUID) (reminders bool, digest bool, err error)
	SetPreferences(ctx context.Context, userID uuid.UUID, reminders, digest bool) error
}

// Service implements the use cases of the schedule.
type Service struct {
	repo      Repository
	now       func() time.Time
	publicURL string
	richText  *htmlsafe.Sanitizer
	decks     Decks
	modules   Modules
	live      LiveSessions
	files     MaterialFiles
	store     MaterialStore
}

// New creates the service. publicURL is the address of the application, used in the e-mails.
func New(repo Repository, now func() time.Time, publicURL string) *Service {
	return &Service{repo: repo, now: now, publicURL: strings.TrimRight(publicURL, "/"), richText: htmlsafe.NewRichText()}
}

func (s *Service) today() time.Time { return domain.Day(s.now().In(domain.Location())) }

// writableClass returns the class when the actor may change its schedule (SPEC-042 RN-08).
func (s *Service) writableClass(ctx context.Context, actor Actor, classID uuid.UUID) (ClassInfo, error) {
	if actor.Role != authn.RoleTeacher && actor.Role != authn.RoleAdmin {
		return ClassInfo{}, domain.ErrForbidden
	}
	class, err := s.repo.FindClass(ctx, classID)
	if err != nil {
		return ClassInfo{}, err
	}
	if actor.Role != authn.RoleAdmin && class.TeacherID != actor.UserID {
		return ClassInfo{}, domain.ErrForbidden
	}
	return class, nil
}

// readableClass returns the class when the actor may read its calendar (SPEC-042 RN-08). A student without an active
// enrollment gets ErrClassNotFound, so the class is not revealed.
func (s *Service) readableClass(ctx context.Context, actor Actor, classID uuid.UUID) (ClassInfo, error) {
	if actor.Role == authn.RoleStudent {
		ids, err := s.repo.StudentClassIDs(ctx, actor.UserID)
		if err != nil {
			return ClassInfo{}, err
		}
		for _, id := range ids {
			if id == classID {
				return s.repo.FindClass(ctx, classID)
			}
		}
		return ClassInfo{}, domain.ErrClassNotFound
	}
	return s.writableClass(ctx, actor, classID)
}

func inValidity(class ClassInfo, d time.Time) bool {
	day := domain.Day(d)
	return !day.Before(domain.Day(class.StartDate)) && !day.After(domain.Day(class.EndDate))
}

// holidaySet returns the days with an active holiday between from and to.
func (s *Service) holidaySet(ctx context.Context, from, to time.Time) (map[time.Time]bool, error) {
	list, err := s.repo.ListHolidays(ctx, from, to)
	if err != nil {
		return nil, err
	}
	set := map[time.Time]bool{}
	for _, h := range list {
		if h.Active {
			set[domain.Day(h.Date)] = true
		}
	}
	return set, nil
}

// Meetings returns the weekly meetings of a class.
func (s *Service) Meetings(ctx context.Context, actor Actor, classID uuid.UUID) ([]domain.WeeklyMeeting, error) {
	if _, err := s.readableClass(ctx, actor, classID); err != nil {
		return nil, err
	}
	return s.repo.ListMeetings(ctx, classID)
}

// ReplaceMeetings saves the weekly meetings of a class and regenerates its sessions from today on: the sessions
// changed by hand, the extra ones, the ones changed by a period and the past ones are kept (SPEC-042 RN-01, RN-02).
func (s *Service) ReplaceMeetings(ctx context.Context, actor Actor, classID uuid.UUID, meetings []domain.WeeklyMeeting) ([]domain.WeeklyMeeting, error) {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return nil, err
	}
	if err := domain.ValidateMeetings(meetings); err != nil {
		return nil, err
	}
	for i := range meetings {
		meetings[i].ClassID = classID
		if meetings[i].ID == uuid.Nil {
			id, err := uuid.NewV7()
			if err != nil {
				return nil, err
			}
			meetings[i].ID = id
		}
	}
	if err := s.regenerate(ctx, class, meetings); err != nil {
		return nil, err
	}
	return meetings, nil
}

// Regenerate rebuilds the future sessions of a class after its validity changed (SPEC-042 CA-03).
func (s *Service) Regenerate(ctx context.Context, classID uuid.UUID) error {
	class, err := s.repo.FindClass(ctx, classID)
	if err != nil {
		return err
	}
	meetings, err := s.repo.ListMeetings(ctx, classID)
	if err != nil {
		return err
	}
	return s.regenerate(ctx, class, meetings)
}

func (s *Service) regenerate(ctx context.Context, class ClassInfo, meetings []domain.WeeklyMeeting) error {
	from := s.today()
	if domain.Day(class.StartDate).After(from) {
		from = domain.Day(class.StartDate)
	}
	holidays, err := s.holidaySet(ctx, from, class.EndDate)
	if err != nil {
		return err
	}
	var sessions []domain.ClassSession
	for _, sd := range domain.GenerateSessionDates(meetings, from, class.EndDate) {
		session := domain.FromMeeting(class.ID, meetings[sd.Meeting], sd.Date)
		session.OnHoliday = holidays[sd.Date]
		sessions = append(sessions, session)
	}
	return s.repo.ReplaceMeetings(ctx, class.ID, meetings, from, sessions)
}

// sessionOfClass loads a session and checks that it belongs to the class.
func (s *Service) sessionOfClass(ctx context.Context, classID, sessionID uuid.UUID) (domain.ClassSession, error) {
	session, err := s.repo.FindSession(ctx, sessionID)
	if err != nil {
		return domain.ClassSession{}, err
	}
	if session.ClassID != classID {
		return domain.ClassSession{}, domain.ErrSessionNotFound
	}
	return session, nil
}

func trimmed(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

// UpdateSession changes one session; it becomes overridden and the students get an e-mail (SPEC-042 RN-04).
func (s *Service) UpdateSession(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, change SessionChange) (domain.ClassSession, error) {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return domain.ClassSession{}, err
	}
	session, err := s.sessionOfClass(ctx, classID, sessionID)
	if err != nil {
		return domain.ClassSession{}, err
	}
	session.Status = change.Status
	session.StartTime, session.EndTime = change.StartTime, change.EndTime
	session.LessonCount = change.LessonCount
	session.Mode = change.Mode
	session.Room, session.OnlineURL = trimmed(change.Room), trimmed(change.OnlineURL)
	session.ChangeReason = trimmed(change.Reason)
	session.Overridden = session.Origin == domain.OriginWeekly
	if session.Status == "" {
		session.Status = domain.SessionScheduled
	}
	if err := session.Validate(); err != nil {
		return domain.ClassSession{}, err
	}
	if err := s.repo.SaveSession(ctx, &session); err != nil {
		return domain.ClassSession{}, err
	}
	return session, s.notify(ctx, class, sessionChangedEmail(class, session, s.publicURL))
}

// RevertSession gives a session back the values of its meeting (SPEC-042 RN-04).
func (s *Service) RevertSession(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) (domain.ClassSession, error) {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return domain.ClassSession{}, err
	}
	session, err := s.sessionOfClass(ctx, classID, sessionID)
	if err != nil {
		return domain.ClassSession{}, err
	}
	meetings, err := s.repo.ListMeetings(ctx, classID)
	if err != nil {
		return domain.ClassSession{}, err
	}
	restoreFromMeeting(&session, meetings)
	if err := s.repo.SaveSession(ctx, &session); err != nil {
		return domain.ClassSession{}, err
	}
	return session, s.notify(ctx, class, sessionChangedEmail(class, session, s.publicURL))
}

// restoreFromMeeting resets a weekly session to its meeting, or only to "scheduled" when the meeting is gone.
func restoreFromMeeting(session *domain.ClassSession, meetings []domain.WeeklyMeeting) {
	session.Status = domain.SessionScheduled
	session.ChangeReason = nil
	session.Overridden = false
	session.PeriodID = nil
	if session.MeetingID == nil {
		return
	}
	for _, m := range meetings {
		if m.ID == *session.MeetingID {
			session.StartTime, session.EndTime = m.StartTime, m.EndTime
			session.LessonCount = m.LessonCount
			session.Mode, session.Room, session.OnlineURL = m.Mode, m.Room, m.OnlineURL
			return
		}
	}
}

// CreateExtraSession adds a session outside the meetings (SPEC-042 RN-05, D-06).
func (s *Service) CreateExtraSession(ctx context.Context, actor Actor, classID uuid.UUID, session domain.ClassSession) (domain.ClassSession, error) {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return domain.ClassSession{}, err
	}
	session.ID = uuid.Nil
	session.ClassID = classID
	session.MeetingID, session.PeriodID = nil, nil
	session.Date = domain.Day(session.Date)
	session.Origin = domain.OriginExtra
	session.Status = domain.SessionScheduled
	session.Overridden = false
	session.Room, session.OnlineURL, session.ChangeReason = trimmed(session.Room), trimmed(session.OnlineURL), trimmed(session.ChangeReason)
	if !inValidity(class, session.Date) {
		return domain.ClassSession{}, &domain.FieldError{Field: "date", Err: domain.ErrInvalidSession}
	}
	if err := session.Validate(); err != nil {
		return domain.ClassSession{}, err
	}
	holidays, err := s.holidaySet(ctx, session.Date, session.Date)
	if err != nil {
		return domain.ClassSession{}, err
	}
	session.OnHoliday = holidays[session.Date]
	if err := s.repo.SaveSession(ctx, &session); err != nil {
		return domain.ClassSession{}, err
	}
	return session, s.notify(ctx, class, extraSessionEmail(class, session, s.publicURL))
}

// DeleteExtraSession removes an extra session; weekly sessions are canceled instead (SPEC-042, section 5).
func (s *Service) DeleteExtraSession(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) error {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return err
	}
	session, err := s.sessionOfClass(ctx, classID, sessionID)
	if err != nil {
		return err
	}
	if session.Origin != domain.OriginExtra {
		return domain.ErrNotExtraSession
	}
	if err := s.repo.DeleteSession(ctx, sessionID); err != nil {
		return err
	}
	session.Status = domain.SessionCanceled
	return s.notify(ctx, class, sessionChangedEmail(class, session, s.publicURL))
}

func normalizeEvent(e *domain.ClassEvent) {
	e.Title = strings.TrimSpace(e.Title)
	e.Description = strings.TrimSpace(e.Description)
	e.Date = domain.Day(e.Date)
	e.Location, e.OnlineURL = trimmed(e.Location), trimmed(e.OnlineURL)
	if e.AllDay {
		e.StartTime, e.EndTime = nil, nil
	}
}

// CreateEvent adds an event to the class (SPEC-042 RN-06, D-06).
func (s *Service) CreateEvent(ctx context.Context, actor Actor, classID uuid.UUID, event domain.ClassEvent) (domain.ClassEvent, error) {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return domain.ClassEvent{}, err
	}
	event.ID = uuid.Nil
	event.ClassID = classID
	normalizeEvent(&event)
	if err := event.Validate(); err != nil {
		return domain.ClassEvent{}, err
	}
	if err := s.repo.SaveEvent(ctx, &event); err != nil {
		return domain.ClassEvent{}, err
	}
	return event, s.notify(ctx, class, eventEmail(class, event, false, s.publicURL))
}

// UpdateEvent changes an event of the class (SPEC-042 RN-06).
func (s *Service) UpdateEvent(ctx context.Context, actor Actor, classID, eventID uuid.UUID, event domain.ClassEvent) (domain.ClassEvent, error) {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return domain.ClassEvent{}, err
	}
	current, err := s.repo.FindEvent(ctx, eventID)
	if err != nil {
		return domain.ClassEvent{}, err
	}
	if current.ClassID != classID {
		return domain.ClassEvent{}, domain.ErrEventNotFound
	}
	event.Model = current.Model
	event.ClassID = classID
	normalizeEvent(&event)
	if err := event.Validate(); err != nil {
		return domain.ClassEvent{}, err
	}
	if err := s.repo.SaveEvent(ctx, &event); err != nil {
		return domain.ClassEvent{}, err
	}
	return event, s.notify(ctx, class, eventEmail(class, event, false, s.publicURL))
}

// DeleteEvent removes an event of the class.
func (s *Service) DeleteEvent(ctx context.Context, actor Actor, classID, eventID uuid.UUID) error {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return err
	}
	event, err := s.repo.FindEvent(ctx, eventID)
	if err != nil {
		return err
	}
	if event.ClassID != classID {
		return domain.ErrEventNotFound
	}
	if err := s.repo.DeleteEvent(ctx, eventID); err != nil {
		return err
	}
	return s.notify(ctx, class, eventEmail(class, event, true, s.publicURL))
}

// ApplyPeriod suspends, or turns online, every weekly session of the range that was not changed by hand, in one
// transaction, and sends one e-mail per student (SPEC-042 RN-07, D-07, D-15). It returns how many sessions changed.
func (s *Service) ApplyPeriod(ctx context.Context, actor Actor, classID uuid.UUID, period domain.SpecialPeriod) (domain.SpecialPeriod, int, error) {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return domain.SpecialPeriod{}, 0, err
	}
	period.ID = uuid.Nil
	period.ClassID = classID
	period.FirstDay, period.LastDay = domain.Day(period.FirstDay), domain.Day(period.LastDay)
	period.Label = strings.TrimSpace(period.Label)
	period.OnlineURL = trimmed(period.OnlineURL)
	if err := period.Validate(); err != nil {
		return domain.SpecialPeriod{}, 0, err
	}
	if !inValidity(class, period.FirstDay) || !inValidity(class, period.LastDay) {
		return domain.SpecialPeriod{}, 0, &domain.FieldError{Field: "lastDay", Err: domain.ErrInvalidPeriod}
	}
	id, err := uuid.NewV7()
	if err != nil {
		return domain.SpecialPeriod{}, 0, err
	}
	period.ID = id

	sessions, err := s.repo.ListSessions(ctx, []uuid.UUID{classID}, period.FirstDay, period.LastDay)
	if err != nil {
		return domain.SpecialPeriod{}, 0, err
	}
	var changed []domain.ClassSession
	for _, session := range sessions {
		if session.Origin != domain.OriginWeekly || session.Overridden || session.PeriodID != nil {
			continue
		}
		session.PeriodID = &period.ID
		label := period.Label
		session.ChangeReason = &label
		switch period.Action {
		case domain.PeriodNoClasses:
			session.Status = domain.SessionCanceled
		case domain.PeriodOnline:
			session.Mode = domain.ModeOnline
			session.Room = nil
			session.OnlineURL = period.OnlineURL
		}
		changed = append(changed, session)
	}
	if err := s.repo.SavePeriod(ctx, &period, changed); err != nil {
		return domain.SpecialPeriod{}, 0, err
	}
	return period, len(changed), s.notify(ctx, class, periodEmail(class, period, false, s.publicURL))
}

// DeletePeriod undoes a period: the sessions it changed go back to their meetings (SPEC-042 RN-07, CA-09).
func (s *Service) DeletePeriod(ctx context.Context, actor Actor, classID, periodID uuid.UUID) error {
	class, err := s.writableClass(ctx, actor, classID)
	if err != nil {
		return err
	}
	period, err := s.repo.FindPeriod(ctx, periodID)
	if err != nil {
		return err
	}
	if period.ClassID != classID {
		return domain.ErrPeriodNotFound
	}
	sessions, err := s.repo.ListSessions(ctx, []uuid.UUID{classID}, period.FirstDay, period.LastDay)
	if err != nil {
		return err
	}
	meetings, err := s.repo.ListMeetings(ctx, classID)
	if err != nil {
		return err
	}
	var restored []domain.ClassSession
	for _, session := range sessions {
		if session.PeriodID == nil || *session.PeriodID != periodID {
			continue
		}
		restoreFromMeeting(&session, meetings)
		restored = append(restored, session)
	}
	if err := s.repo.DeletePeriod(ctx, periodID, restored); err != nil {
		return err
	}
	return s.notify(ctx, class, periodEmail(class, period, true, s.publicURL))
}

func checkRange(from, to time.Time) error {
	if domain.Day(to).Before(domain.Day(from)) || domain.Day(to).Sub(domain.Day(from)) > MaxCalendarDays*24*time.Hour {
		return domain.ErrRangeTooLarge
	}
	return nil
}

func (s *Service) calendar(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) (Calendar, error) {
	var cal Calendar
	var err error
	if cal.Classes, err = s.repo.ListClasses(ctx, classIDs); err != nil {
		return Calendar{}, err
	}
	if cal.Sessions, err = s.repo.ListSessions(ctx, classIDs, from, to); err != nil {
		return Calendar{}, err
	}
	if cal.Events, err = s.repo.ListEvents(ctx, classIDs, from, to); err != nil {
		return Calendar{}, err
	}
	if cal.Periods, err = s.repo.ListPeriods(ctx, classIDs, from, to); err != nil {
		return Calendar{}, err
	}
	cal.Meetings = []domain.WeeklyMeeting{}
	for _, id := range classIDs {
		meetings, err := s.repo.ListMeetings(ctx, id)
		if err != nil {
			return Calendar{}, err
		}
		cal.Meetings = append(cal.Meetings, meetings...)
	}
	holidays, err := s.repo.ListHolidays(ctx, from, to)
	if err != nil {
		return Calendar{}, err
	}
	// The calendar shows only the active holidays; the admin list shows all of them.
	cal.Holidays = []domain.Holiday{}
	for _, h := range holidays {
		if h.Active {
			cal.Holidays = append(cal.Holidays, h)
		}
	}
	return cal, nil
}

// ClassCalendar returns the calendar of one class between from and to (SPEC-042 RN-08).
func (s *Service) ClassCalendar(ctx context.Context, actor Actor, classID uuid.UUID, from, to time.Time) (Calendar, error) {
	if err := checkRange(from, to); err != nil {
		return Calendar{}, err
	}
	if _, err := s.readableClass(ctx, actor, classID); err != nil {
		return Calendar{}, err
	}
	return s.calendar(ctx, []uuid.UUID{classID}, from, to)
}

// MyCalendar returns the calendar of every class of the teacher, or of every class where the student has an active
// enrollment (SPEC-042 D-05, CA-12).
func (s *Service) MyCalendar(ctx context.Context, actor Actor, from, to time.Time) (Calendar, error) {
	if err := checkRange(from, to); err != nil {
		return Calendar{}, err
	}
	var ids []uuid.UUID
	var err error
	switch actor.Role {
	case authn.RoleStudent:
		ids, err = s.repo.StudentClassIDs(ctx, actor.UserID)
	case authn.RoleTeacher, authn.RoleAdmin:
		ids, err = s.repo.TeacherClassIDs(ctx, actor.UserID)
	default:
		return Calendar{}, domain.ErrForbidden
	}
	if err != nil {
		return Calendar{}, err
	}
	return s.calendar(ctx, ids, from, to)
}

// Holidays lists the holidays of a year.
func (s *Service) Holidays(ctx context.Context, year int) ([]domain.Holiday, error) {
	first := time.Date(year, time.January, 1, 0, 0, 0, 0, domain.Location())
	return s.repo.ListHolidays(ctx, first, first.AddDate(1, 0, -1))
}

func requireAdmin(actor Actor) error {
	if actor.Role != authn.RoleAdmin {
		return domain.ErrForbidden
	}
	return nil
}

// CreateHoliday adds a local holiday or a recess; national holidays come from RefreshNationalHolidays (SPEC-042 D-17).
func (s *Service) CreateHoliday(ctx context.Context, actor Actor, h domain.Holiday) (domain.Holiday, error) {
	if err := requireAdmin(actor); err != nil {
		return domain.Holiday{}, err
	}
	if h.Scope == domain.HolidayNational {
		return domain.Holiday{}, &domain.FieldError{Field: "scope", Err: domain.ErrInvalidHoliday}
	}
	h.ID = uuid.Nil
	h.Name = strings.TrimSpace(h.Name)
	h.Date = domain.Day(h.Date)
	h.Active = true
	if err := h.Validate(); err != nil {
		return domain.Holiday{}, err
	}
	if err := s.repo.SaveHoliday(ctx, &h); err != nil {
		return domain.Holiday{}, err
	}
	return h, nil
}

// UpdateHoliday changes a holiday; a national one can only be turned on or off (SPEC-042 RN-11).
func (s *Service) UpdateHoliday(ctx context.Context, actor Actor, id uuid.UUID, h domain.Holiday) (domain.Holiday, error) {
	if err := requireAdmin(actor); err != nil {
		return domain.Holiday{}, err
	}
	current, err := s.repo.FindHoliday(ctx, id)
	if err != nil {
		return domain.Holiday{}, err
	}
	if current.Scope == domain.HolidayNational {
		current.Active = h.Active
	} else {
		if h.Scope == domain.HolidayNational {
			return domain.Holiday{}, &domain.FieldError{Field: "scope", Err: domain.ErrInvalidHoliday}
		}
		current.Name, current.Date, current.Scope, current.Active = strings.TrimSpace(h.Name), domain.Day(h.Date), h.Scope, h.Active
	}
	if err := current.Validate(); err != nil {
		return domain.Holiday{}, err
	}
	if err := s.repo.SaveHoliday(ctx, &current); err != nil {
		return domain.Holiday{}, err
	}
	return current, nil
}

// DeleteHoliday removes a local holiday or a recess (SPEC-042 CA-18).
func (s *Service) DeleteHoliday(ctx context.Context, actor Actor, id uuid.UUID) error {
	if err := requireAdmin(actor); err != nil {
		return err
	}
	h, err := s.repo.FindHoliday(ctx, id)
	if err != nil {
		return err
	}
	if h.Scope == domain.HolidayNational {
		return domain.ErrNationalLocked
	}
	return s.repo.DeleteHoliday(ctx, id)
}

// RefreshNationalHolidays loads the national holidays of this year and the next (SPEC-042 RN-11).
func (s *Service) RefreshNationalHolidays(ctx context.Context, now time.Time) error {
	year := now.In(domain.Location()).Year()
	seeds := append(domain.NationalHolidays(year), domain.NationalHolidays(year+1)...)
	return s.repo.EnsureNationalHolidays(ctx, seeds)
}

// SetPreferences turns the reminder or the digest on or off for a student (SPEC-042 RN-10, D-12).
func (s *Service) SetPreferences(ctx context.Context, actor Actor, p Preferences) (Preferences, error) {
	if actor.Role != authn.RoleStudent {
		return Preferences{}, domain.ErrForbidden
	}
	reminders, digest, err := s.repo.Preferences(ctx, actor.UserID)
	if err != nil {
		return Preferences{}, err
	}
	if p.SessionReminders != nil {
		reminders = *p.SessionReminders
	}
	if p.WeeklyDigest != nil {
		digest = *p.WeeklyDigest
	}
	if err := s.repo.SetPreferences(ctx, actor.UserID, reminders, digest); err != nil {
		return Preferences{}, err
	}
	return Preferences{SessionReminders: &reminders, WeeklyDigest: &digest}, nil
}

// GetPreferences returns the e-mail preferences of a student.
func (s *Service) GetPreferences(ctx context.Context, actor Actor) (Preferences, error) {
	if actor.Role != authn.RoleStudent {
		return Preferences{}, domain.ErrForbidden
	}
	reminders, digest, err := s.repo.Preferences(ctx, actor.UserID)
	if err != nil {
		return Preferences{}, err
	}
	return Preferences{SessionReminders: &reminders, WeeklyDigest: &digest}, nil
}

// notify queues one e-mail per active student of the class (SPEC-042 RN-09a).
func (s *Service) notify(ctx context.Context, class ClassInfo, content emailContent) error {
	students, err := s.repo.ActiveStudents(ctx, class.ID)
	if err != nil {
		return err
	}
	now := s.now()
	items := make([]OutboxItem, 0, len(students))
	for _, r := range students {
		items = append(items, content.to(r, KindChange, "", now))
	}
	if len(items) == 0 {
		return nil
	}
	return s.repo.Enqueue(ctx, items)
}

// SendEnrollmentAgendas queues the agenda of the class to each student whose enrollment became active, once per
// enrollment (SPEC-042 RN-09b, CA-13).
func (s *Service) SendEnrollmentAgendas(ctx context.Context, now time.Time) error {
	activations, err := s.repo.RecentActivations(ctx, now.Add(-activationWindow))
	if err != nil {
		return err
	}
	var items []OutboxItem
	for _, a := range activations {
		class, err := s.repo.FindClass(ctx, a.ClassID)
		if err != nil {
			if errors.Is(err, domain.ErrClassNotFound) {
				continue
			}
			return err
		}
		meetings, err := s.repo.ListMeetings(ctx, a.ClassID)
		if err != nil {
			return err
		}
		if len(meetings) == 0 {
			continue
		}
		from := domain.Day(now.In(domain.Location()))
		sessions, err := s.repo.ListSessions(ctx, []uuid.UUID{a.ClassID}, from, from.AddDate(0, 0, 14))
		if err != nil {
			return err
		}
		content := agendaEmail(class, meetings, sessions, s.publicURL)
		r := Recipient{UserID: a.UserID, Email: a.Email, Name: a.Name}
		items = append(items, content.to(r, KindOnEnroll, "enroll:"+a.EnrollmentID.String(), now))
	}
	if len(items) == 0 {
		return nil
	}
	return s.repo.Enqueue(ctx, items)
}

// SendReminders queues the reminder of each session whose reminder time has come and that has not started, once per
// session and student, to the students who want it (SPEC-042 RN-09c, D-10, CA-14).
func (s *Service) SendReminders(ctx context.Context, now time.Time) error {
	today := domain.Day(now.In(domain.Location()))
	all, err := s.allClassSessions(ctx, today, today.AddDate(0, 0, 1))
	if err != nil {
		return err
	}
	var items []OutboxItem
	students := map[uuid.UUID][]Recipient{}
	classes := map[uuid.UUID]ClassInfo{}
	for _, session := range all {
		if session.Status != domain.SessionScheduled {
			continue
		}
		start := session.StartTime.At(session.Date)
		if now.Before(domain.ReminderAt(session.Date, session.StartTime)) || !now.Before(start) {
			continue
		}
		if _, ok := students[session.ClassID]; !ok {
			if students[session.ClassID], err = s.repo.ActiveStudents(ctx, session.ClassID); err != nil {
				return err
			}
			if classes[session.ClassID], err = s.repo.FindClass(ctx, session.ClassID); err != nil {
				return err
			}
		}
		content := reminderEmail(classes[session.ClassID], session, s.publicURL)
		for _, r := range students[session.ClassID] {
			if !r.Reminders {
				continue
			}
			items = append(items, content.to(r, KindReminder, "reminder:"+session.ID.String()+":"+r.UserID.String(), now))
		}
	}
	if len(items) == 0 {
		return nil
	}
	return s.repo.Enqueue(ctx, items)
}

// allClassSessions lists the sessions of every class with sessions between from and to.
func (s *Service) allClassSessions(ctx context.Context, from, to time.Time) ([]domain.ClassSession, error) {
	return s.repo.ListAllSessions(ctx, from, to)
}

// SendWeeklyDigest queues, on Sunday from 18:00, the sessions of the next week to each student who wants it, once per
// week (SPEC-042 RN-09d, D-11, CA-15).
func (s *Service) SendWeeklyDigest(ctx context.Context, now time.Time) error {
	if !domain.IsDigestTime(now) {
		return nil
	}
	first, last := domain.NextWeek(now)
	sessions, err := s.allClassSessions(ctx, first, last)
	if err != nil {
		return err
	}
	byClass := map[uuid.UUID][]domain.ClassSession{}
	for _, session := range sessions {
		if session.Status == domain.SessionScheduled {
			byClass[session.ClassID] = append(byClass[session.ClassID], session)
		}
	}
	type digest struct {
		recipient Recipient
		classes   []classWeek
	}
	perStudent := map[uuid.UUID]*digest{}
	var order []uuid.UUID
	for classID, list := range byClass {
		class, err := s.repo.FindClass(ctx, classID)
		if err != nil {
			return err
		}
		students, err := s.repo.ActiveStudents(ctx, classID)
		if err != nil {
			return err
		}
		for _, r := range students {
			if !r.Digest {
				continue
			}
			d, ok := perStudent[r.UserID]
			if !ok {
				d = &digest{recipient: r}
				perStudent[r.UserID] = d
				order = append(order, r.UserID)
			}
			d.classes = append(d.classes, classWeek{class: class, sessions: list})
		}
	}
	var items []OutboxItem
	week := first.Format("2006-01-02")
	for _, userID := range order {
		d := perStudent[userID]
		content := digestEmail(first, last, d.classes, s.publicURL)
		items = append(items, content.to(d.recipient, KindDigest, "digest:"+week+":"+userID.String(), now))
	}
	if len(items) == 0 {
		return nil
	}
	return s.repo.Enqueue(ctx, items)
}
