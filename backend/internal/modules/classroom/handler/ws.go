package handler

import (
	"bytes"
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
	typeSlideChange  = "live:slide:change"
	typeCursorMove   = "live:cursor:move"
	typeCanvasDraw   = "live:canvas:draw"
	typeModeSwitch   = "live:mode:switch"
	typeHandModerate = "live:hand:moderate"
	typeHandRaise    = "live:hand:raise"
	typeHandLower    = "live:hand:lower"

	// SPEC-054: the waiting room and the module of the lesson
	typeAdmissionAccept    = "live:admission:accept"
	typeAdmissionAcceptAll = "live:admission:accept-all"
	typeAdmissionRemove    = "live:admission:remove"
	typeAdmissionRequest   = "live:admission:request"
	typeModuleFocus        = "live:module:focus"

	typeAdmissionState = "live:admission:state"
	typeAdmissionQueue = "live:admission:queue"

	// SPEC-055: the black screen of the stage, and the state of the presenter window for the panel
	typeStageBlank     = "live:stage:blank"
	typePresenterState = "live:presenter:state"

	// SPEC-056: the picture of the terminal window of the teacher, which the students and the panel see as it is
	typeTerminalScreen = "live:terminal:screen"

	// SPEC-057: how far the teacher scrolled a pane of the stage, where he put the divider of the module, the zoom, and the text he selected
	typeStageScroll    = "live:stage:scroll"
	typeStageSplit     = "live:stage:split"
	typeStageZoom      = "live:stage:zoom"
	typeStageSelection = "live:stage:selection"

	// clearSelectionData is the data of the message that takes the selection away, as it goes to the others
	clearSelectionData = `{"clear":true}`

	typeSnapshot  = "live:snapshot"
	typeEnded     = "live:ended"
	typeRevoked   = "live:control:revoked"
	typePresence  = "live:presence"
	typeHandQueue = "live:hand:queue"
)

// The two windows of the teacher (SPEC-055 RN-01), the value of the `view` parameter of the connection.
const (
	viewPanel     = "panel"
	viewPresenter = "presenter"
)

// hubConfig sets the rules of each message and the limits of the room (SPEC-051 RN-05). The pointer and the strokes arrive
// about 30 times per second; the server takes up to 35 per second from each emitter and gives each viewer the latest every 30 ms. The
// screen of the terminal is a whole picture, so the latest is all a viewer needs and it is not counted in that budget (the pointer would
// use it up and the last screen would be lost); the window of the presenter sends at most 10 per second, and the frame has its own limit
// (SPEC-056). The scroll, the divider, the zoom and the selection are the same: the latest is all a viewer needs, the window of the
// presenter limits them to 10 per second, and counting them would let the pointer take their budget (SPEC-057).
func hubConfig() hub.Config {
	const kib = 1 << 10
	return hub.Config{
		Rules: map[string]hub.Rule{
			// the slide, the mode and the focus come from either window of the teacher
			typeSlideChange: {MaxBytes: kib, ControllerOnly: true},
			typeModeSwitch:  {MaxBytes: kib, ControllerOnly: true},
			typeModuleFocus: {MaxBytes: kib, ControllerOnly: true},
			// the stage is the presenter window's (SPEC-055 RN-02)
			typeCursorMove:     {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Limited: true, Coalesce: true},
			typeCanvasDraw:     {MaxBytes: 16 * kib, ControllerOnly: true, Kind: viewPresenter, Limited: true},
			typeTerminalScreen: {MaxBytes: 256 * kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			typeStageBlank:     {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter},
			typeStageScroll:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			typeStageSplit:     {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			typeStageZoom:      {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			typeStageSelection: {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			// the waiting room and the hands are the panel's
			typeHandModerate:       {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeAdmissionAccept:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeAdmissionAcceptAll: {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeAdmissionRemove:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},

			typeHandRaise:        {MaxBytes: kib},
			typeHandLower:        {MaxBytes: kib},
			typeAdmissionRequest: {MaxBytes: kib, Limited: true, AllowWaiting: true},
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

// isObject tells whether the JSON value is an object (the caller already knows it is valid JSON).
func isObject(raw json.RawMessage) bool {
	raw = bytes.TrimSpace(raw)
	return len(raw) > 0 && raw[0] == '{'
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
	kind := ""
	if who.Role == hub.Controller {
		kind = who.Kind
	}
	if kind == viewPresenter {
		w.takeOverStage(room, who)
	}
	return w.snapshot(ctx, room, kind)
}

// takeOverStage ends the black screen when a new presenter window takes over; the others are told (SPEC-055).
func (w wsHandler) takeOverStage(room string, who hub.Identity) {
	session := sessionOf(room)
	if !w.h.svc.StageBlank(session) {
		return
	}
	w.h.svc.SetStageBlank(session, false)
	w.h.hub.Broadcast(room, hub.Message{Type: typeStageBlank, Data: mustMarshal(map[string]bool{"blank": false})}, who.ConnID)
}

func admissionState(status string) hub.Message {
	return hub.Message{Type: typeAdmissionState, Data: mustMarshal(map[string]string{"status": status})}
}

// snapshot is the state of the room for a connection of the kind: the panel also gets the waiting room, the start of the lesson and
// the state of the presenter window; the presenter gets the stage only; a student gets the room (SPEC-055 RN-05).
func (w wsHandler) snapshot(ctx context.Context, room, kind string) (hub.Message, error) {
	a, err := w.h.svc.Snapshot(ctx, sessionOf(room))
	if err != nil {
		return hub.Message{}, err
	}
	body := activeBody(a, w.h.hub.Online(room))
	body["stageBlank"] = w.h.svc.StageBlank(sessionOf(room))
	switch kind {
	case viewPanel:
		adm, err := w.h.svc.Admissions(ctx, sessionOf(room))
		if err != nil {
			return hub.Message{}, err
		}
		body["admissions"] = admissionsBody(adm)
		body["startedAt"] = a.Session.StartedAt
		body["presenterConnected"] = w.h.hub.KindConnected(room, viewPresenter)
	case viewPresenter:
		delete(body, "handRaises")
		delete(body, "onlineCount")
	}
	return hub.Message{Type: typeSnapshot, Data: mustMarshal(body)}, nil
}

// Dropped writes the audit entry of a message the hub discarded: a message over the limit of its type is rejected, like one whose body is
// wrong; the others (type, role, window, rate) are dropped.
func (w wsHandler) Dropped(room string, who hub.Identity, msgType, reason string) {
	event := "classroom message dropped"
	if reason == "too-large" {
		event = "classroom message rejected"
	}
	w.h.log.Warn(event, zap.String("room", room), zap.String("userId", who.UserID),
		zap.String("role", string(who.Role)), zap.String("type", msgType), zap.String("reason", reason))
}

func (w wsHandler) Joined(room string, who hub.Identity) {
	if who.Kind == viewPresenter {
		w.presenterState(room)
	}
	switch {
	case who.Waiting:
		w.queue(context.Background(), room) // the teacher sees the new student in the waiting room
	case who.Role == hub.Viewer:
		w.presence(room)
	}
}

func (w wsHandler) Left(room string, who hub.Identity) {
	if who.Kind == viewPresenter {
		w.presenterState(room) // the truth of the room, so a replaced window leaving does not close the presenter
	}
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
	w.sendQueue(room, adm)
}

// presenterState tells the panel whether the presenter window is connected.
func (w wsHandler) presenterState(room string) {
	connected := w.h.hub.KindConnected(room, viewPresenter)
	w.h.hub.SendToKind(room, viewPanel, hub.Message{Type: typePresenterState, Data: mustMarshal(map[string]bool{"connected": connected})})
}

func (w wsHandler) presence(room string) {
	body := map[string]any{"online": w.h.hub.Online(room), "presenterConnected": w.h.hub.KindConnected(room, viewPresenter)}
	w.h.hub.Broadcast(room, hub.Message{Type: typePresence, Data: mustMarshal(body)}, "")
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
	case typeTerminalScreen:
		// the server does not read the picture: it only checks that it is an object, keeps the latest and passes it on
		var d struct {
			Screen json.RawMessage `json:"screen"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil || !isObject(d.Screen) {
			w.reject(room, who, msg, errors.New("the message needs the screen as an object"))
			return
		}
		svc.RememberTerminalScreen(session, d.Screen)
		relay()
	case typeStageScroll:
		// pointers tell a missing field from a 0; the domain checks the pane and the range. Only the slide has x (the material is rejected
		// with one, not ignored), and with no x the slide is at the left: the message says the whole position of the pane.
		var d struct {
			Pane *string  `json:"pane"`
			Y    *float64 `json:"y"`
			X    *float64 `json:"x"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil || d.Pane == nil || d.Y == nil || !domain.ValidStageScroll(*d.Pane, *d.Y) ||
			(d.X != nil && !domain.ValidStageScrollX(*d.Pane, *d.X)) {
			w.reject(room, who, msg, errors.New("the message needs a known pane, a position from 0 to 1 and, for the slide only, an x from 0 to 1"))
			return
		}
		svc.SetStageScroll(session, *d.Pane, *d.Y)
		if *d.Pane == domain.PaneSlide {
			x := 0.0
			if d.X != nil {
				x = *d.X
			}
			svc.SetStageScrollX(session, x)
		}
		relay()
	case typeStageZoom:
		var d struct {
			Zoom *float64 `json:"zoom"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil || d.Zoom == nil || !domain.ValidStageZoom(*d.Zoom) {
			w.reject(room, who, msg, errors.New("the message needs a zoom from 1 to 2"))
			return
		}
		svc.SetStageZoom(session, *d.Zoom)
		relay()
	case typeStageSelection:
		// the domain checks the three shapes and gives what is kept and passed on: the selection with only the fields of its shape
		cleared, selection, err := domain.ParseStageSelection(msg.Data)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		svc.SetStageSelection(session, selection) // nil is no selection
		out := selection
		if cleared {
			out = json.RawMessage(clearSelectionData)
		}
		w.h.hub.Broadcast(room, hub.Message{Type: msg.Type, Data: out}, who.ConnID)
	case typeStageSplit:
		var d struct {
			Ratio *float64 `json:"ratio"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil || d.Ratio == nil || !domain.ValidStageSplit(*d.Ratio) {
			w.reject(room, who, msg, errors.New("the message needs a divider from 0.2 to 0.8"))
			return
		}
		svc.SetStageSplit(session, *d.Ratio)
		relay()
	case typeStageBlank:
		var d struct {
			Blank *bool `json:"blank"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil || d.Blank == nil {
			w.reject(room, who, msg, errors.New("the message needs the blank flag"))
			return
		}
		svc.SetStageBlank(session, *d.Blank)
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
	snap, err := w.snapshot(ctx, room, "")
	if err != nil {
		w.h.log.Warn("classroom snapshot of the admitted not sent", zap.String("room", room), zap.String("userId", id), zap.Error(err))
		return
	}
	w.h.hub.SendTo(room, id, snap)
	w.presence(room)
}

func (w wsHandler) sendQueue(room string, adm service.Admissions) {
	w.h.hub.SendToKind(room, viewPanel, hub.Message{Type: typeAdmissionQueue, Data: mustMarshal(admissionsBody(adm))})
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
