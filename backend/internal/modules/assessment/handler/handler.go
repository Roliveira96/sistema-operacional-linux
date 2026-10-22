// Package handler exposes the assessments of a class over HTTP (SPEC-075, section 5).
package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// maxBody is the biggest body of a request: an assessment of 50 questions is a few kilobytes.
const maxBody = 1 << 20

// AssessmentService is what the handler uses from the service.
type AssessmentService interface {
	Now() time.Time
	Create(ctx context.Context, a service.Actor, classID uuid.UUID, in service.CreateInput) (service.Summary, error)
	Update(ctx context.Context, a service.Actor, classID, id uuid.UUID, in service.UpdateInput) (service.Summary, error)
	Reschedule(ctx context.Context, a service.Actor, classID, id uuid.UUID, in service.RescheduleInput) (service.Summary, error)
	Cancel(ctx context.Context, a service.Actor, classID, id uuid.UUID, reason string) (service.Summary, error)
	Start(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.Summary, error)
	SaveNotes(ctx context.Context, a service.Actor, classID, id uuid.UUID, notes string) (string, error)
	Detail(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.Detail, error)
	Public(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.Public, error)
	List(ctx context.Context, a service.Actor, classID uuid.UUID, f service.ListFilter) ([]service.Summary, error)
	ListPublic(ctx context.Context, a service.Actor, classID uuid.UUID, f service.ListFilter) ([]service.Public, error)
	Preview(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.Preview, error)
	EligibleQuestions(ctx context.Context, a service.Actor, classID uuid.UUID, f service.QuestionFilter) (service.QuestionPage, error)
	Clearances(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.ClearanceList, error)
	Decide(ctx context.Context, a service.Actor, classID, id uuid.UUID, in service.ClearanceInput) (service.ClearanceList, error)
	MyAccess(ctx context.Context, a service.Actor, classID, id uuid.UUID) (service.MyAccess, error)
}

// Handler serves the assessment routes.
type Handler struct {
	svc  AssessmentService
	auth authn.Validator
}

// New creates the handler.
func New(svc AssessmentService, auth authn.Validator) *Handler { return &Handler{svc: svc, auth: auth} }

// Register wires the routes under /api/v1. Every route needs a session; the service decides who may do what (RN-01).
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("", authn.Required(h.auth), authn.PasswordChanged())
	g.POST("/classes/:id/assessments", h.create)
	g.GET("/classes/:id/assessments", h.list)
	g.GET("/classes/:id/assessments/:assessmentId", h.get)
	g.GET("/classes/:id/assessments/:assessmentId/preview", h.preview)
	g.PATCH("/classes/:id/assessments/:assessmentId", h.update)
	g.PUT("/classes/:id/assessments/:assessmentId/schedule", h.reschedule)
	g.POST("/classes/:id/assessments/:assessmentId/cancel", h.cancel)
	g.POST("/classes/:id/assessments/:assessmentId/start", h.start)
	g.PUT("/classes/:id/assessments/:assessmentId/private-notes", h.notes)
	g.GET("/classes/:id/assessment-questions", h.questions)
	g.GET("/classes/:id/assessments/:assessmentId/clearances", h.clearances)
	g.POST("/classes/:id/assessments/:assessmentId/clearances", h.decide)
	g.GET("/classes/:id/assessments/:assessmentId/my-access", h.myAccess)
}

func fail(c *gin.Context, p *problem.Problem) {
	_ = c.Error(p)
	c.Abort()
}

// failWith answers a domain error with its problem; an error that is not one of the domain goes to the middleware, which logs it and answers 500.
func failWith(c *gin.Context, err error) {
	if p := toProblem(err); p != nil {
		fail(c, p)
		return
	}
	_ = c.Error(err)
	c.Abort()
}

func malformed(c *gin.Context) {
	fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
}

func actorOf(c *gin.Context) (service.Actor, bool) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return service.Actor{}, false
	}
	return service.Actor{UserID: p.UserID, Role: p.Role}, true
}

func uuidParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The "+name+" parameter is invalid."))
		return uuid.Nil, false
	}
	return id, true
}

func bind(c *gin.Context, dst any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)
	if err := c.ShouldBindJSON(dst); err != nil {
		malformed(c)
		return false
	}
	return true
}

func toProblem(err error) *problem.Problem {
	var stock *domain.StockError
	switch {
	case errors.As(err, &stock):
		short := make([]map[string]any, len(stock.Short))
		for i, s := range stock.Short {
			short[i] = map[string]any{"difficulty": s.Difficulty, "asked": s.Asked, "available": s.Available}
		}
		return problem.Conflict("insufficient-stock", err.Error()).WithExtension("shortages", short)
	case errors.Is(err, domain.ErrInvalidAssessment):
		return problem.BadRequest("invalid-assessment", err.Error())
	case errors.Is(err, domain.ErrInvalidPeriod):
		return problem.BadRequest("invalid-period", err.Error())
	case errors.Is(err, domain.ErrWeightsMismatch):
		return problem.BadRequest("weights-mismatch", err.Error())
	case errors.Is(err, domain.ErrDrawMismatch):
		return problem.BadRequest("draw-mismatch", err.Error())
	case errors.Is(err, domain.ErrQuestionNotEligible):
		return problem.BadRequest("question-not-eligible", err.Error())
	case errors.Is(err, domain.ErrInvalidClearance):
		return problem.BadRequest("invalid-clearance", err.Error())
	case errors.Is(err, domain.ErrStudentNotInClass):
		return problem.BadRequest("student-not-in-class", err.Error())
	case errors.Is(err, domain.ErrReasonRequired):
		return problem.BadRequest("reason-required", err.Error())
	case errors.Is(err, domain.ErrForbidden):
		return problem.Forbidden("forbidden", err.Error())
	case errors.Is(err, domain.ErrClassNotFound):
		return problem.NotFound("class-not-found", err.Error())
	case errors.Is(err, domain.ErrAssessmentNotFound):
		return problem.NotFound("assessment-not-found", err.Error())
	case errors.Is(err, domain.ErrSessionNotFound):
		return problem.NotFound("session-not-found", err.Error())
	case errors.Is(err, domain.ErrSessionNotConvertible):
		return problem.Conflict("session-not-convertible", err.Error())
	case errors.Is(err, domain.ErrModuleNotAssigned):
		return problem.Conflict("module-not-assigned", err.Error())
	case errors.Is(err, domain.ErrAssessmentFrozen):
		return problem.Conflict("assessment-frozen", err.Error())
	case errors.Is(err, domain.ErrAssessmentEnded):
		return problem.Conflict("assessment-ended", err.Error())
	case errors.Is(err, domain.ErrAssessmentCanceled):
		return problem.Conflict("assessment-canceled", err.Error())
	case errors.Is(err, domain.ErrGradesHomologated):
		return problem.Conflict("grades-homologated", err.Error())
	case errors.Is(err, domain.ErrAssessmentNotStarted):
		return problem.Conflict("assessment-not-started", err.Error())
	case errors.Is(err, domain.ErrAssessmentAlreadyStarted):
		return problem.Conflict("assessment-already-started", err.Error())
	case errors.Is(err, domain.ErrAssessmentNotOpenYet):
		return problem.Conflict("assessment-not-open-yet", err.Error())
	case errors.Is(err, domain.ErrClearanceNotRequired):
		return problem.Conflict("clearance-not-required", err.Error())
	case errors.Is(err, domain.ErrClearanceLocked):
		return problem.Conflict("clearance-locked", err.Error())
	}
	return nil
}

// ---- reading the requests ----

type itemRequest struct {
	QuestionID string  `json:"questionId"`
	Weight     float64 `json:"weight"`
}

type ruleRequest struct {
	Difficulty        string  `json:"difficulty"`
	Quantity          int     `json:"quantity"`
	PointsPerQuestion float64 `json:"pointsPerQuestion"`
}

type drawRequest struct {
	Total int           `json:"total"`
	Rules []ruleRequest `json:"rules"`
}

type createRequest struct {
	ClassSessionID      *string       `json:"classSessionId"`
	ModuleID            *string       `json:"moduleId"`
	Title               string        `json:"title"`
	Description         string        `json:"description"`
	Type                string        `json:"type"`
	MaxScore            float64       `json:"maxScore"`
	DurationMinutes     *int          `json:"durationMinutes"`
	StartsAt            *string       `json:"startsAt"`
	EndsAt              *string       `json:"endsAt"`
	Composition         string        `json:"composition"`
	Items               []itemRequest `json:"items"`
	Draw                *drawRequest  `json:"draw"`
	Audience            string        `json:"audience"`
	StudentIDs          []string      `json:"studentIds"`
	TeacherPrivateNotes *string       `json:"teacherPrivateNotes"`
	Modality            *string       `json:"modality"`
	RequiresClearance   *bool         `json:"requiresClearance"`
}

type updateRequest struct {
	Title             *string        `json:"title"`
	Description       *string        `json:"description"`
	ModuleID          *string        `json:"moduleId"`
	Type              *string        `json:"type"`
	MaxScore          *float64       `json:"maxScore"`
	DurationMinutes   *int           `json:"durationMinutes"`
	Composition       *string        `json:"composition"`
	Items             *[]itemRequest `json:"items"`
	Draw              *drawRequest   `json:"draw"`
	Audience          *string        `json:"audience"`
	StudentIDs        *[]string      `json:"studentIds"`
	Modality          *string        `json:"modality"`
	RequiresClearance *bool          `json:"requiresClearance"`
}

// modalityPtr hands the modality over as it came: the service refuses the one it does not know.
func modalityPtr(raw *string) *domain.Modality {
	if raw == nil {
		return nil
	}
	m := domain.Modality(*raw)
	return &m
}

func parseUUID(raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	return id, err == nil
}

func parseUUIDPtr(raw *string) (*uuid.UUID, bool) {
	if raw == nil {
		return nil, true
	}
	id, ok := parseUUID(*raw)
	return &id, ok
}

func parseTimePtr(raw *string) (*time.Time, bool) {
	if raw == nil {
		return nil, true
	}
	t, err := time.Parse(time.RFC3339, *raw)
	return &t, err == nil
}

func parseUUIDs(raw []string) ([]uuid.UUID, bool) {
	if raw == nil {
		return nil, true
	}
	out := make([]uuid.UUID, len(raw))
	for i, r := range raw {
		id, ok := parseUUID(r)
		if !ok {
			return nil, false
		}
		out[i] = id
	}
	return out, true
}

func parseItems(raw []itemRequest) ([]domain.Item, bool) {
	out := make([]domain.Item, len(raw))
	for i, r := range raw {
		id, ok := parseUUID(r.QuestionID)
		if !ok {
			return nil, false
		}
		out[i] = domain.Item{QuestionID: id, Position: i + 1, Weight: domain.Points(r.Weight)}
	}
	return out, true
}

func parseDraw(raw *drawRequest) *service.Draw {
	if raw == nil {
		return nil
	}
	rules := make([]domain.DrawRule, len(raw.Rules))
	for i, r := range raw.Rules {
		rules[i] = domain.DrawRule{Difficulty: domain.Difficulty(r.Difficulty), Quantity: r.Quantity, Points: domain.Points(r.PointsPerQuestion)}
	}
	return &service.Draw{Total: raw.Total, Rules: rules}
}

// ---- the routes ----

func (h *Handler) create(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	var req createRequest
	if !bind(c, &req) {
		return
	}
	session, ok1 := parseUUIDPtr(req.ClassSessionID)
	module, ok2 := parseUUIDPtr(req.ModuleID)
	startsAt, ok3 := parseTimePtr(req.StartsAt)
	endsAt, ok4 := parseTimePtr(req.EndsAt)
	items, ok5 := parseItems(req.Items)
	students, ok6 := parseUUIDs(req.StudentIDs)
	if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 {
		malformed(c)
		return
	}
	in := service.CreateInput{
		ClassSessionID: session, ModuleID: module, Title: req.Title, Description: req.Description, Type: domain.Type(req.Type),
		MaxScore: domain.Points(req.MaxScore), DurationMinutes: req.DurationMinutes, StartsAt: startsAt, EndsAt: endsAt,
		Composition: domain.Composition(req.Composition), Items: items, Draw: parseDraw(req.Draw), Audience: domain.Audience(req.Audience),
		StudentIDs: students, PrivateNotes: req.TeacherPrivateNotes, Modality: modalityPtr(req.Modality), RequiresClearance: req.RequiresClearance,
	}
	got, err := h.svc.Create(c.Request.Context(), actor, classID, in)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusCreated, summaryResponse{summaryJSON: toSummary(got), ServerNow: iso(h.svc.Now())})
}

func (h *Handler) get(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	if actor.Role == authn.RoleStudent {
		got, err := h.svc.Public(c.Request.Context(), actor, classID, id)
		if err != nil {
			failWith(c, err)
			return
		}
		c.JSON(http.StatusOK, publicResponse{publicJSON: toPublic(got), ServerNow: iso(h.svc.Now())})
		return
	}
	got, err := h.svc.Detail(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, toDetail(got, h.svc.Now()))
}

func filterOf(c *gin.Context) (service.ListFilter, bool) {
	f := service.ListFilter{Phase: domain.Phase(c.Query("phase")), Status: domain.Status(c.Query("status"))}
	switch f.Phase {
	case "", domain.PhaseUpcoming, domain.PhaseRunning, domain.PhaseEnded:
	default:
		malformed(c)
		return f, false
	}
	switch f.Status {
	case "", domain.StatusScheduled, domain.StatusCanceled:
	default:
		malformed(c)
		return f, false
	}
	return f, true
}

func (h *Handler) list(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	filter, ok := filterOf(c)
	if !ok {
		return
	}
	if actor.Role == authn.RoleStudent {
		list, err := h.svc.ListPublic(c.Request.Context(), actor, classID, filter)
		if err != nil {
			failWith(c, err)
			return
		}
		items := make([]publicJSON, len(list))
		for i, p := range list {
			items[i] = toPublic(p)
		}
		c.JSON(http.StatusOK, gin.H{"items": items, "serverNow": iso(h.svc.Now())})
		return
	}
	list, err := h.svc.List(c.Request.Context(), actor, classID, filter)
	if err != nil {
		failWith(c, err)
		return
	}
	items := make([]summaryJSON, len(list))
	for i, s := range list {
		items[i] = toSummary(s)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "serverNow": iso(h.svc.Now())})
}

func (h *Handler) preview(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	got, err := h.svc.Preview(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, toPreview(got))
}

func (h *Handler) update(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	var req updateRequest
	if !bind(c, &req) {
		return
	}
	module, ok := parseUUIDPtr(req.ModuleID)
	if !ok {
		malformed(c)
		return
	}
	in := service.UpdateInput{
		Title: req.Title, Description: req.Description, ModuleID: module, DurationMinutes: req.DurationMinutes, Draw: parseDraw(req.Draw),
		Modality: modalityPtr(req.Modality), RequiresClearance: req.RequiresClearance,
	}
	if req.Type != nil {
		t := domain.Type(*req.Type)
		in.Type = &t
	}
	if req.MaxScore != nil {
		score := domain.Points(*req.MaxScore)
		in.MaxScore = &score
	}
	if req.Composition != nil {
		comp := domain.Composition(*req.Composition)
		in.Composition = &comp
	}
	if req.Audience != nil {
		aud := domain.Audience(*req.Audience)
		in.Audience = &aud
	}
	if req.Items != nil {
		items, ok := parseItems(*req.Items)
		if !ok {
			malformed(c)
			return
		}
		in.Items = &items
	}
	if req.StudentIDs != nil {
		students, ok := parseUUIDs(*req.StudentIDs)
		if !ok {
			malformed(c)
			return
		}
		if students == nil {
			students = []uuid.UUID{}
		}
		in.StudentIDs = &students
	}
	got, err := h.svc.Update(c.Request.Context(), actor, classID, id, in)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, summaryResponse{summaryJSON: toSummary(got), ServerNow: iso(h.svc.Now())})
}

type rescheduleRequest struct {
	StartsAt *string `json:"startsAt"`
	EndsAt   *string `json:"endsAt"`
	Reason   string  `json:"reason"`
}

func (h *Handler) reschedule(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	var req rescheduleRequest
	if !bind(c, &req) {
		return
	}
	startsAt, ok1 := parseTimePtr(req.StartsAt)
	endsAt, ok2 := parseTimePtr(req.EndsAt)
	if !ok1 || !ok2 || startsAt == nil || endsAt == nil {
		malformed(c)
		return
	}
	got, err := h.svc.Reschedule(c.Request.Context(), actor, classID, id, service.RescheduleInput{StartsAt: *startsAt, EndsAt: *endsAt, Reason: req.Reason})
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, summaryResponse{summaryJSON: toSummary(got), ServerNow: iso(h.svc.Now())})
}

type cancelRequest struct {
	Reason string `json:"reason"`
}

func (h *Handler) cancel(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	var req cancelRequest
	if !bind(c, &req) {
		return
	}
	got, err := h.svc.Cancel(c.Request.Context(), actor, classID, id, req.Reason)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, summaryResponse{summaryJSON: toSummary(got), ServerNow: iso(h.svc.Now())})
}

func (h *Handler) start(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	got, err := h.svc.Start(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, summaryResponse{summaryJSON: toSummary(got), ServerNow: iso(h.svc.Now())})
}

type notesRequest struct {
	TeacherPrivateNotes *string `json:"teacherPrivateNotes"`
}

func (h *Handler) notes(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	var req notesRequest
	if !bind(c, &req) {
		return
	}
	if req.TeacherPrivateNotes == nil { // an empty body would otherwise clear the notes
		malformed(c)
		return
	}
	saved, err := h.svc.SaveNotes(c.Request.Context(), actor, classID, id, *req.TeacherPrivateNotes)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"teacherPrivateNotes": saved})
}

func (h *Handler) questions(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	module, ok := parseUUID(c.Query("moduleId"))
	if !ok {
		malformed(c)
		return
	}
	filter := service.QuestionFilter{
		ModuleID: module, Difficulty: domain.Difficulty(c.Query("difficulty")), Kind: c.Query("kind"), Query: c.Query("q"), Page: 1, PageSize: 20,
	}
	switch filter.Difficulty {
	case "", domain.DifficultyEasy, domain.DifficultyMedium, domain.DifficultyHard:
	default:
		malformed(c)
		return
	}
	for name, dst := range map[string]*int{"page": &filter.Page, "pageSize": &filter.PageSize} {
		raw := c.Query(name)
		if raw == "" {
			continue
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			malformed(c)
			return
		}
		*dst = n
	}
	if filter.PageSize > 100 {
		filter.PageSize = 100
	}
	got, err := h.svc.EligibleQuestions(c.Request.Context(), actor, classID, filter)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, toQuestions(got))
}
