package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// LiveSummary is a room of the live classroom linked to a lesson, as the diary shows it, with how many commands the teacher ran in it
// (SPEC-073 RN-04).
type LiveSummary struct {
	ID              uuid.UUID
	Title           string
	Status          string
	StartedAt       time.Time
	EndedAt         *time.Time
	DurationMinutes int
	CommandCount    int
}

// ActiveLive is the open room of a class, and the lesson it is linked to, if any (SPEC-073 RN-02).
type ActiveLive struct {
	ID             uuid.UUID
	ClassSessionID *uuid.UUID
}

// LiveSessions is what the schedule needs from the live classroom; the classroom service implements it, in the composition root, never
// through its repository (SPEC-073 section 3.2).
type LiveSessions interface {
	// LinkedSessions gives the rooms linked to each of the lessons, oldest first, in one reading.
	LinkedSessions(ctx context.Context, classSessionIDs []uuid.UUID) (map[uuid.UUID][]LiveSummary, error)
	// ActiveSession gives the open room of the class, when there is one.
	ActiveSession(ctx context.Context, classID uuid.UUID) (ActiveLive, bool, error)
}

// WithLiveSessions plugs in the live classroom. Without it, the timeline has no rooms and no commands.
func (s *Service) WithLiveSessions(live LiveSessions) *Service {
	s.live = live
	return s
}

// TimelineEntry is a lesson of the timeline, with how many rooms were linked to it and how many commands they have.
type TimelineEntry struct {
	Session          domain.ClassSession
	LiveSessionCount int
	CommandCount     int
}

// Timeline is the three blocks of the class at the now of the server, and the open room of the class, linked to a lesson or not.
type Timeline struct {
	Now           time.Time
	Current       *TimelineEntry
	Past          []TimelineEntry
	Upcoming      []TimelineEntry
	LiveSessionID *uuid.UUID
}

// Diary is a lesson with its content (the private notes only for who may read them) and the rooms linked to it.
type Diary struct {
	Entry        TimelineEntry
	Content      SessionContent
	LiveSessions []LiveSummary
}

// Timeline splits the lessons of the class at the now of the server (SPEC-073 RN-01). The lesson linked to the open room is the current one,
// whatever the hour, and the lesson of the hour then waits at the front of the upcoming (RN-02). Who reads the calendar reads it.
func (s *Service) Timeline(ctx context.Context, actor Actor, classID uuid.UUID) (Timeline, error) {
	class, err := s.readableClass(ctx, actor, classID)
	if err != nil {
		return Timeline{}, err
	}
	sessions, err := s.repo.ListSessions(ctx, []uuid.UUID{classID}, class.StartDate, class.EndDate)
	if err != nil {
		return Timeline{}, err
	}
	now := s.now()
	out := Timeline{Now: now}

	var linked *domain.ClassSession
	if s.live != nil {
		active, found, err := s.live.ActiveSession(ctx, classID)
		if err != nil {
			return Timeline{}, err
		}
		if found {
			id := active.ID
			out.LiveSessionID = &id
			if active.ClassSessionID != nil {
				for i := range sessions {
					if sessions[i].ID == *active.ClassSessionID && sessions[i].Status != domain.SessionCanceled {
						linked = &sessions[i]
					}
				}
			}
		}
	}

	others := sessions
	if linked != nil {
		others = make([]domain.ClassSession, 0, len(sessions)-1)
		for _, x := range sessions {
			if x.ID != linked.ID {
				others = append(others, x)
			}
		}
	}
	tl := domain.SplitTimeline(others, now)
	if linked != nil {
		if tl.Current != nil {
			tl.Upcoming = append([]domain.ClassSession{*tl.Current}, tl.Upcoming...)
			if len(tl.Upcoming) > domain.MaxUpcomingLessons {
				tl.Upcoming = tl.Upcoming[:domain.MaxUpcomingLessons]
			}
		}
		tl.Current = linked
	}

	all := append(append([]domain.ClassSession{}, tl.Past...), tl.Upcoming...)
	if tl.Current != nil {
		all = append(all, *tl.Current)
	}
	rooms, err := s.linkedRooms(ctx, all)
	if err != nil {
		return Timeline{}, err
	}
	entry := func(x domain.ClassSession) TimelineEntry {
		e := TimelineEntry{Session: x, LiveSessionCount: len(rooms[x.ID])}
		for _, r := range rooms[x.ID] {
			e.CommandCount += r.CommandCount
		}
		return e
	}
	out.Past, out.Upcoming = make([]TimelineEntry, 0, len(tl.Past)), make([]TimelineEntry, 0, len(tl.Upcoming))
	for _, x := range tl.Past {
		out.Past = append(out.Past, entry(x))
	}
	for _, x := range tl.Upcoming {
		out.Upcoming = append(out.Upcoming, entry(x))
	}
	if tl.Current != nil {
		current := entry(*tl.Current)
		out.Current = &current
	}
	return out, nil
}

// Diary reads a lesson with its content and the rooms linked to it (SPEC-073 RN-04). The content hides the private notes from a student.
func (s *Service) Diary(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) (Diary, error) {
	content, err := s.Content(ctx, actor, classID, sessionID)
	if err != nil {
		return Diary{}, err
	}
	session, err := s.sessionOfClass(ctx, classID, sessionID)
	if err != nil {
		return Diary{}, err
	}
	rooms, err := s.linkedRooms(ctx, []domain.ClassSession{session})
	if err != nil {
		return Diary{}, err
	}
	linked := rooms[session.ID]
	if linked == nil {
		linked = []LiveSummary{}
	}
	entry := TimelineEntry{Session: session, LiveSessionCount: len(linked)}
	for _, r := range linked {
		entry.CommandCount += r.CommandCount
	}
	return Diary{Entry: entry, Content: content, LiveSessions: linked}, nil
}

// linkedRooms reads, in one go, the rooms linked to the lessons; without the live classroom plugged in, there are none.
func (s *Service) linkedRooms(ctx context.Context, sessions []domain.ClassSession) (map[uuid.UUID][]LiveSummary, error) {
	if s.live == nil || len(sessions) == 0 {
		return map[uuid.UUID][]LiveSummary{}, nil
	}
	ids := make([]uuid.UUID, len(sessions))
	for i, x := range sessions {
		ids[i] = x.ID
	}
	return s.live.LinkedSessions(ctx, ids)
}
