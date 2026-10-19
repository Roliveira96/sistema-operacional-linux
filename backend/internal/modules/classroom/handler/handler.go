// Package handler exposes the live classroom over HTTP and WebSocket (SPEC-051, section 5).
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/hub"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
)

// Service is what the handler uses from the service.
type Service interface {
	StartSession(ctx context.Context, actor service.Actor, classID uuid.UUID, in service.StartInput) (domain.LiveClassroomSession, bool, error)
	EndSession(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID) (domain.LiveClassroomSession, error)
	UploadDeck(ctx context.Context, actor service.Actor, classID uuid.UUID, in service.UploadInput) (service.DeckView, error)
	ListDecks(ctx context.Context, actor service.Actor, classID uuid.UUID) ([]domain.SlideDeck, error)
	GetActive(ctx context.Context, actor service.Actor, classID uuid.UUID) (service.Active, error)
	SelectDeck(ctx context.Context, actor service.Actor, sessionID, deckID uuid.UUID) (service.DeckView, error)
	ListMyLive(ctx context.Context, actor service.Actor) ([]service.StudentRoom, error)
	ListSessions(ctx context.Context, actor service.Actor, classID uuid.UUID) ([]service.SessionSummary, error)
	SaveNote(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID, content string) (domain.LiveClassroomNote, error)
	GetNote(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID) (domain.LiveClassroomNote, error)
	ListNoteBlocks(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID) ([]domain.LiveClassroomNoteBlock, error)
	CreateNoteBlock(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID, contentMarkdown string) (domain.LiveClassroomNoteBlock, error)
	UpdateNoteBlock(ctx context.Context, actor service.Actor, classID, sessionID, blockID uuid.UUID, contentMarkdown string) (domain.LiveClassroomNoteBlock, error)
	DeleteNoteBlock(ctx context.Context, actor service.Actor, classID, sessionID, blockID uuid.UUID) error
	UploadNoteImage(ctx context.Context, actor service.Actor, classID, sessionID uuid.UUID, in service.NoteImageInput) (service.NoteImageCreated, error)
	OpenNoteImage(ctx context.Context, actor service.Actor, imageID uuid.UUID) (service.NoteImageStream, error)

	Connect(ctx context.Context, actor service.Actor, classID uuid.UUID) (service.Connection, error)
	Snapshot(ctx context.Context, sessionID uuid.UUID) (service.Active, error)
	ChangeSlide(ctx context.Context, sessionID uuid.UUID, slide int) error
	SwitchMode(ctx context.Context, actor service.Actor, sessionID uuid.UUID, mode string, moduleID *uuid.UUID) error
	FocusModuleBlock(ctx context.Context, sessionID uuid.UUID, blockID string) error
	RememberDrawing(sessionID uuid.UUID, raw json.RawMessage)
	RememberTerminalScreen(sessionID uuid.UUID, screen json.RawMessage)
	SetStageBlank(sessionID uuid.UUID, on bool)
	StageBlank(sessionID uuid.UUID) bool
	SetStageScroll(sessionID uuid.UUID, pane string, y float64)
	SetStageScrollX(sessionID uuid.UUID, x float64)
	SetTerminalScroll(sessionID uuid.UUID, terminal int, y float64)
	SetStageSplit(sessionID uuid.UUID, ratio float64)
	SetStageZoom(sessionID uuid.UUID, zoom float64)
	SetStageFullscreen(sessionID uuid.UUID, on bool)
	SetStageSelection(sessionID uuid.UUID, selection json.RawMessage)
	ModuleOfRoom(ctx context.Context, actor service.Actor, classID uuid.UUID) (service.ModuleView, error)

	AdmissionState(ctx context.Context, sessionID, studentID uuid.UUID) (string, error)
	Admissions(ctx context.Context, sessionID uuid.UUID) (service.Admissions, error)
	Admit(ctx context.Context, actor service.Actor, sessionID, studentID uuid.UUID) (service.Admissions, error)
	AdmitAll(ctx context.Context, actor service.Actor, sessionID uuid.UUID) ([]uuid.UUID, service.Admissions, error)
	Remove(ctx context.Context, actor service.Actor, sessionID, studentID uuid.UUID) (service.Admissions, error)
	RequestAgain(ctx context.Context, sessionID, studentID uuid.UUID) (string, error)
	RaiseHand(ctx context.Context, sessionID, studentID uuid.UUID, question string) ([]domain.HandRaiseEntry, error)
	LowerHand(ctx context.Context, sessionID, studentID uuid.UUID) ([]domain.HandRaiseEntry, error)
	ModerateHand(ctx context.Context, sessionID uuid.UUID, studentID *uuid.UUID) ([]domain.HandRaiseEntry, error)
	TeacherPresence(ctx context.Context, sessionID uuid.UUID) error
	SendChat(ctx context.Context, actor service.Actor, sessionID uuid.UUID, student *uuid.UUID, text string) (domain.LiveChatMessage, error)
	ChatHistory(ctx context.Context, sessionID uuid.UUID, student *uuid.UUID) ([]domain.LiveChatMessage, error)

	// The exercise of the lesson (SPEC-065).
	StartExercise(ctx context.Context, actor service.Actor, sessionID uuid.UUID, in service.ExerciseStartInput) (service.ExerciseState, error)
	EndExercise(ctx context.Context, actor service.Actor, sessionID uuid.UUID) (service.ExerciseState, error)
	RevealExercise(ctx context.Context, actor service.Actor, sessionID uuid.UUID, visible bool) (service.ExerciseState, error)
	WatchExercise(ctx context.Context, actor service.Actor, sessionID uuid.UUID, student *uuid.UUID) (service.ExerciseWatch, error)
	ExerciseScreenAllowed(sessionID, student, runID uuid.UUID) bool
	ExerciseWatching(sessionID, student uuid.UUID) bool
	JoinExercise(sessionID uuid.UUID, students ...uuid.UUID)
	RecordExerciseProgress(ctx context.Context, sessionID, student uuid.UUID, in service.ExerciseProgressInput) (service.ExerciseProgress, error)
	ExerciseOf(ctx context.Context, sessionID uuid.UUID, withProgress bool) (*service.ExerciseState, error)
	SubmitExercise(ctx context.Context, actor service.Actor, classID uuid.UUID, in service.ExerciseSubmitInput) (service.ExerciseSubmitResult, error)
	// the guided practice (SPEC-071)
	PauseExercise(ctx context.Context, actor service.Actor, sessionID uuid.UUID, paused bool) (service.ExerciseState, error)
	ExtendExercise(ctx context.Context, actor service.Actor, sessionID uuid.UUID, minutes int) (service.ExerciseState, error)
	CloseExercise(ctx context.Context, actor service.Actor, sessionID uuid.UUID) (service.ExerciseState, error)
	TakeoverExercise(ctx context.Context, actor service.Actor, sessionID, student uuid.UUID, on, online bool) (service.ExerciseTakeover, error)
	TakeoverKeyAllowed(sessionID, student uuid.UUID) bool
	ExerciseTakenOver(sessionID, student uuid.UUID) bool
	ReleaseTakeoverOf(sessionID, student uuid.UUID) bool
}

// Limiter says whether a key may do something again now, and if not, how long it has to wait.
type Limiter interface {
	Allow(key string) (bool, time.Duration)
}

// Options are the settings of the handler.
type Options struct {
	// AllowedOrigins are the origins that may open the WebSocket, such as the address of the frontend. With none, the origin must be
	// the address the request was sent to.
	AllowedOrigins []string
	// AnyOrigin accepts every origin; only for local development, where the page may come by the address or by localhost.
	AnyOrigin bool
	// SubmitLimiter limits the submissions of the state of the exercise, by student (SPEC-065); with none it is one each 2 seconds.
	SubmitLimiter Limiter
	// After runs the tolerance for a presenter window that left (SPEC-070); with none it is time.AfterFunc, and a test puts its own.
	After service.AfterFunc
}

// Handler serves the routes of the live classroom.
type Handler struct {
	svc      Service
	auth     authn.Validator
	log      *zap.Logger
	hub      *hub.Hub
	upgrader websocket.Upgrader
	submits  Limiter
	after    service.AfterFunc
	windows  stageWindows
	// keys limits the keys of the takeover, by connection of the panel (SPEC-071)
	keys Limiter
}

// New creates the handler and the hub of its rooms.
func New(svc Service, auth authn.Validator, log *zap.Logger, opts Options) *Handler {
	h := &Handler{svc: svc, auth: auth, log: log, submits: opts.SubmitLimiter, after: opts.After}
	if h.after == nil {
		h.after = defaultAfter
	}
	if h.submits == nil {
		h.submits = ratelimit.New(1, domain.ExerciseSubmitInterval)
	}
	h.keys = ratelimit.New(domain.TakeoverKeysPerSecond, time.Second)
	h.upgrader = websocket.Upgrader{CheckOrigin: originChecker(opts)}
	h.hub = hub.New(hubConfig(), wsHandler{h}, log)
	return h
}

// originChecker accepts a request with no origin (not a browser), an allowed origin, or an origin on the same host.
func originChecker(opts Options) func(r *http.Request) bool {
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" || opts.AnyOrigin {
			return true
		}
		for _, a := range opts.AllowedOrigins {
			if a == origin {
				return true
			}
		}
		u, err := url.Parse(origin)
		return len(opts.AllowedOrigins) == 0 && err == nil && u.Host == r.Host
	}
}

// Register wires the routes under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("", authn.Required(h.auth), authn.PasswordChanged())
	g.GET("/me/live", h.myLive)
	g.POST("/classes/:id/live/start", h.start)
	g.POST("/classes/:id/live/sessions/:sessionId/end", h.end)
	g.POST("/classes/:id/live/decks", h.upload)
	g.GET("/classes/:id/live/decks", h.decks)
	g.GET("/classes/:id/live/active", h.active)
	g.GET("/classes/:id/live/module", h.module)
	g.GET("/classes/:id/live/sessions", h.sessions)
	g.PUT("/classes/:id/live/sessions/:sessionId/notes", h.saveNote)
	g.GET("/classes/:id/live/sessions/:sessionId/notes", h.getNote)
	g.GET("/classes/:id/live/sessions/:sessionId/note-blocks", h.listNoteBlocks)
	g.POST("/classes/:id/live/sessions/:sessionId/note-blocks", h.createNoteBlock)
	g.PATCH("/classes/:id/live/sessions/:sessionId/note-blocks/:blockId", h.updateNoteBlock)
	g.DELETE("/classes/:id/live/sessions/:sessionId/note-blocks/:blockId", h.deleteNoteBlock)
	g.POST("/classes/:id/live/sessions/:sessionId/note-images", h.uploadNoteImage)
	g.GET("/media/notes/:imageId", h.getNoteImage)
	g.GET("/classes/:id/live/ws", h.connect)
	g.POST("/classes/:id/live/exercise/submit", h.submitExercise)
}

// CloseRoom tells everyone in the room that the lesson ended, and disconnects them.
func (h *Handler) CloseRoom(sessionID uuid.UUID) {
	h.windowRoomClosed(sessionID.String())
	h.hub.Close(sessionID.String(), hub.Message{Type: typeEnded})
}

// ControllerConnected tells whether the teacher is connected to the room.
func (h *Handler) ControllerConnected(sessionID uuid.UUID) bool {
	return h.hub.ControllerConnected(sessionID.String())
}

// ---- JSON ----

func sessionJSON(s domain.LiveClassroomSession) gin.H {
	return gin.H{
		"id": s.ID, "classId": s.ClassID, "title": s.Title, "classSessionId": s.ClassSessionID, "status": s.Status,
		"displayMode": s.DisplayMode, "currentSlide": s.CurrentSlide, "startedAt": s.StartedAt, "endedAt": s.EndedAt,
	}
}

func deckJSON(v service.DeckView) gin.H {
	return gin.H{"id": v.Deck.ID, "title": v.Deck.Title, "pageCount": v.Deck.PageCount, "kind": v.Deck.Kind, "downloadUrl": v.DownloadURL}
}

// handsJSON is the queue of raised hands. The question of each one (empty with none) goes only where withQuestions is true, which is the
// teacher: the text of a doubt never goes to a student or to the presentation window (SPEC-058).
func handsJSON(entries []domain.HandRaiseEntry, withQuestions bool) []gin.H {
	out := make([]gin.H, 0, len(entries))
	for _, e := range entries {
		hand := gin.H{"studentId": e.StudentID, "name": e.Name, "requestedAt": e.RequestedAt}
		if withQuestions {
			hand["question"] = e.Question
		}
		out = append(out, hand)
	}
	return out
}

// myHand is the hand of the student in the queue, with his own question, so that his screen can restore the field (SPEC-058).
func myHand(entries []domain.HandRaiseEntry, student string) gin.H {
	for _, e := range entries {
		if e.StudentID.String() == student {
			return gin.H{"raised": true, "question": e.Question}
		}
	}
	return gin.H{"raised": false, "question": ""}
}

// chatJSON is a message of the chat as the clients read it (SPEC-063): a private one carries the studentId that owns the conversation, whoever
// wrote it; one for everybody has none.
func chatJSON(m domain.LiveChatMessage) gin.H {
	out := gin.H{"id": m.ID, "scope": "all", "from": m.SenderRole, "text": m.Body, "createdAt": m.CreatedAt.UTC()}
	if m.StudentID != nil {
		out["scope"], out["studentId"] = "private", *m.StudentID
	}
	return out
}

// chatsJSON is the history of the chat for the snapshot: a list, never null.
func chatsJSON(list []domain.LiveChatMessage) []gin.H {
	out := make([]gin.H, 0, len(list))
	for _, m := range list {
		out = append(out, chatJSON(m))
	}
	return out
}

// stageViewJSON is how the teacher left the stage: the scroll of each pane (the slide sideways too), the divider (null while he has not
// moved it), the zoom, the selected text (null while there is none) and the scroll of each terminal that he scrolled, by its number as
// the key ("1" to "3"), an empty object while none was (SPEC-057), and whether the full screen of the students was asked (SPEC-059).
func stageViewJSON(v service.StageView) gin.H {
	terminals := make(map[string]float64, len(v.TerminalScroll))
	for terminal, y := range v.TerminalScroll {
		terminals[strconv.Itoa(terminal)] = y
	}
	return gin.H{
		"slideScroll": v.SlideScroll, "slideScrollX": v.SlideScrollX, "materialScroll": v.MaterialScroll, "split": v.Split,
		"zoom": v.Zoom, "selection": v.Selection, "terminalScroll": terminals, "fullscreen": v.Fullscreen,
	}
}

// activeBody is the state of an open room, for the REST answer and for the snapshot of a new connection. The raised hands have their
// questions only when withQuestions is true (the teacher).
func activeBody(a service.Active, online int, withQuestions bool) gin.H {
	drawings := a.Drawings
	if drawings == nil {
		drawings = []json.RawMessage{}
	}
	body := gin.H{
		"hasActiveSession":   true,
		"session":            sessionJSON(a.Session),
		"displayMode":        a.Session.DisplayMode,
		"currentSlide":       a.Session.CurrentSlide,
		"activeModuleId":     a.Session.ActiveModuleID,
		"moduleId":           a.Session.ActiveModuleID,
		"moduleFocusBlockId": a.ModuleFocusBlockID,
		"activeDeck":         nil,
		"recentDrawings":     drawings,
		"terminal":           gin.H{"screen": a.TerminalScreen}, // null until the teacher sends the first screen (SPEC-056)
		"stageView":          stageViewJSON(a.StageView),
		"handRaises":         handsJSON(a.HandRaises, withQuestions),
		"onlineCount":        online,
	}
	if a.Deck != nil {
		body["activeDeck"] = deckJSON(*a.Deck)
	}
	return body
}

// admissionsBody is the waiting room and the admitted, for the teacher.
func admissionsBody(a service.Admissions) gin.H {
	list := func(entries []domain.AdmissionEntry) []gin.H {
		out := make([]gin.H, 0, len(entries))
		for _, e := range entries {
			out = append(out, gin.H{"studentId": e.StudentID, "name": e.Name, "requestedAt": e.RequestedAt})
		}
		return out
	}
	return gin.H{"waiting": list(a.Waiting), "admitted": list(a.Admitted)}
}

// ---- REST ----

func requestOf(c *gin.Context) (service.Actor, uuid.UUID, bool) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return service.Actor{}, uuid.Nil, false
	}
	classID, ok := uuidParam(c, c.Param("id"), "id")
	if !ok {
		return service.Actor{}, uuid.Nil, false
	}
	return service.Actor{UserID: p.UserID, Role: p.Role}, classID, true
}

func uuidParam(c *gin.Context, raw, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The "+name+" parameter is invalid."))
		return uuid.Nil, false
	}
	return id, true
}

func optionalUUID(c *gin.Context, raw *string, name string) (*uuid.UUID, bool) {
	if raw == nil || *raw == "" {
		return nil, true
	}
	id, ok := uuidParam(c, *raw, name)
	if !ok {
		return nil, false
	}
	return &id, true
}

func (h *Handler) start(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	var req struct {
		Title           string  `json:"title"`
		ClassSessionID  *string `json:"classSessionId"`
		DeckID          *string `json:"deckId"`
		InitialModuleID *string `json:"initialModuleId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}
	in := service.StartInput{Title: req.Title}
	var okLinks [3]bool
	in.ClassSessionID, okLinks[0] = optionalUUID(c, req.ClassSessionID, "classSessionId")
	in.DeckID, okLinks[1] = optionalUUID(c, req.DeckID, "deckId")
	in.InitialModuleID, okLinks[2] = optionalUUID(c, req.InitialModuleID, "initialModuleId")
	if !okLinks[0] || !okLinks[1] || !okLinks[2] {
		return
	}
	session, created, err := h.svc.StartSession(c.Request.Context(), actor, classID, in)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, sessionJSON(session))
}

func (h *Handler) end(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	session, err := h.svc.EndSession(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": session.ID, "status": session.Status, "endedAt": session.EndedAt})
}

func (h *Handler) upload(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, domain.MaxDeckBytes+(1<<20))
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(c, toProblem(domain.ErrFileTooLarge))
			return
		}
		fail(c, problem.BadRequest("malformed-request", "Invalid multipart payload."))
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		fail(c, toProblem(&domain.FieldError{Field: "file", Err: domain.ErrInvalidPDF}))
		return
	}
	defer file.Close()
	// Only a PDF has a page count, which the browser reads; an image has none to send (SPEC-068).
	pages := 0
	if raw := c.Request.FormValue("pageCount"); raw != "" {
		var err error
		if pages, err = strconv.Atoi(raw); err != nil {
			fail(c, toProblem(&domain.FieldError{Field: "pageCount", Err: domain.ErrInvalidPDF}))
			return
		}
	}
	view, err := h.svc.UploadDeck(c.Request.Context(), actor, classID, service.UploadInput{
		Title: c.Request.FormValue("title"), PageCount: pages, Size: header.Size, File: file,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	body := deckJSON(view)
	body["createdAt"] = view.Deck.CreatedAt
	c.JSON(http.StatusCreated, body)
}

func (h *Handler) active(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	a, err := h.svc.GetActive(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	if !a.Found {
		c.JSON(http.StatusOK, gin.H{"hasActiveSession": false})
		return
	}
	c.JSON(http.StatusOK, activeBody(a, h.hub.Online(a.Session.ID.String()), actor.Role != authn.RoleStudent)) // only the teacher reads the doubts
}

// myLive lists the open rooms of the classes of the student, for the notice of the live class (SPEC-067). Nothing of the state of the room goes.
func (h *Handler) myLive(c *gin.Context) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}
	rooms, err := h.svc.ListMyLive(c.Request.Context(), service.Actor{UserID: p.UserID, Role: p.Role})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	items := make([]gin.H, 0, len(rooms))
	for _, r := range rooms {
		items = append(items, gin.H{"classId": r.ClassID, "className": r.ClassName, "sessionId": r.SessionID, "title": r.Title, "startedAt": r.StartedAt})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// module reads the module that the open room chose, for its teacher and for its admitted students (SPEC-054).
func (h *Handler) module(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	view, err := h.svc.ModuleOfRoom(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	blocks := make([]gin.H, 0, len(view.Blocks))
	for _, b := range view.Blocks {
		blocks = append(blocks, gin.H{"id": b.ID, "type": b.Type, "position": b.Position, "payload": b.Payload})
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": view.ID, "title": view.Title, "blocks": blocks, "scenario": view.Scenario, "setup": view.Setup})
}

// decks lists the presentations of the class, without the address to download them (SPEC-053).
func (h *Handler) decks(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	list, err := h.svc.ListDecks(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, d := range list {
		out = append(out, gin.H{"id": d.ID, "title": d.Title, "pageCount": d.PageCount, "kind": d.Kind, "createdAt": d.CreatedAt})
	}
	c.JSON(http.StatusOK, gin.H{"decks": out})
}

func (h *Handler) sessions(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	list, err := h.svc.ListSessions(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, item := range list {
		s := item.Session
		out = append(out, gin.H{
			"id": s.ID, "title": s.Title, "status": s.Status, "startedAt": s.StartedAt, "endedAt": s.EndedAt,
			"durationMinutes": item.DurationMinutes, "classSessionId": s.ClassSessionID, "hasNotes": item.HasNotes,
		})
	}
	c.JSON(http.StatusOK, gin.H{"sessions": out})
}

func (h *Handler) saveNote(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	var req struct {
		Content *string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}
	note, err := h.svc.SaveNote(c.Request.Context(), actor, classID, sessionID, *req.Content)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessionId": sessionID, "savedLength": utf8.RuneCountInString(note.Content), "updatedAt": note.UpdatedAt})
}

func (h *Handler) getNote(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	note, err := h.svc.GetNote(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessionId": sessionID, "content": note.Content, "updatedAt": note.UpdatedAt})
}

// connect checks who may enter the room and, if so, upgrades the request to a WebSocket and serves it until it ends.
func (h *Handler) connect(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	conn, err := h.svc.Connect(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	// The teacher side connects as the panel (default) or the presenter window (SPEC-055 RN-01); a student ignores the parameter.
	kind := ""
	if conn.Controller {
		switch kind = c.Query("view"); kind {
		case "":
			kind = viewPanel
		case viewPanel, viewPresenter:
		default:
			fail(c, problem.BadRequest("invalid-view", "The view parameter must be panel or presenter."))
			return
		}
	}
	ws, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return // the upgrader has already answered
	}
	role := hub.Viewer
	if conn.Controller {
		role = hub.Controller
	}
	if err := h.hub.Serve(c.Request.Context(), ws, conn.Session.ID.String(), hub.Identity{
		UserID: actor.UserID.String(), Role: role, Kind: kind, Meta: actor.Role, Waiting: !conn.Controller && conn.Admission != domain.AdmissionAdmitted,
	}); err != nil {
		h.log.Debug("classroom connection ended", zap.String("userId", actor.UserID.String()), zap.Error(err))
	}
}

// ---- problems ----

func toProblem(err error) *problem.Problem {
	var fe *domain.FieldError
	withField := func(p *problem.Problem) *problem.Problem {
		if errors.As(err, &fe) {
			return p.WithExtension("field", fe.Field)
		}
		return p
	}
	switch {
	case errors.Is(err, domain.ErrInvalidTitle), errors.Is(err, domain.ErrEmptyNoteBlock):
		return withField(problem.BadRequest("validation-error", err.Error()))
	case errors.Is(err, domain.ErrInvalidPDF):
		return withField(problem.BadRequest("invalid-pdf", err.Error()))
	case errors.Is(err, domain.ErrInvalidFile), errors.Is(err, domain.ErrInvalidNoteImage):
		return withField(problem.BadRequest("invalid-file", err.Error()))
	case errors.Is(err, domain.ErrContentTooLong):
		return problem.BadRequest("content-too-long", err.Error())
	case errors.Is(err, domain.ErrInvalidSlide), errors.Is(err, domain.ErrInvalidMode):
		return problem.BadRequest("validation-error", err.Error())
	case errors.Is(err, domain.ErrFileTooLarge):
		return problem.PayloadTooLarge(err.Error())
	case errors.Is(err, domain.ErrForbidden), errors.Is(err, domain.ErrNotAdmitted):
		return problem.Forbidden("forbidden", err.Error())
	case errors.Is(err, domain.ErrClassNotFound):
		return problem.NotFound("class-not-found", err.Error())
	case errors.Is(err, domain.ErrSessionNotFound):
		return problem.NotFound("session-not-found", err.Error())
	case errors.Is(err, domain.ErrDeckNotFound):
		return problem.NotFound("deck-not-found", err.Error())
	case errors.Is(err, domain.ErrClassSessionNotFound):
		return problem.NotFound("class-session-not-found", err.Error())
	case errors.Is(err, domain.ErrModuleNotFound):
		return problem.NotFound("module-not-found", err.Error())
	case errors.Is(err, domain.ErrNoActiveSession):
		return problem.NotFound("no-active-session", err.Error())
	case errors.Is(err, domain.ErrModuleNotSelected):
		return problem.NotFound("module-not-selected", err.Error())
	case errors.Is(err, domain.ErrNotesNotFound):
		return problem.NotFound("notes-not-found", err.Error())
	case errors.Is(err, domain.ErrNoteBlockNotFound):
		return problem.NotFound("note-block-not-found", err.Error())
	case errors.Is(err, domain.ErrNoteImageNotFound):
		return problem.NotFound("note-image-not-found", err.Error())
	case errors.Is(err, domain.ErrClassArchived):
		return problem.Conflict("class-archived", err.Error())
	case errors.Is(err, domain.ErrDeckLimit):
		return problem.Conflict("deck-limit-exceeded", err.Error())
	case errors.Is(err, domain.ErrExercisePaused):
		return problem.Conflict("exercise-paused", err.Error())
	case errors.Is(err, domain.ErrNoExerciseRun):
		return problem.NotFound("exercise-run-not-found", err.Error())
	case errors.Is(err, domain.ErrExerciseEnded):
		return problem.Conflict("exercise-ended", err.Error())
	case errors.Is(err, domain.ErrExerciseRunning):
		return problem.Conflict("exercise-running", err.Error())
	case errors.Is(err, domain.ErrExerciseUnavailable):
		return problem.Conflict("exercise-unavailable", err.Error())
	case errors.Is(err, domain.ErrInvalidExerciseState):
		return problem.Validation(err.Error(), problem.InvalidParam{Name: "snapshot", Reason: "invalid format"})
	case errors.Is(err, domain.ErrInvalidExerciseMinutes):
		return problem.Validation(err.Error(), problem.InvalidParam{Name: "minutes", Reason: "from 1 to 60"})
	default:
		return problem.Internal()
	}
}

func fail(c *gin.Context, p *problem.Problem) {
	_ = c.Error(p)
	c.Abort()
}
