package handler

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// ---- the guided practice of the lesson (SPEC-071) ----

// guidedControl runs the messages of the panel of the guided practice: pause, more time, going back to the lesson, the takeover and its keys
// (section 3.3). Only the panel window sends them; a message that is not valid, or that the service refuses, is rejected and sends nothing.
func (w wsHandler) guidedControl(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	if !isPanel(who) {
		reason := "not-allowed"
		if who.Role == hub.Controller {
			reason = "wrong-view"
		}
		w.Dropped(room, who, msg.Type, reason)
		return
	}
	if msg.Type == typeExerciseKey {
		w.takeoverKey(room, who, msg)
		return
	}
	actor, err := actorOf(who)
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	svc, session := w.h.svc, sessionOf(room)
	switch msg.Type {
	case typeExercisePause:
		paused, err := parseBool(msg.Data, "paused")
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		st, err := svc.PauseExercise(ctx, actor, session, paused)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.exerciseTell(room, typeExercisePaused, gin.H{"runId": st.Run.ID, "paused": st.Run.Paused(), "endsAt": stamp(st.Run.EndsAt),
			"pausedSeconds": st.Run.PausedSeconds, "now": stamp(st.Now)})
		w.released(room, st.Released)
	case typeExerciseExtend:
		minutes, err := parseExtend(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		st, err := svc.ExtendExercise(ctx, actor, session, minutes)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.exerciseTell(room, typeExerciseExtended, gin.H{"runId": st.Run.ID, "endsAt": stamp(st.Run.EndsAt), "durationSeconds": st.Run.DurationSeconds,
			"reopened": st.Reopened, "now": stamp(st.Now)})
	case typeExerciseClose:
		if err := parseExerciseEnd(msg.Data); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		st, err := svc.CloseExercise(ctx, actor, session)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		if st.Ended {
			w.exerciseEnded(room, st)
		} else {
			w.released(room, st.Released)
		}
		w.exerciseTell(room, typeExerciseClosed, gin.H{"runId": st.Run.ID, "closedAt": stampPtr(st.Run.ClosedAt), "now": stamp(st.Now)})
	case typeExerciseTakeover:
		student, on, err := parseTakeover(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		online := slices.Contains(w.h.hub.OnlineUsers(room), student.String())
		got, err := svc.TakeoverExercise(ctx, actor, session, student, on, online)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.tellTakeover(room, got)
	}
}

// takeoverKey passes a key or a paste of the panel to the tabs of the student taken over, in the order it came; up to 40 a second from each
// connection of the panel, and only to the student taken over (the rest is dropped).
func (w wsHandler) takeoverKey(room string, who hub.Identity, msg hub.Message) {
	student, out, err := parseTakeoverKey(msg.Data)
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	if !w.h.svc.TakeoverKeyAllowed(sessionOf(room), student) {
		w.Dropped(room, who, msg.Type, "not-taken-over")
		return
	}
	if allowed, _ := w.h.keys.Allow(who.ConnID); !allowed {
		w.Dropped(room, who, msg.Type, "rate")
		return
	}
	w.toStudent(room, student, hub.Message{Type: typeExerciseKey, Data: mustMarshal(out)})
}

// toStudent sends a message to every tab of the student.
func (w wsHandler) toStudent(room string, student uuid.UUID, msg hub.Message) {
	id := student.String()
	w.h.hub.BroadcastTo(room, msg, func(who hub.Identity) bool { return isStudent(who) && who.UserID == id })
}

// tellTakeover tells the student, in every tab, that the teacher took over his terminal (with the name of the teacher) or gave it back, and tells
// the panel which student it is.
func (w wsHandler) tellTakeover(room string, t service.ExerciseTakeover) {
	toStudent := gin.H{"on": t.On}
	if t.On {
		toStudent["teacherName"] = t.TeacherName
	}
	w.toStudent(room, t.Student, hub.Message{Type: typeExerciseTakeover, Data: mustMarshal(toStudent)})
	w.h.hub.BroadcastTo(room, hub.Message{Type: typeExerciseTakeover, Data: mustMarshal(gin.H{"studentId": t.Student, "on": t.On})}, isPanel)
}

// released tells that the takeover of the student ended by something else: the pause, the end, the close, another student watched.
func (w wsHandler) released(room string, student *uuid.UUID) {
	if student != nil {
		w.tellTakeover(room, service.ExerciseTakeover{Student: *student})
	}
}

// leftExercise ends the takeover of a student who left the room, when none of his tabs is left (RN-06), and tells the panel.
func (w wsHandler) leftExercise(room string, who hub.Identity) {
	if slices.Contains(w.h.hub.OnlineUsers(room), who.UserID) {
		return
	}
	student, err := uuid.Parse(who.UserID)
	if err != nil {
		return
	}
	if w.h.svc.ReleaseTakeoverOf(sessionOf(room), student) {
		w.h.hub.BroadcastTo(room, hub.Message{Type: typeExerciseTakeover, Data: mustMarshal(gin.H{"studentId": student, "on": false})}, isPanel)
	}
}

// parseBool reads an object with one boolean field, which must be there.
func parseBool(data json.RawMessage, name string) (bool, error) {
	var d map[string]json.RawMessage
	if err := decodeExercise(data, &d); err != nil {
		return false, err
	}
	var v bool
	raw, ok := d[name]
	if !ok || json.Unmarshal(raw, &v) != nil {
		return false, errors.New("the message needs " + name + " as a boolean")
	}
	return v, nil
}

// parseExtend reads the data of live:exercise:extend: the minutes, a whole number; the range is the domain's.
func parseExtend(data json.RawMessage) (int, error) {
	var d struct {
		Minutes *int `json:"minutes"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return 0, err
	}
	if d.Minutes == nil {
		return 0, errors.New("the message needs the minutes")
	}
	if *d.Minutes < 1 || *d.Minutes > domain.MaxExerciseExtraMinutes {
		return 0, domain.ErrInvalidExerciseExtension
	}
	return *d.Minutes, nil
}

// parseTakeover reads the data of live:exercise:takeover: the student and on.
func parseTakeover(data json.RawMessage) (uuid.UUID, bool, error) {
	var d struct {
		StudentID *uuid.UUID `json:"studentId"`
		On        *bool      `json:"on"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return uuid.Nil, false, err
	}
	if d.StudentID == nil || d.On == nil {
		return uuid.Nil, false, errors.New("the message needs the studentId and on")
	}
	return *d.StudentID, *d.On, nil
}

// parseTakeoverKey reads the data of live:exercise:key: the student and either a key, with its modifiers, or a paste; never both. It returns what
// goes to the student.
func parseTakeoverKey(data json.RawMessage) (uuid.UUID, gin.H, error) {
	var d struct {
		StudentID *uuid.UUID `json:"studentId"`
		Key       *string    `json:"key"`
		Paste     *string    `json:"paste"`
		Ctrl      bool       `json:"ctrl"`
		Alt       bool       `json:"alt"`
		Shift     bool       `json:"shift"`
	}
	if err := decodeExercise(data, &d); err != nil {
		return uuid.Nil, nil, err
	}
	switch {
	case d.StudentID == nil:
		return uuid.Nil, nil, errors.New("the message needs the studentId")
	case (d.Key == nil) == (d.Paste == nil):
		return uuid.Nil, nil, errors.New("the message has a key or a paste")
	case d.Key != nil:
		if err := domain.ValidateTakeoverKey(*d.Key); err != nil {
			return uuid.Nil, nil, err
		}
		return *d.StudentID, gin.H{"key": *d.Key, "ctrl": d.Ctrl, "alt": d.Alt, "shift": d.Shift}, nil
	}
	if err := domain.ValidateTakeoverPaste(*d.Paste); err != nil {
		return uuid.Nil, nil, err
	}
	return *d.StudentID, gin.H{"paste": *d.Paste}, nil
}
