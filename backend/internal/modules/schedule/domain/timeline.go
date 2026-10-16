package domain

import (
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// The timeline of the class (SPEC-073 RN-01, D-04): the lesson of the hour is current from 15 minutes before its start until its end; the
// past block has the 3 most recent lessons and the upcoming block the 5 nearest.
const (
	CurrentWindowBefore = 15 * time.Minute
	MaxPastLessons      = 3
	MaxUpcomingLessons  = 5
)

// StartsAt is the instant the lesson starts, in the time zone of the schedule (SPEC-042 RN-13).
func (s ClassSession) StartsAt() time.Time { return s.StartTime.At(s.Date) }

// EndsAt is the instant the lesson ends.
func (s ClassSession) EndsAt() time.Time { return s.EndTime.At(s.Date) }

// WindowOpensAt is when the lesson becomes the current one: 15 minutes before it starts (SPEC-073 D-04).
func (s ClassSession) WindowOpensAt() time.Time { return s.StartsAt().Add(-CurrentWindowBefore) }

// Timeline is the three blocks of the class at an instant: the past lessons (newest first), the current one, if any, and the upcoming ones
// (nearest first). The blocks are never nil.
type Timeline struct {
	Past     []ClassSession
	Current  *ClassSession
	Upcoming []ClassSession
}

// SplitTimeline puts the lessons that are not canceled in the blocks of the timeline at now (SPEC-073 RN-01): a lesson that ended is past;
// a lesson whose window opened (15 minutes before the start) and did not end is current, the one that starts earlier when there is more
// than one, and the others of the window wait at the front of the upcoming; a lesson whose window did not open is upcoming. The past keeps
// the MaxPastLessons most recent and the upcoming the MaxUpcomingLessons nearest.
func SplitTimeline(sessions []ClassSession, now time.Time) Timeline {
	sorted := make([]ClassSession, 0, len(sessions))
	for _, s := range sessions {
		if s.Status != SessionCanceled {
			sorted = append(sorted, s)
		}
	}
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].StartsAt().Before(sorted[j].StartsAt()) })

	tl := Timeline{Past: []ClassSession{}, Upcoming: []ClassSession{}}
	var window []ClassSession
	for _, s := range sorted {
		switch {
		case !s.EndsAt().After(now):
			tl.Past = append(tl.Past, s)
		case !s.WindowOpensAt().After(now):
			window = append(window, s)
		default:
			tl.Upcoming = append(tl.Upcoming, s)
		}
	}
	if len(window) > 0 {
		current := window[0]
		tl.Current = &current
		tl.Upcoming = append(window[1:], tl.Upcoming...)
	}
	// the past, newest first
	for i, j := 0, len(tl.Past)-1; i < j; i, j = i+1, j-1 {
		tl.Past[i], tl.Past[j] = tl.Past[j], tl.Past[i]
	}
	if len(tl.Past) > MaxPastLessons {
		tl.Past = tl.Past[:MaxPastLessons]
	}
	if len(tl.Upcoming) > MaxUpcomingLessons {
		tl.Upcoming = tl.Upcoming[:MaxUpcomingLessons]
	}
	return tl
}

// NormalizeTeacherNotes trims a note of the teacher (already filtered as rich text) and checks its length, which is the one of the description
// (SPEC-073 RN-03); an empty note means none. field names the note in the error.
func NormalizeTeacherNotes(field, raw string) (*string, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(text) > MaxContentDescLength {
		return nil, fieldError(field, ErrContentTooLong)
	}
	return &text, nil
}
