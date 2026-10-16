package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
)

// The timeline of the class and the diary of the lesson (SPEC-071, section 5). The instants carry the offset of the schedule (SPEC-042 RN-13).

type timelineEntryJSON struct {
	sessionJSON
	StartsAt         time.Time `json:"startsAt"`
	EndsAt           time.Time `json:"endsAt"`
	LiveSessionCount int       `json:"liveSessionCount"`
	CommandCount     int       `json:"commandCount"`
}

type timelineJSON struct {
	Now           time.Time           `json:"now"`
	Current       *timelineEntryJSON  `json:"current"`
	Past          []timelineEntryJSON `json:"past"`
	Upcoming      []timelineEntryJSON `json:"upcoming"`
	LiveSessionID *uuid.UUID          `json:"liveSessionId"`
}

type liveSummaryJSON struct {
	ID              uuid.UUID  `json:"id"`
	Title           string     `json:"title"`
	Status          string     `json:"status"`
	StartedAt       time.Time  `json:"startedAt"`
	EndedAt         *time.Time `json:"endedAt"`
	DurationMinutes int        `json:"durationMinutes"`
	CommandCount    int        `json:"commandCount"`
}

type diaryJSON struct {
	Session      timelineEntryJSON `json:"session"`
	Content      contentJSON       `json:"content"`
	LiveSessions []liveSummaryJSON `json:"liveSessions"`
}

func local(t time.Time) time.Time { return t.In(domain.Location()) }

func toEntryJSON(e service.TimelineEntry) timelineEntryJSON {
	return timelineEntryJSON{sessionJSON: toSessionJSON(e.Session), StartsAt: e.Session.StartsAt(), EndsAt: e.Session.EndsAt(),
		LiveSessionCount: e.LiveSessionCount, CommandCount: e.CommandCount}
}

func toEntriesJSON(list []service.TimelineEntry) []timelineEntryJSON {
	out := make([]timelineEntryJSON, 0, len(list))
	for _, e := range list {
		out = append(out, toEntryJSON(e))
	}
	return out
}

func toLiveJSON(list []service.LiveSummary) []liveSummaryJSON {
	out := make([]liveSummaryJSON, 0, len(list))
	for _, r := range list {
		var ended *time.Time
		if r.EndedAt != nil {
			at := local(*r.EndedAt)
			ended = &at
		}
		out = append(out, liveSummaryJSON{ID: r.ID, Title: r.Title, Status: r.Status, StartedAt: local(r.StartedAt), EndedAt: ended,
			DurationMinutes: r.DurationMinutes, CommandCount: r.CommandCount})
	}
	return out
}

func (h *Handler) timeline(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	tl, err := h.svc.Timeline(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	out := timelineJSON{Now: local(tl.Now), Past: toEntriesJSON(tl.Past), Upcoming: toEntriesJSON(tl.Upcoming), LiveSessionID: tl.LiveSessionID}
	if tl.Current != nil {
		current := toEntryJSON(*tl.Current)
		out.Current = &current
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) diary(c *gin.Context) {
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
	d, err := h.svc.Diary(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, diaryJSON{Session: toEntryJSON(d.Entry), Content: toContentJSON(d.Content), LiveSessions: toLiveJSON(d.LiveSessions)})
}
