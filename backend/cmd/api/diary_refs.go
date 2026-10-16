package main

import (
	"context"

	"github.com/google/uuid"

	classroomservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
)

// scheduleLive lets the schedule read the rooms of the live classroom for its timeline and its diary, through the classroom service and never
// its repository (SPEC-071 section 3.2).
type scheduleLive struct{ classroom *classroomservice.Service }

func (l scheduleLive) LinkedSessions(ctx context.Context, lessons []uuid.UUID) (map[uuid.UUID][]scheduleservice.LiveSummary, error) {
	rooms, err := l.classroom.LinkedRooms(ctx, lessons)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID][]scheduleservice.LiveSummary{}
	for _, r := range rooms {
		if r.Session.ClassSessionID == nil {
			continue
		}
		lesson := *r.Session.ClassSessionID
		out[lesson] = append(out[lesson], scheduleservice.LiveSummary{
			ID: r.Session.ID, Title: r.Session.Title, Status: r.Session.Status, StartedAt: r.Session.StartedAt, EndedAt: r.Session.EndedAt,
			DurationMinutes: r.Session.DurationMinutes(), CommandCount: r.CommandCount,
		})
	}
	return out, nil
}

func (l scheduleLive) ActiveSession(ctx context.Context, classID uuid.UUID) (scheduleservice.ActiveLive, bool, error) {
	room, found, err := l.classroom.ActiveRoom(ctx, classID)
	if err != nil || !found {
		return scheduleservice.ActiveLive{}, false, err
	}
	return scheduleservice.ActiveLive{ID: room.ID, ClassSessionID: room.ClassSessionID}, true, nil
}
