package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// ---- the exercise of the lesson (SPEC-065) ----

// exerciseEnvelopeBytes is what the JSON around the state of a submission may take, over the 2 MB of the state itself.
const exerciseEnvelopeBytes = 1 << 10

// stamp is a moment as the exercise messages tell it: RFC 3339, UTC, always with milliseconds.
func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func stampPtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return stamp(*t)
}

// exerciseRunBody is what a round tells, in live:exercise:started and in the snapshot: the round, the exercise, the time, and the hour of the
// server, for the client to correct its clock.
func exerciseRunBody(st service.ExerciseState) gin.H {
	r := st.Run
	return gin.H{
		"runId": r.ID, "blockId": r.BlockID, "index": r.ExerciseIndex, "title": r.Title, "difficulty": r.Difficulty,
		"durationSeconds": r.DurationSeconds, "startedAt": stamp(r.StartedAt), "endsAt": stamp(r.EndsAt), "now": stamp(st.Now),
	}
}

// exerciseResultBody is live:exercise:result and the result of the snapshot: how many concluded of how many were in the round and, only when the
// teacher shows it, the scoreboard.
func exerciseResultBody(st service.ExerciseState) gin.H {
	body := gin.H{"runId": st.Run.ID, "visible": st.Run.ResultVisible, "completed": len(st.Results), "participants": st.Participants}
	if st.Run.ResultVisible {
		scoreboard := make([]gin.H, 0, len(st.Results))
		for _, r := range st.Results {
			scoreboard = append(scoreboard, gin.H{"studentId": r.StudentID, "name": r.Name, "elapsedSeconds": r.ElapsedSeconds, "points": r.Points})
		}
		body["scoreboard"] = scoreboard
	}
	return body
}

// exerciseSnapshot is the `exercise` of the snapshot: null with no round; else the round with its status and who ended it, and by role: the panel
// gets the progress of each student of the round; a student gets his own result (null while he did not conclude) and nothing of the others'.
// With the result shown, everybody gets it.
func exerciseSnapshot(st *service.ExerciseState, panel bool, student uuid.UUID, takenOver bool) any {
	if st == nil {
		return nil
	}
	r := st.Run
	body := exerciseRunBody(*st)
	body["status"] = r.Status()
	body["endedBy"], body["endedAt"], body["resultVisible"] = r.EndedBy, stampPtr(r.EndedAt), r.ResultVisible
	body["pausedSeconds"], body["closedAt"] = r.PausedSeconds, stampPtr(r.ClosedAt) // SPEC-071
	if panel {
		progress := make([]gin.H, 0, len(st.Entries))
		for _, e := range st.Entries {
			item := gin.H{
				"studentId": e.StudentID, "name": e.Name, "met": e.Met, "total": e.Total, "last": e.Last, "at": stampPtr(e.At),
				"completedAt": nil, "elapsedSeconds": nil, "points": nil, "attempts": e.Attempts,
				"commands": e.Commands, "lastCommandAt": stampPtr(e.LastCommandAt), "status": e.Status, "helpRequested": e.HelpRequested,
				"takenOver": e.TakenOver, "takeoverOn": e.TakeoverOn,
			}
			if e.Result != nil {
				item["completedAt"], item["elapsedSeconds"], item["points"] = stamp(e.Result.CompletedAt), e.Result.ElapsedSeconds, e.Result.Points
			}
			progress = append(progress, item)
		}
		body["progress"] = progress
	} else {
		body["myResult"] = nil
		body["takenOver"] = takenOver // the teacher has his terminal now (SPEC-071)
		for _, res := range st.Results {
			if res.StudentID == student {
				body["myResult"] = gin.H{"completedAt": stamp(res.CompletedAt), "elapsedSeconds": res.ElapsedSeconds, "points": res.Points}
			}
		}
	}
	if r.ResultVisible {
		body["result"] = exerciseResultBody(*st)
	}
	return body
}

// ExerciseEnded tells the room that a round ended by itself, with no teacher asking: by the timer, by the end of the lesson, or when the service
// found its time up. The service calls it.
func (h *Handler) ExerciseEnded(sessionID uuid.UUID, state service.ExerciseState) {
	wsHandler{h}.exerciseEnded(sessionID.String(), state)
}

// ExerciseFailed logs a round that the service could not end by itself; it is ended on the next reading of the room.
func (h *Handler) ExerciseFailed(sessionID uuid.UUID, err error) {
	h.log.Warn("classroom exercise timer failed", zap.String("room", sessionID.String()), zap.Error(err))
}

// exerciseTell sends a message of the exercise to the panel and to the admitted students: the presentation window and the waiting room never get one.
func (w wsHandler) exerciseTell(room, typ string, body gin.H) {
	w.h.hub.BroadcastTo(room, hub.Message{Type: typ, Data: mustMarshal(body)}, func(who hub.Identity) bool { return isPanel(who) || isStudent(who) })
}

// exerciseEnded tells that the round ended, who ended it and when, and that the observation ended with it.
func (w wsHandler) exerciseEnded(room string, st service.ExerciseState) {
	by := ""
	if st.Run.EndedBy != nil {
		by = *st.Run.EndedBy
	}
	w.exerciseTell(room, typeExerciseEnded, gin.H{"runId": st.Run.ID, "by": by, "endedAt": stampPtr(st.Run.EndedAt), "now": stamp(st.Now)})
	if st.Unwatched != nil {
		w.watchStudent(room, *st.Unwatched, false)
	}
	w.released(room, st.Released)
}

// watchStudent tells a student, in every tab, that the teacher watches his terminal (on) or stopped.
func (w wsHandler) watchStudent(room string, student uuid.UUID, on bool) {
	id := student.String()
	w.h.hub.BroadcastTo(room, hub.Message{Type: typeExerciseWatch, Data: mustMarshal(map[string]bool{"on": on})},
		func(who hub.Identity) bool { return isStudent(who) && who.UserID == id })
}

// joinedExercise puts a student who joined in the round that runs and, if the teacher is watching him, tells him again, so that he sends the
// picture of his terminal.
func (w wsHandler) joinedExercise(room string, who hub.Identity) {
	student, err := uuid.Parse(who.UserID)
	if err != nil {
		return
	}
	session := sessionOf(room)
	w.h.svc.JoinExercise(session, student)
	if w.h.svc.ExerciseWatching(session, student) {
		w.watchStudent(room, student, true)
	}
}

// onlineStudents are the students admitted who are in the room: the ones who are in a round that starts now.
func (w wsHandler) onlineStudents(room string) []uuid.UUID {
	var out []uuid.UUID
	for _, id := range w.h.hub.OnlineUsers(room) {
		if student, err := uuid.Parse(id); err == nil {
			out = append(out, student)
		}
	}
	return out
}

// exerciseControl runs the messages of the panel about the exercise: start, end, show the result and watch a student (SPEC-065 section 3.1).
// Only the panel window of the teacher sends them; a message that is not valid, or that the service refuses, is rejected and sends nothing.
func (w wsHandler) exerciseControl(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	if !isPanel(who) {
		reason := "not-allowed"
		if who.Role == hub.Controller {
			reason = "wrong-view"
		}
		w.Dropped(room, who, msg.Type, reason)
		return
	}
	actor, err := actorOf(who)
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	svc, session := w.h.svc, sessionOf(room)
	switch msg.Type {
	case typeExerciseStart:
		in, err := parseExerciseStart(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		in.Online = w.onlineStudents(room)
		state, err := svc.StartExercise(ctx, actor, session, in)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.exerciseTell(room, typeExerciseStarted, exerciseRunBody(state))
	case typeExerciseEnd:
		if err := parseExerciseEnd(msg.Data); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		state, err := svc.EndExercise(ctx, actor, session)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.exerciseEnded(room, state)
	case typeExerciseReveal:
		visible, err := parseExerciseReveal(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		state, err := svc.RevealExercise(ctx, actor, session, visible)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.exerciseTell(room, typeExerciseResult, exerciseResultBody(state))
	case typeExerciseWatch:
		student, err := parseExerciseWatch(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		watch, err := svc.WatchExercise(ctx, actor, session, student)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		if watch.Previous != nil && (watch.Current == nil || *watch.Previous != *watch.Current) {
			w.watchStudent(room, *watch.Previous, false)
		}
		w.released(room, watch.Released)
		if watch.Current != nil {
			w.watchStudent(room, *watch.Current, true)
		}
	}
}

// exerciseStudent runs the messages of a student about the exercise: his progress and, when the teacher watches him, the picture of his terminal.
// Both go to the panel only. The presentation window and any other connection are dropped (the hub has already dropped who waits); a progress that
// is not valid is rejected; a picture of a student that the teacher does not watch is dropped.
func (w wsHandler) exerciseStudent(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	switch {
	case isStudent(who):
	case who.Role == hub.Controller:
		w.Dropped(room, who, msg.Type, "wrong-view")
		return
	default:
		w.Dropped(room, who, msg.Type, "not-allowed")
		return
	}
	student, err := uuid.Parse(who.UserID)
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	session := sessionOf(room)
	toThePanel := func(typ string, body gin.H) {
		w.h.hub.BroadcastTo(room, hub.Message{Type: typ, Data: mustMarshal(body)}, isPanel)
	}
	switch msg.Type {
	case typeExerciseProgress:
		in, err := parseExerciseProgress(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		p, err := w.h.svc.RecordExerciseProgress(ctx, session, student, in)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		toThePanel(typeExerciseProgress, gin.H{"runId": p.RunID, "studentId": p.StudentID, "met": p.Met, "total": p.Total, "last": p.Last, "at": stamp(p.At),
			"commands": p.Commands, "lastCommandAt": stampPtr(p.LastCommandAt)})
	case typeExerciseScreen:
		runID, screen, err := parseExerciseScreen(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		if !w.h.svc.ExerciseScreenAllowed(session, student, runID) {
			w.Dropped(room, who, msg.Type, "not-watched")
			return
		}
		// the server does not read the picture: it only checked that it is an object, and passes it on
		toThePanel(typeExerciseScreen, gin.H{"studentId": student, "screen": screen})
	}
}

func decodeExercise(data json.RawMessage, into any) error {
	if len(data) == 0 {
		return errors.New("the message needs data")
	}
	return json.Unmarshal(data, into)
}

// parseExerciseStart reads the data of live:exercise:start: the block, the index of the exercise and, optionally, the minutes.
func parseExerciseStart(data json.RawMessage) (service.ExerciseStartInput, error) {
	var d struct {
		BlockID *uuid.UUID `json:"blockId"`
		Index   *int       `json:"index"`
		Minutes *int       `json:"minutes"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return service.ExerciseStartInput{}, err
	}
	if d.BlockID == nil || d.Index == nil {
		return service.ExerciseStartInput{}, errors.New("the message needs the blockId and the index of the exercise")
	}
	return service.ExerciseStartInput{BlockID: *d.BlockID, Index: *d.Index, Minutes: d.Minutes}, nil
}

// parseExerciseEnd checks the data of live:exercise:end, which is nothing: none, null or an empty object.
func parseExerciseEnd(data json.RawMessage) error {
	if trimmed := bytes.TrimSpace(data); len(trimmed) == 0 || string(trimmed) == "null" || isObject(trimmed) {
		return nil
	}
	return errors.New("the message has no data")
}

// parseExerciseReveal reads the data of live:exercise:reveal: whether the result is shown.
func parseExerciseReveal(data json.RawMessage) (bool, error) {
	var d struct {
		Visible *bool `json:"visible"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return false, err
	}
	if d.Visible == nil {
		return false, errors.New("the message needs visible as a boolean")
	}
	return *d.Visible, nil
}

// parseExerciseWatch reads the data of live:exercise:watch: the student to watch, or null to stop. The key must be there.
func parseExerciseWatch(data json.RawMessage) (*uuid.UUID, error) {
	var d struct {
		StudentID json.RawMessage `json:"studentId"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return nil, err
	}
	if d.StudentID == nil {
		return nil, errors.New("the message needs the studentId, or null to stop")
	}
	if string(bytes.TrimSpace(d.StudentID)) == "null" {
		return nil, nil
	}
	var id uuid.UUID
	if err := json.Unmarshal(d.StudentID, &id); err != nil {
		return nil, errors.New("the studentId must be the id of a student")
	}
	return &id, nil
}

// parseExerciseProgress reads the data of live:exercise:progress. The ranges and the last command are checked by the service.
func parseExerciseProgress(data json.RawMessage) (service.ExerciseProgressInput, error) {
	var d struct {
		RunID    *uuid.UUID `json:"runId"`
		Met      *int       `json:"met"`
		Total    *int       `json:"total"`
		Last     *string    `json:"last"`
		Commands *int       `json:"commands"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return service.ExerciseProgressInput{}, err
	}
	if d.RunID == nil || d.Met == nil || d.Total == nil {
		return service.ExerciseProgressInput{}, errors.New("the message needs the runId, met and total")
	}
	in := service.ExerciseProgressInput{RunID: *d.RunID, Met: *d.Met, Total: *d.Total}
	if d.Last != nil {
		in.Last = *d.Last
	}
	if d.Commands != nil {
		in.Commands = *d.Commands
	}
	return in, nil
}

// parseExerciseScreen reads the data of live:exercise:screen: the round and the picture, which must be an object.
func parseExerciseScreen(data json.RawMessage) (uuid.UUID, json.RawMessage, error) {
	var d struct {
		RunID  *uuid.UUID      `json:"runId"`
		Screen json.RawMessage `json:"screen"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return uuid.Nil, nil, err
	}
	if d.RunID == nil || !isObject(d.Screen) {
		return uuid.Nil, nil, errors.New("the message needs the runId and the screen as an object")
	}
	return *d.RunID, d.Screen, nil
}

// submitExercise grades the state that a student sent for the round (SPEC-065 section 3.1). Only a student; one a student each 2 seconds; the state
// up to 2 MB. The answer says whether it passed and, when it did, when, how long it took and the points, and never what is missing. The first
// time a student concludes, the panel is told.
func (h *Handler) submitExercise(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	if actor.Role != authn.RoleStudent {
		fail(c, toProblem(domain.ErrForbidden))
		return
	}
	if allowed, retry := h.submits.Allow(actor.UserID.String()); !allowed {
		fail(c, problem.TooManyRequests("Wait a moment before sending the state again.", int(math.Ceil(retry.Seconds()))))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, domain.MaxExerciseStateBytes+exerciseEnvelopeBytes)
	var req struct {
		RunID    *string         `json:"runId"`
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, problem.PayloadTooLarge("The submitted state exceeds 2 MB."))
			return
		}
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}
	if len(req.Snapshot) > domain.MaxExerciseStateBytes {
		fail(c, problem.PayloadTooLarge("The submitted state exceeds 2 MB."))
		return
	}
	if req.RunID == nil {
		fail(c, problem.Validation("The runId is required.", problem.InvalidParam{Name: "runId", Reason: "required"}))
		return
	}
	runID, ok := uuidParam(c, *req.RunID, "runId")
	if !ok {
		return
	}
	if trimmed := bytes.TrimSpace(req.Snapshot); len(trimmed) == 0 || string(trimmed) == "null" {
		fail(c, problem.Validation("The snapshot is required.", problem.InvalidParam{Name: "snapshot", Reason: "required"}))
		return
	}

	result, err := h.svc.SubmitExercise(c.Request.Context(), actor, classID, service.ExerciseSubmitInput{RunID: runID, Snapshot: req.Snapshot})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	if !result.Passed {
		c.JSON(http.StatusOK, gin.H{"passed": false})
		return
	}
	if result.Created {
		h.exerciseDone(c.Request.Context(), result)
	}
	res := result.Result
	c.JSON(http.StatusOK, gin.H{"passed": true, "completedAt": stamp(res.CompletedAt), "elapsedSeconds": res.ElapsedSeconds, "points": res.Points})
}

// exerciseDone tells the panel that a student concluded, and, when the result is already shown (a student who concluded in the 2 seconds after the
// end), tells the room the scoreboard again, with him in it.
func (h *Handler) exerciseDone(ctx context.Context, result service.ExerciseSubmitResult) {
	room, res := result.Run.SessionID.String(), result.Result
	h.hub.BroadcastTo(room, hub.Message{Type: typeExerciseDone, Data: mustMarshal(gin.H{
		"runId": res.RunID, "studentId": res.StudentID, "name": result.Name, "completedAt": stamp(res.CompletedAt),
		"elapsedSeconds": res.ElapsedSeconds, "points": res.Points, "attempts": res.Attempts,
	})}, isPanel)
	if !result.Run.ResultVisible {
		return
	}
	state, err := h.svc.ExerciseOf(ctx, result.Run.SessionID, false)
	if err != nil {
		h.log.Warn("classroom exercise result not sent", zap.String("room", room), zap.Error(err))
		return
	}
	if state != nil {
		wsHandler{h}.exerciseTell(room, typeExerciseResult, exerciseResultBody(*state))
	}
}
