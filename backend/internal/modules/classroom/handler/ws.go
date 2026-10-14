package handler

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
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

	// SPEC-054: the waiting room, the module of the lesson and the broadcast of the terminal
	typeAdmissionAccept    = "live:admission:accept"
	typeAdmissionAcceptAll = "live:admission:accept-all"
	typeAdmissionRemove    = "live:admission:remove"
	typeAdmissionRequest   = "live:admission:request"
	typeModuleFocus        = "live:module:focus"
	typeTerminalBroadcast  = "live:terminal:broadcast"

	typeAdmissionState = "live:admission:state"
	typeAdmissionQueue = "live:admission:queue"

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

			typeAdmissionAccept:    {MaxBytes: kib, ControllerOnly: true},
			typeAdmissionAcceptAll: {MaxBytes: kib, ControllerOnly: true},
			typeAdmissionRemove:    {MaxBytes: kib, ControllerOnly: true},
			typeAdmissionRequest:   {MaxBytes: kib, Limited: true, AllowWaiting: true},
			typeModuleFocus:        {MaxBytes: kib, ControllerOnly: true},
			typeTerminalBroadcast:  {MaxBytes: kib, ControllerOnly: true},
		},
		MaxViewers:    100,
		MaxWaiting:    200,
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

// actorOf is who sent a message: the hub keeps the role the user had when he connected.
func actorOf(who hub.Identity) (service.Actor, error) {
	id, err := uuid.Parse(who.UserID)
	return service.Actor{UserID: id, Role: who.Meta}, err
}

// Snapshot is what a new connection gets first: the state of the room for who is in it (the teacher also gets the waiting room), and
// only his situation for a student who is not admitted (SPEC-054 RN-01, RN-05).
func (w wsHandler) Snapshot(ctx context.Context, room string, who hub.Identity) (hub.Message, error) {
	if who.Waiting {
		student, err := uuid.Parse(who.UserID)
		if err != nil {
			return hub.Message{}, err
		}
		status, err := w.h.svc.AdmissionState(ctx, sessionOf(room), student)
		if err != nil {
			return hub.Message{}, err
		}
		return admissionState(status), nil
	}
	return w.snapshot(ctx, room, who.Role == hub.Controller)
}

func admissionState(status string) hub.Message {
	return hub.Message{Type: typeAdmissionState, Data: mustMarshal(map[string]string{"status": status})}
}

func (w wsHandler) snapshot(ctx context.Context, room string, withAdmissions bool) (hub.Message, error) {
	a, err := w.h.svc.Snapshot(ctx, sessionOf(room))
	if err != nil {
		return hub.Message{}, err
	}
	body := activeBody(a, w.h.hub.Online(room))
	if withAdmissions {
		adm, err := w.h.svc.Admissions(ctx, sessionOf(room))
		if err != nil {
			return hub.Message{}, err
		}
		body["admissions"] = admissionsBody(adm)
	}
	return hub.Message{Type: typeSnapshot, Data: mustMarshal(body)}, nil
}

func (w wsHandler) Dropped(room string, who hub.Identity, msgType, reason string) {
	w.h.log.Warn("classroom message dropped", zap.String("room", room), zap.String("userId", who.UserID),
		zap.String("role", string(who.Role)), zap.String("type", msgType), zap.String("reason", reason))
}

func (w wsHandler) Joined(room string, who hub.Identity) {
	switch {
	case who.Waiting:
		w.queue(context.Background(), room) // the teacher sees the new student in the waiting room
	case who.Role == hub.Viewer:
		w.presence(room)
	}
}

func (w wsHandler) Left(room string, who hub.Identity) {
	switch {
	case who.Waiting:
		// who waits is not online in the room; the line only changes when the teacher decides
	case who.Role == hub.Viewer:
		w.presence(room)
	case who.Role == hub.Controller:
		// The safety net counts the hours from the moment the teacher left (SPEC-051 RN-03).
		if err := w.h.svc.TeacherPresence(context.Background(), sessionOf(room)); err != nil {
			w.h.log.Warn("classroom teacher presence not saved", zap.String("room", room), zap.Error(err))
		}
	}
}

// queue tells the teacher the waiting room and the admitted.
func (w wsHandler) queue(ctx context.Context, room string) {
	adm, err := w.h.svc.Admissions(ctx, sessionOf(room))
	if err != nil {
		w.h.log.Warn("classroom admissions not read", zap.String("room", room), zap.Error(err))
		return
	}
	w.h.hub.SendToController(room, hub.Message{Type: typeAdmissionQueue, Data: mustMarshal(admissionsBody(adm))})
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
		actor, err := actorOf(who)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		if err := svc.SwitchMode(ctx, actor, session, d.Mode, d.ModuleID); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		relay()
	case typeTerminalInput:
		if svc.RememberTerminalInput(session, msg.Data) {
			relay()
		}
	case typeTerminalSync:
		if svc.RememberTerminalSync(session, msg.Data) {
			relay()
		}
	case typeTerminalBroadcast:
		var d struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		svc.SetTerminalBroadcast(session, d.Enabled)
		relay()
	case typeModuleFocus:
		var d struct {
			BlockID string `json:"blockId"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		if err := svc.FocusModuleBlock(ctx, session, d.BlockID); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		relay()
	case typeAdmissionAccept, typeAdmissionAcceptAll, typeAdmissionRemove, typeAdmissionRequest:
		w.admissions(ctx, room, who, msg)
	case typeHandRaise, typeHandLower, typeHandModerate:
		w.hands(ctx, room, who, msg)
	}
}

// admissions runs the messages of the waiting room: the teacher decides, the student asks to come in again (SPEC-054).
func (w wsHandler) admissions(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	svc, session := w.h.svc, sessionOf(room)
	actor, err := actorOf(who)
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	var d struct {
		StudentID *uuid.UUID `json:"studentId"`
	}
	if msg.Type != typeAdmissionAcceptAll && msg.Type != typeAdmissionRequest {
		if err := json.Unmarshal(msg.Data, &d); err != nil || d.StudentID == nil {
			w.reject(room, who, msg, errors.New("the message needs the id of a student"))
			return
		}
	}
	switch msg.Type {
	case typeAdmissionAccept:
		adm, err := svc.Admit(ctx, actor, session, *d.StudentID)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.release(ctx, room, *d.StudentID)
		w.sendQueue(room, adm)
	case typeAdmissionAcceptAll:
		ids, adm, err := svc.AdmitAll(ctx, actor, session)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		for _, id := range ids {
			w.release(ctx, room, id)
		}
		w.sendQueue(room, adm)
	case typeAdmissionRemove:
		adm, err := svc.Remove(ctx, actor, session, *d.StudentID)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.h.hub.SendTo(room, d.StudentID.String(), admissionState(domain.AdmissionRemoved))
		w.h.hub.SetWaiting(room, d.StudentID.String(), true)
		w.presence(room)
		w.sendQueue(room, adm)
	case typeAdmissionRequest:
		status, err := svc.RequestAgain(ctx, session, actor.UserID)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		w.h.hub.SendTo(room, who.UserID, admissionState(status))
		if status == domain.AdmissionWaiting {
			w.queue(ctx, room)
		}
	}
}

// release lets the student into the room: he is told, starts to receive what the room broadcasts, and gets the state of the room.
func (w wsHandler) release(ctx context.Context, room string, student uuid.UUID) {
	id := student.String()
	w.h.hub.SendTo(room, id, admissionState(domain.AdmissionAdmitted))
	w.h.hub.SetWaiting(room, id, false)
	snap, err := w.snapshot(ctx, room, false)
	if err != nil {
		w.h.log.Warn("classroom snapshot of the admitted not sent", zap.String("room", room), zap.String("userId", id), zap.Error(err))
		return
	}
	w.h.hub.SendTo(room, id, snap)
	w.presence(room)
}

func (w wsHandler) sendQueue(room string, adm service.Admissions) {
	w.h.hub.SendToController(room, hub.Message{Type: typeAdmissionQueue, Data: mustMarshal(admissionsBody(adm))})
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
