package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
)

// The messages of the realtime channel (SPEC-051, section 5.8).
const (
	typeSlideChange = "live:slide:change"
	typeCursorMove  = "live:cursor:move"
	typeCanvasDraw  = "live:canvas:draw"
	typeModeSwitch  = "live:mode:switch"
	// SPEC-068: the panel chooses the presentation that is on the stage, and the server tells everybody which one it is.
	typeDeckSelect   = "live:deck:select"
	typeDeckChanged  = "live:deck:changed"
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

	// SPEC-073: a command the teacher ran in the presentation window, which the server keeps and relays to nobody
	typeTerminalCommand = "live:terminal:command"

	// SPEC-057: how far the teacher scrolled a pane of the stage, where he put the divider of the module, the zoom, and the text he selected
	typeStageScroll    = "live:stage:scroll"
	typeStageSplit     = "live:stage:split"
	typeStageZoom      = "live:stage:zoom"
	typeStageSelection = "live:stage:selection"

	// SPEC-059: the teacher asks the students to go full screen, from either of his windows
	typeStageFullscreen = "live:stage:fullscreen"

	// SPEC-063: the chat of the lesson, from the students and from the panel
	typeChatSend    = "live:chat:send"
	typeChatMessage = "live:chat:message"

	// SPEC-065: the exercise of the lesson. The panel starts, ends, shows the result and watches a student; the students report their progress
	// and, when watched, the picture of their terminal; the server tells the round, its end, the result, the progress, who concluded and who is watched.
	typeExerciseStart    = "live:exercise:start"
	typeExerciseEnd      = "live:exercise:end"
	typeExerciseReveal   = "live:exercise:reveal"
	typeExerciseWatch    = "live:exercise:watch"
	typeExerciseProgress = "live:exercise:progress"
	typeExerciseScreen   = "live:exercise:screen"
	typeExerciseStarted  = "live:exercise:started"
	typeExerciseEnded    = "live:exercise:ended"
	typeExerciseResult   = "live:exercise:result"
	typeExerciseDone     = "live:exercise:done"

	// SPEC-071: the guided practice. The panel pauses, gives more time, goes back to the lesson, takes over the terminal of a student and types
	// on it; the server tells the pause, the time, the close and the takeover, and gives the keys to the student taken over.
	typeExercisePause    = "live:exercise:pause"
	typeExerciseExtend   = "live:exercise:extend"
	typeExerciseClose    = "live:exercise:close"
	typeExerciseTakeover = "live:exercise:takeover"
	typeExerciseKey      = "live:exercise:key"
	typeExercisePaused   = "live:exercise:paused"
	typeExerciseExtended = "live:exercise:extended"
	typeExerciseClosed   = "live:exercise:closed"

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
			// the choice of the presentation is the panel's (SPEC-068)
			typeDeckSelect: {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			// the stage is the presenter window's (SPEC-055 RN-02)
			typeCursorMove:     {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Limited: true, Coalesce: true},
			typeCanvasDraw:     {MaxBytes: 16 * kib, ControllerOnly: true, Kind: viewPresenter, Limited: true},
			typeTerminalScreen: {MaxBytes: 256 * kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			// a command is the line, up to 4,000 characters of output and little else; it counts against the budget of its sender (SPEC-073)
			typeTerminalCommand: {MaxBytes: 8 * kib, ControllerOnly: true, Kind: viewPresenter, Limited: true},
			typeStageBlank:      {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter},
			typeStageScroll:     {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true, CoalesceKey: scrollKey},
			typeStageSplit:      {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			typeStageZoom:       {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			typeStageSelection:  {MaxBytes: kib, ControllerOnly: true, Kind: viewPresenter, Coalesce: true},
			// the request for the full screen is from either window of the teacher, so it has no Kind; it is tiny
			typeStageFullscreen: {MaxBytes: 256, ControllerOnly: true, Coalesce: true},
			// the waiting room and the hands are the panel's
			typeHandModerate:       {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeAdmissionAccept:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeAdmissionAcceptAll: {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeAdmissionRemove:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},

			// the question is up to 300 characters, which are up to 1,200 bytes, or more when the client escapes them (SPEC-058)
			typeHandRaise:        {MaxBytes: 4 * kib},
			typeHandLower:        {MaxBytes: kib},
			typeAdmissionRequest: {MaxBytes: kib, Limited: true, AllowWaiting: true},

			// the chat is the students' and the panel's, so the rule has no ControllerOnly and no Kind: the handler tells who is who. The text is
			// up to 500 characters, which are up to 2,000 bytes, or more when the client escapes them (SPEC-063)
			typeChatSend: {MaxBytes: 4 * kib, Limited: true},

			// the exercise is the panel's to start, end, show and watch; the progress and the picture of the terminal are the students', so those
			// two have no ControllerOnly and no Kind and the handler tells who is who. The progress is small (up to 200 characters of the last
			// command); the picture has the limit of the terminal of the teacher, is limited by the rate of its sender, and the panel gets only the
			// latest of each window (SPEC-065)
			typeExerciseStart:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseEnd:      {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseReveal:   {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseWatch:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseProgress: {MaxBytes: kib, Limited: true},
			typeExerciseScreen:   {MaxBytes: 256 * kib, Limited: true, Coalesce: true},
			// the guided practice is the panel's; a key is small, a paste is up to 2,000 characters, which are up to 8,000 bytes or more when the
			// client escapes them; the keys have their own limit of 40 a second, in the handler (SPEC-071)
			typeExercisePause:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseExtend:   {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseClose:    {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseTakeover: {MaxBytes: kib, ControllerOnly: true, Kind: viewPanel},
			typeExerciseKey:      {MaxBytes: 16 * kib, ControllerOnly: true, Kind: viewPanel},
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

// scrollData is the data of live:stage:scroll. Pointers tell a field that is missing from a 0.
type scrollData struct {
	Pane     *string  `json:"pane"`
	Y        *float64 `json:"y"`
	X        *float64 `json:"x"`
	Terminal *int     `json:"terminal"`
}

// valid checks the message: a pane that has a scroll and a position from 0 to 1; the terminal pane names its terminal (1 to 3), and no
// other pane takes one; only the slide has an x, from 0 to 1 (an x with another pane is rejected, not ignored). SPEC-057.
func (d scrollData) valid() bool {
	if d.Pane == nil || d.Y == nil {
		return false
	}
	if *d.Pane == domain.PaneTerminal {
		if d.Terminal == nil || !domain.ValidTerminalScroll(*d.Terminal, *d.Y) {
			return false
		}
	} else if d.Terminal != nil || !domain.ValidStageScroll(*d.Pane, *d.Y) {
		return false
	}
	return d.X == nil || domain.ValidStageScrollX(*d.Pane, *d.X)
}

// scrollKey is what a scroll message is the latest of in the window of the hub: its pane, and for the terminals the terminal too, so that
// scrolling several of them at once does not lose the position of any.
func scrollKey(msg hub.Message) string {
	var d struct {
		Pane     string `json:"pane"`
		Terminal int    `json:"terminal"`
	}
	_ = json.Unmarshal(msg.Data, &d) // a message that does not read was rejected before it got here
	if d.Pane == domain.PaneTerminal {
		return d.Pane + strconv.Itoa(d.Terminal)
	}
	return d.Pane
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

// isPanel tells a connection of the panel window of the teacher; a window that another replaced is a passive viewer and is not.
func isPanel(who hub.Identity) bool { return who.Role == hub.Controller && who.Kind == viewPanel }

// isStudent tells a connection of a student that the hub admitted: a viewer with the role of student. (The connections that wait are never
// asked by BroadcastTo, and a window of the teacher that was replaced has the role of the teacher.)
func isStudent(who hub.Identity) bool { return who.Role == hub.Viewer && who.Meta == authn.RoleStudent }

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
	return w.snapshot(ctx, room, kind, who.UserID)
}

// takeOverStage ends the waiting screen when a presenter window comes in, the one of the B key (SPEC-055) and the one that the lack of a window
// put there (SPEC-070); the others are told. A window that comes back inside the tolerance, or that replaces another, finds nothing to take off.
func (w wsHandler) takeOverStage(room string, who hub.Identity) {
	session := sessionOf(room)
	wasAway := w.h.windowOpened(room)
	keyOn := w.h.svc.StageBlank(session)
	if !keyOn && !wasAway {
		return
	}
	if keyOn {
		w.h.svc.SetStageBlank(session, false)
	}
	w.h.hub.Broadcast(room, hub.Message{Type: typeStageBlank, Data: mustMarshal(map[string]bool{"blank": false})}, who.ConnID)
}

func admissionState(status string) hub.Message {
	return hub.Message{Type: typeAdmissionState, Data: mustMarshal(map[string]string{"status": status})}
}

// snapshot is the state of the room for a connection of the kind: the panel also gets the waiting room, the start of the lesson and
// the state of the presenter window, reads the questions of the raised hands, the whole chat and who is online; the presenter gets the stage
// and the raised hands without their questions, and no chat; a student gets the room, the hands without questions, his own hand with his
// question in myHand, and the chat of the messages for everybody and of his conversation (SPEC-055 RN-05, SPEC-058, SPEC-063). student is the
// user of the connection.
func (w wsHandler) snapshot(ctx context.Context, room, kind, student string) (hub.Message, error) {
	a, err := w.h.svc.Snapshot(ctx, sessionOf(room))
	if err != nil {
		return hub.Message{}, err
	}
	body := activeBody(a, w.h.hub.Online(room), kind == viewPanel)
	body["stageBlank"] = w.h.svc.StageBlank(sessionOf(room)) || (kind != viewPresenter && w.h.windowAway(room)) // the window itself sees the stage (SPEC-070 RN-05)
	switch kind {
	case viewPanel:
		adm, err := w.h.svc.Admissions(ctx, sessionOf(room))
		if err != nil {
			return hub.Message{}, err
		}
		body["admissions"] = admissionsBody(adm)
		body["startedAt"] = a.Session.StartedAt
		body["presenterConnected"] = w.h.hub.KindConnected(room, viewPresenter)
		history, err := w.h.svc.ChatHistory(ctx, sessionOf(room), nil)
		if err != nil {
			return hub.Message{}, err
		}
		body["chat"] = chatsJSON(history)
		body["onlineStudents"] = w.h.hub.OnlineUsers(room)
		round, err := w.h.svc.ExerciseOf(ctx, sessionOf(room), true)
		if err != nil {
			return hub.Message{}, err
		}
		body["exercise"] = exerciseSnapshot(round, true, uuid.Nil, false)
	case viewPresenter:
		delete(body, "onlineCount")
	default:
		owner, err := uuid.Parse(student)
		if err != nil {
			return hub.Message{}, err
		}
		history, err := w.h.svc.ChatHistory(ctx, sessionOf(room), &owner)
		if err != nil {
			return hub.Message{}, err
		}
		body["myHand"] = myHand(a.HandRaises, student)
		body["chat"] = chatsJSON(history)
		round, err := w.h.svc.ExerciseOf(ctx, sessionOf(room), false)
		if err != nil {
			return hub.Message{}, err
		}
		body["exercise"] = exerciseSnapshot(round, false, owner, w.h.svc.ExerciseTakenOver(sessionOf(room), owner))
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
		if isStudent(who) {
			w.joinedExercise(room, who)
		}
		w.presence(room)
	}
}

func (w wsHandler) Left(room string, who hub.Identity) {
	if who.Kind == viewPresenter {
		w.presenterState(room) // the truth of the room, so a replaced window leaving does not close the presenter
		w.h.windowLeft(room)
	}
	switch {
	case who.Waiting:
		// who waits is not online in the room; the line only changes when the teacher decides
	case who.Role == hub.Viewer:
		w.presence(room)
		if isStudent(who) {
			w.leftExercise(room, who)
		}
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

// presence tells the room how many are online and whether the presentation window is there. The panel also gets who is online, the admitted
// students (SPEC-063); everybody else gets the message without that key.
func (w wsHandler) presence(room string) {
	body := map[string]any{"online": w.h.hub.Online(room), "presenterConnected": w.h.hub.KindConnected(room, viewPresenter)}
	plain := hub.Message{Type: typePresence, Data: mustMarshal(body)}
	body["onlineStudents"] = w.h.hub.OnlineUsers(room)
	w.h.hub.SendToKind(room, viewPanel, hub.Message{Type: typePresence, Data: mustMarshal(body)})
	w.h.hub.BroadcastTo(room, plain, func(who hub.Identity) bool { return !isPanel(who) })
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
	case typeDeckSelect:
		var d struct {
			DeckID *uuid.UUID `json:"deckId"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil || d.DeckID == nil {
			w.reject(room, who, msg, errors.New("the message needs the id of the presentation"))
			return
		}
		actor, err := actorOf(who)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		view, err := svc.SelectDeck(ctx, actor, session, *d.DeckID)
		if err != nil {
			w.reject(room, who, msg, err)
			return
		}
		// everybody, the panel that asked too: it needs the address of the presentation, which only the server can give
		w.h.hub.Broadcast(room, hub.Message{Type: typeDeckChanged, Data: mustMarshal(map[string]any{
			"activeDeck": deckJSON(view), "displayMode": domain.ModeSlides, "currentSlide": 1,
		})}, "")
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
	case typeTerminalCommand:
		// kept with the moment of the server and relayed to nobody: the panel and the students already see the terminal (SPEC-056)
		var d struct {
			Terminal        int    `json:"terminal"`
			Command         string `json:"command"`
			ExitStatus      *int   `json:"exitStatus"`
			Output          string `json:"output"`
			OutputTruncated bool   `json:"outputTruncated"`
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil {
			w.reject(room, who, msg, err)
			return
		}
		in := service.CommandInput{Terminal: d.Terminal, Command: d.Command, ExitStatus: d.ExitStatus, Output: d.Output, OutputTruncated: d.OutputTruncated}
		if _, err := svc.RecordCommand(ctx, session, in); err != nil {
			w.reject(room, who, msg, err)
			return
		}
	case typeStageScroll:
		var d scrollData
		if err := json.Unmarshal(msg.Data, &d); err != nil || !d.valid() {
			w.reject(room, who, msg, errors.New("the message needs a known pane, a position from 0 to 1, the terminal (1 to 3) for the terminal only and an x from 0 to 1 for the slide only"))
			return
		}
		switch *d.Pane {
		case domain.PaneTerminal:
			svc.SetTerminalScroll(session, *d.Terminal, *d.Y)
		case domain.PaneSlide:
			svc.SetStageScroll(session, *d.Pane, *d.Y)
			x := 0.0 // with no x the slide is at the left: the message says the whole position of the pane
			if d.X != nil {
				x = *d.X
			}
			svc.SetStageScrollX(session, x)
		default:
			svc.SetStageScroll(session, *d.Pane, *d.Y)
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
	case typeStageFullscreen:
		var d struct {
			Enabled *bool `json:"enabled"` // a pointer tells a missing field from false; anything but a boolean does not decode
		}
		if err := json.Unmarshal(msg.Data, &d); err != nil || d.Enabled == nil {
			w.reject(room, who, msg, errors.New("the message needs enabled as a boolean"))
			return
		}
		svc.SetStageFullscreen(session, *d.Enabled)
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
	case typeChatSend:
		w.chat(ctx, room, who, msg)
	case typeExerciseStart, typeExerciseEnd, typeExerciseReveal, typeExerciseWatch:
		w.exerciseControl(ctx, room, who, msg)
	case typeExercisePause, typeExerciseExtend, typeExerciseClose, typeExerciseTakeover, typeExerciseKey:
		w.guidedControl(ctx, room, who, msg)
	case typeExerciseProgress, typeExerciseScreen:
		w.exerciseStudent(ctx, room, who, msg)
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
	w.h.svc.JoinExercise(sessionOf(room), student) // admitted in the middle of a round, he is in it
	snap, err := w.snapshot(ctx, room, "", id)
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

// hands changes the queue of raised hands and sends the new queue to the whole room: with the questions to the panel, and without them to
// the students and to the presentation window (SPEC-058).
func (w wsHandler) hands(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	svc, session := w.h.svc, sessionOf(room)
	var (
		queue []domain.HandRaiseEntry
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
			// the question is optional: no data, {}, null and "" all raise the hand with none
			var d struct {
				Question *string `json:"question"`
			}
			if len(msg.Data) > 0 {
				if parseErr := json.Unmarshal(msg.Data, &d); parseErr != nil {
					w.reject(room, who, msg, parseErr)
					return
				}
			}
			question := ""
			if d.Question != nil {
				question = *d.Question
			}
			queue, err = svc.RaiseHand(ctx, session, student, question)
		} else {
			queue, err = svc.LowerHand(ctx, session, student)
		}
	case typeHandModerate:
		var d struct {
			StudentID *uuid.UUID `json:"studentId"`
		}
		if parseErr := json.Unmarshal(msg.Data, &d); parseErr != nil {
			w.reject(room, who, msg, parseErr)
			return
		}
		queue, err = svc.ModerateHand(ctx, session, d.StudentID)
	}
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	w.sendHandQueue(room, queue)
}

// sendHandQueue tells the room the queue of raised hands. The text of the doubts is for the teacher: the panel gets each hand with its
// question, and everybody else (the students, even the one who asked, and the presentation window) gets the hands without the key.
func (w wsHandler) sendHandQueue(room string, queue []domain.HandRaiseEntry) {
	full := hub.Message{Type: typeHandQueue, Data: mustMarshal(map[string]any{"queue": handsJSON(queue, true)})}
	plain := hub.Message{Type: typeHandQueue, Data: mustMarshal(map[string]any{"queue": handsJSON(queue, false)})}
	w.h.hub.SendToKind(room, viewPanel, full)
	w.h.hub.BroadcastTo(room, plain, func(who hub.Identity) bool { return !isPanel(who) })
}

// chat saves a message of the chat of the lesson and, only after it was saved, delivers it (SPEC-063 section 3.1). The student writes to the
// teacher, with the text and nothing else; the panel writes in particular to one student or, with "to":"all", to everybody. The presentation
// window and any other connection are dropped (the hub has already dropped who waits). A message that is not valid is rejected and sends
// nothing.
func (w wsHandler) chat(ctx context.Context, room string, who hub.Identity, msg hub.Message) {
	switch {
	case isStudent(who), isPanel(who):
	case who.Role == hub.Controller:
		w.Dropped(room, who, msg.Type, "wrong-view")
		return
	default:
		w.Dropped(room, who, msg.Type, "not-allowed")
		return
	}
	actor, err := actorOf(who)
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	text, student, err := parseChat(msg.Data, isStudent(who))
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	saved, err := w.h.svc.SendChat(ctx, actor, sessionOf(room), student, text)
	if err != nil {
		w.reject(room, who, msg, err)
		return
	}
	w.deliverChat(room, saved)
}

// parseChat reads the data of live:chat:send. A student sends the text and no other field: the message is for the teacher. The panel names
// exactly one destination, "to":"all" (the student comes back nil) or the studentId of one student.
func parseChat(data json.RawMessage, student bool) (text string, to *uuid.UUID, err error) {
	if len(data) == 0 {
		return "", nil, errors.New("the message needs data")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	if student {
		dec.DisallowUnknownFields()
		var d struct {
			Text *string `json:"text"`
		}
		if err := dec.Decode(&d); err != nil {
			return "", nil, err
		}
		if d.Text == nil {
			return "", nil, errors.New("the message needs the text")
		}
		return *d.Text, nil, nil
	}
	var d struct {
		Text      *string    `json:"text"`
		To        *string    `json:"to"`
		StudentID *uuid.UUID `json:"studentId"`
	}
	if err := dec.Decode(&d); err != nil {
		return "", nil, err
	}
	if d.Text == nil {
		return "", nil, errors.New("the message needs the text")
	}
	switch {
	case d.To != nil && *d.To == "all" && d.StudentID == nil:
		return *d.Text, nil, nil
	case d.To == nil && d.StudentID != nil:
		return *d.Text, d.StudentID, nil
	}
	return "", nil, errors.New("the message needs exactly one destination: \"to\":\"all\", or the studentId of a student")
}

// deliverChat sends a saved message: the panel always gets it; a private message also goes to the connections of its student (the confirmation
// of the sending, in any tab, when he wrote it) and nobody else; one for everybody goes to every admitted student. The presentation window
// and the waiting room never get it.
func (w wsHandler) deliverChat(room string, m domain.LiveChatMessage) {
	out := hub.Message{Type: typeChatMessage, Data: mustMarshal(chatJSON(m))}
	if m.StudentID == nil {
		w.h.hub.BroadcastTo(room, out, func(who hub.Identity) bool { return isPanel(who) || isStudent(who) })
		return
	}
	student := m.StudentID.String()
	w.h.hub.BroadcastTo(room, out, func(who hub.Identity) bool { return isPanel(who) || (isStudent(who) && who.UserID == student) })
}
