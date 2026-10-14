package handler

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// The messages of the realtime channel (SPEC-051, section 5.8).
const (
	typeSlideChange   = "live:slide:change"
	typeCursorMove    = "live:cursor:move"
	typeCanvasDraw    = "live:canvas:draw"
	typeModeSwitch    = "live:mode:switch"
	typeTerminalInput = "live:terminal:input"
	typeTerminalSync  = "live:terminal:sync"
	typeHandModerate  = "live:hand:moderate"
	typeHandRaise     = "live:hand:raise"
	typeHandLower     = "live:hand:lower"

	typeSnapshot  = "live:snapshot"
	typeEnded     = "live:ended"
	typeRevoked   = "live:control:revoked"
	typePresence  = "live:presence"
	typeHandQueue = "live:hand:queue"
)

// hubConfig sets the rules of each message and the limits of the room (SPEC-051 RN-05). The pointer, the strokes and the typing
// arrive about 30 times per second; the server takes up to 35 per second from each emitter and gives each viewer the latest every 30 ms.
func hubConfig() hub.Config {
	const kib = 1 << 10
	return hub.Config{
		Rules: map[string]hub.Rule{
			typeSlideChange:   {MaxBytes: kib, ControllerOnly: true},
			typeCursorMove:    {MaxBytes: kib, ControllerOnly: true, Limited: true, Coalesce: true},
			typeCanvasDraw:    {MaxBytes: 16 * kib, ControllerOnly: true, Limited: true},
			typeModeSwitch:    {MaxBytes: kib, ControllerOnly: true},
			typeTerminalInput: {MaxBytes: 4 * kib, ControllerOnly: true, Limited: true, Coalesce: true},
			typeTerminalSync:  {MaxBytes: 1024 * kib, ControllerOnly: true},
			typeHandModerate:  {MaxBytes: kib, ControllerOnly: true},
			typeHandRaise:     {MaxBytes: kib},
			typeHandLower:     {MaxBytes: kib},
		},
		MaxViewers:    100,
		RatePerSecond: 35,
		CoalesceEvery: 30 * time.Millisecond,
		RevokedType:   typeRevoked,
	}
}

// wsHandler is what the hub asks of the application: the snapshot, the messages and the bookkeeping of who comes and goes.
type wsHandler struct{ h *Handler }

func sessionOf(room string) uuid.UUID {
	id, _ := uuid.Parse(room)
	return id
}

func mustMarshal(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func (w wsHandler) Snapshot(ctx context.Context, room string, _ hub.Identity) (hub.Message, error) {
	a, err := w.h.svc.Snapshot(ctx, sessionOf(room))
	if err != nil {
		return hub.Message{}, err
	}
	return hub.Message{Type: typeSnapshot, Data: mustMarshal(activeBody(a, w.h.hub.Online(room)))}, nil
}

func (w wsHandler) Dropped(room string, who hub.Identity, msgType, reason string) {
	w.h.log.Warn("classroom message dropped", zap.String("room", room), zap.String("userId", who.UserID),
		zap.String("role", string(who.Role)), zap.String("type", msgType), zap.String("reason", reason))
}

func (w wsHandler) Joined(room string, who hub.Identity) {
	if who.Role == hub.Viewer {
		w.presence(room)
	}
}

func (w wsHandler) Left(room string, who hub.Identity) {
	switch who.Role {
	case hub.Viewer:
		w.presence(room)
	case hub.Controller:
		// The safety net counts the hours from the moment the teacher left (SPEC-051 RN-03).
		if err := w.h.svc.TeacherPresence(context.Background(), sessionOf(room)); err != nil {
			w.h.log.Warn("classroom teacher presence not saved", zap.String("room", room), zap.Error(err))
		}
	}
}

func (w wsHandler) presence(room string) {
	w.h.hub.Broadcast(room, hub.Message{Type: typePresence, Data: mustMarshal(map[string]int{"online": w.h.hub.Online(room)})}, "")
}

func (w wsHandler) reject(room string, who hub.Identity, msg hub.Message, err error) {
	w.h.log.Warn("classroom message rejected", zap.String("room", room), zap.String("userId", who.UserID), zap.String("type", msg.Type), zap.Error(err))
}

// Message runs a message that passed the checks of the hub: it saves what must survive, and passes it on to the room.
func (w wsHandler) Message(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	svc, session := w.h.svc, sessionOf(room)
	relay := func() { w.h.hub.Broadcast(room, msg, who.ConnID) }

	switch msg.Type {
	case typeSlideChange:
		var d struct {
			Slide int `json:"slide"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		if err := svc.ChangeSlide(ctx, session, d.Slide); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		relay()
	case typeCursorMove:
		relay()
	case typeCanvasDraw:
		svc.RememberDrawing(session, msg.Data)
		relay()
	case typeModeSwitch:
		var d struct {
			Mode     string     `json:"mode"`
			ModuleID *uuid.UUID `json:"moduleId"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		if err := svc.SwitchMode(ctx, session, d.Mode, d.ModuleID); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		relay()
	case typeTerminalInput:
		svc.RememberTerminalInput(session, msg.Data)
		relay()
	case typeTerminalSync:
		svc.RememberTerminalSync(session, msg.Data)
		relay()
	case typeHandRaise, typeHandLower, typeHandModerate:
		w.hands(ctx, room, who, msg)
	}
}

// hands changes the queue of raised hands and sends the new queue to the whole room.
func (w wsHandler) hands(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	svc, session := w.h.svc, sessionOf(room)
	var (
		queue []queueEntry
		err   error
	)
	switch msg.Type {
	case typeHandRaise, typeHandLower:
		student, parseErr := uuid.Parse(who.UserID)
		if parseErr != nil {
			w.reject(room, who, msg, parseErr)
			return
		}
		if msg.Type == typeHandRaise {
			queue, err = toQueue(svc.RaiseHand(ctx, session, student))
		} else {
			queue, err = toQueue(svc.LowerHand(ctx, session, student))
		}
	case typeHandModerate:
		var d struct {
			StudentID *uuid.UUID `json:"studentId"`
		}
		if parseErr := json.Unmarshal(msg.Data, &d); parseErr != nil {
			w.reject(room, who, msg, parseErr)
			return
		}
		queue, err = toQueue(svc.ModerateHand(ctx, session, d.StudentID))
	}
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	w.h.hub.Broadcast(room, hub.Message{Type: typeHandQueue, Data: mustMarshal(map[string]any{"queue": queue})}, "")
}

type queueEntry struct {
	StudentID   uuid.UUID `json:"studentId"`
	Name        string    `json:"name"`
	RequestedAt time.Time `json:"requestedAt"`
}

// toQueue shapes the queue for the wire; an error of the service goes through.
func toQueue(entries []domain.HandRaiseEntry, err error) ([]queueEntry, error) {
	out := make([]queueEntry, len(entries))
	for i, e := range entries {
		out[i] = queueEntry{StudentID: e.StudentID, Name: e.Name, RequestedAt: e.RequestedAt}
	}
	return out, err
}
