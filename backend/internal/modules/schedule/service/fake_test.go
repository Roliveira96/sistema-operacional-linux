package service_test

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// fakeRepo is an in-memory implementation of service.Repository.
type fakeRepo struct {
	classes    map[uuid.UUID]service.ClassInfo
	students   map[uuid.UUID][]service.Recipient // by class
	meetings   map[uuid.UUID][]domain.WeeklyMeeting
	sessions   map[uuid.UUID]domain.ClassSession
	events     map[uuid.UUID]domain.ClassEvent
	periods    map[uuid.UUID]domain.SpecialPeriod
	holidays   map[uuid.UUID]domain.Holiday
	outbox     []service.OutboxItem
	dedupe     map[string]bool
	activation []service.Activation
	prefs      map[uuid.UUID][2]bool
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		classes:  map[uuid.UUID]service.ClassInfo{},
		students: map[uuid.UUID][]service.Recipient{},
		meetings: map[uuid.UUID][]domain.WeeklyMeeting{},
		sessions: map[uuid.UUID]domain.ClassSession{},
		events:   map[uuid.UUID]domain.ClassEvent{},
		periods:  map[uuid.UUID]domain.SpecialPeriod{},
		holidays: map[uuid.UUID]domain.Holiday{},
		dedupe:   map[string]bool{},
		prefs:    map[uuid.UUID][2]bool{},
	}
}

func inRange(d, from, to time.Time) bool {
	day := domain.Day(d)
	return !day.Before(domain.Day(from)) && !day.After(domain.Day(to))
}

func contains(ids []uuid.UUID, id uuid.UUID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func (f *fakeRepo) FindClass(ctx context.Context, id uuid.UUID) (service.ClassInfo, error) {
	c, ok := f.classes[id]
	if !ok {
		return service.ClassInfo{}, domain.ErrClassNotFound
	}
	return c, nil
}

func (f *fakeRepo) ListClasses(ctx context.Context, ids []uuid.UUID) ([]service.ClassInfo, error) {
	var out []service.ClassInfo
	for _, id := range ids {
		if c, ok := f.classes[id]; ok {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f *fakeRepo) TeacherClassIDs(ctx context.Context, teacherID uuid.UUID) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for id, c := range f.classes {
		if c.TeacherID == teacherID {
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeRepo) StudentClassIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for classID, list := range f.students {
		for _, r := range list {
			if r.UserID == userID {
				out = append(out, classID)
			}
		}
	}
	return out, nil
}

func (f *fakeRepo) ActiveStudents(ctx context.Context, classID uuid.UUID) ([]service.Recipient, error) {
	return f.students[classID], nil
}

func (f *fakeRepo) ListMeetings(ctx context.Context, classID uuid.UUID) ([]domain.WeeklyMeeting, error) {
	return f.meetings[classID], nil
}

func (f *fakeRepo) ReplaceMeetings(ctx context.Context, classID uuid.UUID, meetings []domain.WeeklyMeeting, from time.Time, sessions []domain.ClassSession) error {
	f.meetings[classID] = meetings
	for id, s := range f.sessions {
		if s.ClassID == classID && s.Origin == domain.OriginWeekly && !s.Overridden && s.PeriodID == nil && !domain.Day(s.Date).Before(domain.Day(from)) {
			delete(f.sessions, id)
		}
	}
	for _, s := range sessions {
		dup := false
		for _, existing := range f.sessions {
			if existing.MeetingID != nil && s.MeetingID != nil && *existing.MeetingID == *s.MeetingID && domain.Day(existing.Date).Equal(domain.Day(s.Date)) {
				dup = true
			}
		}
		if dup {
			continue
		}
		s.ID = uuid.New()
		f.sessions[s.ID] = s
	}
	return nil
}

func (f *fakeRepo) ListSessions(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.ClassSession, error) {
	var out []domain.ClassSession
	for _, s := range f.sessions {
		if contains(classIDs, s.ClassID) && inRange(s.Date, from, to) {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].Date.Equal(out[j].Date) {
			return out[i].Date.Before(out[j].Date)
		}
		return out[i].StartTime < out[j].StartTime
	})
	return out, nil
}

func (f *fakeRepo) ListAllSessions(ctx context.Context, from, to time.Time) ([]domain.ClassSession, error) {
	var ids []uuid.UUID
	for id := range f.classes {
		ids = append(ids, id)
	}
	return f.ListSessions(ctx, ids, from, to)
}

func (f *fakeRepo) FindSession(ctx context.Context, id uuid.UUID) (domain.ClassSession, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.ClassSession{}, domain.ErrSessionNotFound
	}
	return s, nil
}

func (f *fakeRepo) SaveSession(ctx context.Context, s *domain.ClassSession) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	f.sessions[s.ID] = *s
	return nil
}

func (f *fakeRepo) DeleteSession(ctx context.Context, id uuid.UUID) error {
	delete(f.sessions, id)
	return nil
}

func (f *fakeRepo) ListEvents(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.ClassEvent, error) {
	var out []domain.ClassEvent
	for _, e := range f.events {
		if contains(classIDs, e.ClassID) && inRange(e.Date, from, to) {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeRepo) FindEvent(ctx context.Context, id uuid.UUID) (domain.ClassEvent, error) {
	e, ok := f.events[id]
	if !ok {
		return domain.ClassEvent{}, domain.ErrEventNotFound
	}
	return e, nil
}

func (f *fakeRepo) SaveEvent(ctx context.Context, e *domain.ClassEvent) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	f.events[e.ID] = *e
	return nil
}

func (f *fakeRepo) DeleteEvent(ctx context.Context, id uuid.UUID) error {
	delete(f.events, id)
	return nil
}

func (f *fakeRepo) ListPeriods(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.SpecialPeriod, error) {
	var out []domain.SpecialPeriod
	for _, p := range f.periods {
		if contains(classIDs, p.ClassID) && !domain.Day(p.LastDay).Before(domain.Day(from)) && !domain.Day(p.FirstDay).After(domain.Day(to)) {
			out = append(out, p)
		}
	}
	return out, nil
}

func (f *fakeRepo) FindPeriod(ctx context.Context, id uuid.UUID) (domain.SpecialPeriod, error) {
	p, ok := f.periods[id]
	if !ok {
		return domain.SpecialPeriod{}, domain.ErrPeriodNotFound
	}
	return p, nil
}

func (f *fakeRepo) SavePeriod(ctx context.Context, p *domain.SpecialPeriod, sessions []domain.ClassSession) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	f.periods[p.ID] = *p
	for _, s := range sessions {
		f.sessions[s.ID] = s
	}
	return nil
}

func (f *fakeRepo) DeletePeriod(ctx context.Context, id uuid.UUID, sessions []domain.ClassSession) error {
	delete(f.periods, id)
	for _, s := range sessions {
		f.sessions[s.ID] = s
	}
	return nil
}

func (f *fakeRepo) ListHolidays(ctx context.Context, from, to time.Time) ([]domain.Holiday, error) {
	var out []domain.Holiday
	for _, h := range f.holidays {
		if inRange(h.Date, from, to) {
			out = append(out, h)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date.Before(out[j].Date) })
	return out, nil
}

func (f *fakeRepo) FindHoliday(ctx context.Context, id uuid.UUID) (domain.Holiday, error) {
	h, ok := f.holidays[id]
	if !ok {
		return domain.Holiday{}, domain.ErrHolidayNotFound
	}
	return h, nil
}

func (f *fakeRepo) SaveHoliday(ctx context.Context, h *domain.Holiday) error {
	if h.ID == uuid.Nil {
		h.ID = uuid.New()
	}
	f.holidays[h.ID] = *h
	return nil
}

func (f *fakeRepo) DeleteHoliday(ctx context.Context, id uuid.UUID) error {
	delete(f.holidays, id)
	return nil
}

func (f *fakeRepo) EnsureNationalHolidays(ctx context.Context, seeds []domain.HolidaySeed) error {
	for _, seed := range seeds {
		found := false
		for _, h := range f.holidays {
			if h.Name == seed.Name && domain.Day(h.Date).Equal(domain.Day(seed.Date)) {
				found = true
			}
		}
		if !found {
			id := uuid.New()
			f.holidays[id] = domain.Holiday{Model: database.Model{ID: id}, Date: seed.Date, Name: seed.Name, Scope: domain.HolidayNational, Active: true}
		}
	}
	return nil
}

func (f *fakeRepo) Enqueue(ctx context.Context, items []service.OutboxItem) error {
	for _, it := range items {
		if it.DedupeKey != "" {
			if f.dedupe[it.DedupeKey] {
				continue
			}
			f.dedupe[it.DedupeKey] = true
		}
		f.outbox = append(f.outbox, it)
	}
	return nil
}

func (f *fakeRepo) RecentActivations(ctx context.Context, since time.Time) ([]service.Activation, error) {
	return f.activation, nil
}

func (f *fakeRepo) Preferences(ctx context.Context, userID uuid.UUID) (bool, bool, error) {
	p, ok := f.prefs[userID]
	if !ok {
		return true, true, nil
	}
	return p[0], p[1], nil
}

func (f *fakeRepo) SetPreferences(ctx context.Context, userID uuid.UUID, reminders, digest bool) error {
	f.prefs[userID] = [2]bool{reminders, digest}
	return nil
}

func (f *fakeRepo) kinds() []string {
	var out []string
	for _, it := range f.outbox {
		out = append(out, it.Kind)
	}
	return out
}
