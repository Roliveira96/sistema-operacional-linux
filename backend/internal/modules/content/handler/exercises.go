package handler

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// ExerciseBanking is the use-case port of the exercises of the module (SPEC-023).
type ExerciseBanking interface {
	List(ctx context.Context, who service.Actor, moduleID uuid.UUID) (service.ExerciseBank, error)
	Get(ctx context.Context, who service.Actor, moduleID, id uuid.UUID) (service.ExerciseRecord, error)
	Create(ctx context.Context, who service.Actor, moduleID uuid.UUID, in domain.ExerciseInput) (service.ExerciseRecord, error)
	Update(ctx context.Context, who service.Actor, moduleID, id uuid.UUID, in domain.ExerciseInput, expected time.Time, force bool) (service.ExerciseRecord, error)
	SetAvailability(ctx context.Context, who service.Actor, moduleID, id uuid.UUID, usage, status string) (service.ExerciseRecord, error)
	Delete(ctx context.Context, who service.Actor, moduleID, id uuid.UUID) error
	Reorder(ctx context.Context, who service.Actor, moduleID uuid.UUID, items []service.OrderItem) error
	SetSetups(ctx context.Context, who service.Actor, moduleID uuid.UUID, exercises, assessment json.RawMessage) (json.RawMessage, json.RawMessage, error)
}

// ExerciseHandler serves the routes of the exercises of the module.
type ExerciseHandler struct {
	bank    ExerciseBanking
	auth    authn.Validator
	limiter Limiter
}

// NewExercises creates the handler.
func NewExercises(bank ExerciseBanking, auth authn.Validator, limiter Limiter) *ExerciseHandler {
	return &ExerciseHandler{bank: bank, auth: auth, limiter: limiter}
}

// Register mounts the routes under /api/v1/teacher.
func (h *ExerciseHandler) Register(r gin.IRouter) {
	teacher := r.Group("/teacher", authn.Required(h.auth), authn.PasswordChanged(),
		authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacher.GET("/modules/:id/exercises", h.list)
	teacher.POST("/modules/:id/exercises", h.bounded(maxSetupBody), h.create)
	teacher.PUT("/modules/:id/exercises/order", h.bounded(maxAuthoringBody), h.reorder)
	teacher.GET("/modules/:id/exercises/:exerciseId", h.get)
	teacher.PUT("/modules/:id/exercises/:exerciseId", h.bounded(maxSetupBody), h.update)
	teacher.PUT("/modules/:id/exercises/:exerciseId/availability", h.bounded(maxAuthoringBody), h.availability)
	teacher.DELETE("/modules/:id/exercises/:exerciseId", h.bounded(maxAuthoringBody), h.remove)
	teacher.PUT("/modules/:id/exercise-setups", h.bounded(maxSetupBody), h.setups)
}

// bounded bounds the body and the rate of the routes that change exercises.
func (h *ExerciseHandler) bounded(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		who, ok := actor(c)
		if !ok {
			authFail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
			return
		}
		if allowed, retry := h.limiter.Allow(who.UserID.String()); !allowed {
			authFail(c, problem.TooManyRequests("Too many changes. Try again later.", int(math.Ceil(retry.Seconds()))))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
	}
}

// exerciseResponse is an exercise as the teacher sees it.
type exerciseResponse struct {
	ID         uuid.UUID       `json:"id"`
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement"`
	Hints      json.RawMessage `json:"hints"`
	Solution   json.RawMessage `json:"solution"`
	Conditions json.RawMessage `json:"conditions"`
	Usage      string          `json:"usage"`
	Status     string          `json:"status"`
	Position   int             `json:"position"`
	Mandatory  bool            `json:"mandatory"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
	CreatedBy  string          `json:"createdBy"`
	UpdatedBy  string          `json:"updatedBy"`
	// Legacy marks what came from the initial load: it has no solution recorded and no conditions in the form of the editor.
	Legacy bool `json:"legacy"`
}

func toExerciseResponse(r service.ExerciseRecord) exerciseResponse {
	out := exerciseResponse{
		ID: r.ID, Title: r.Title, Difficulty: r.Difficulty, Statement: r.Statement, Hints: rawOrEmptyList(r.Hints),
		Usage: r.Usage, Status: r.Status, Position: r.Position, Mandatory: r.Mandatory, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		CreatedBy: r.CreatedByName, UpdatedBy: r.UpdatedByName, Legacy: len(r.EndConditions) == 0,
	}
	out.Conditions = rawOrEmptyList(r.EndConditions)
	// The solution of what came from the initial load is in another format; it is only the teacher's when they recorded it here.
	if !out.Legacy && len(r.ReferenceSolution) > 0 {
		out.Solution = r.ReferenceSolution
	}
	return out
}

func rawOrEmptyList(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("[]")
	}
	return raw
}

type exerciseRequest struct {
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement"`
	Hints      json.RawMessage `json:"hints"`
	Solution   json.RawMessage `json:"solution"`
	Conditions json.RawMessage `json:"conditions"`
	UpdatedAt  *time.Time      `json:"updatedAt"`
	Force      bool            `json:"force"`
}

func (r exerciseRequest) input() domain.ExerciseInput {
	return domain.ExerciseInput{Title: r.Title, Difficulty: r.Difficulty, Statement: r.Statement, Hints: r.Hints, Solution: r.Solution, Conditions: r.Conditions}
}

func exerciseID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("exerciseId"))
	if err != nil {
		authFail(c, problem.NotFound("exercise-not-found", "The exercise does not exist."))
		return uuid.Nil, false
	}
	return id, true
}

// list returns the bank: GET /teacher/modules/{id}/exercises.
func (h *ExerciseHandler) list(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	bank, err := h.bank.List(c.Request.Context(), who, id)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	items := make([]exerciseResponse, len(bank.Items))
	for i, it := range bank.Items {
		items[i] = toExerciseResponse(it)
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "items": items, "exercisesSetup": bank.ExercisesSetup, "assessmentSetup": bank.AssessmentSetup})
}

// get returns one exercise: GET /teacher/modules/{id}/exercises/{exerciseId}.
func (h *ExerciseHandler) get(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	ex, exOK := exerciseID(c)
	if !ok || !authed || !exOK {
		return
	}
	rec, err := h.bank.Get(c.Request.Context(), who, id, ex)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toExerciseResponse(rec))
}

// create stores a new exercise: POST /teacher/modules/{id}/exercises.
func (h *ExerciseHandler) create(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req exerciseRequest
	if !bindBody(c, &req) {
		return
	}
	rec, err := h.bank.Create(c.Request.Context(), who, id, req.input())
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, toExerciseResponse(rec))
}

// update saves an exercise: PUT /teacher/modules/{id}/exercises/{exerciseId}.
func (h *ExerciseHandler) update(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	ex, exOK := exerciseID(c)
	if !ok || !authed || !exOK {
		return
	}
	var req exerciseRequest
	if !bindBody(c, &req) {
		return
	}
	if req.UpdatedAt == nil && !req.Force {
		authFail(c, problem.Validation("The instant of the exercise you opened is required.", problem.InvalidParam{Name: "updatedAt", Reason: "required"}))
		return
	}
	var expected time.Time
	if req.UpdatedAt != nil {
		expected = *req.UpdatedAt
	}
	rec, err := h.bank.Update(c.Request.Context(), who, id, ex, req.input(), expected, req.Force)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toExerciseResponse(rec))
}

type availabilityRequest struct {
	Usage  string `json:"usage"`
	Status string `json:"status"`
}

// availability makes the exercise available or reserved, published or draft: PUT .../exercises/{exerciseId}/availability.
func (h *ExerciseHandler) availability(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	ex, exOK := exerciseID(c)
	if !ok || !authed || !exOK {
		return
	}
	var req availabilityRequest
	if !bindBody(c, &req) {
		return
	}
	rec, err := h.bank.SetAvailability(c.Request.Context(), who, id, ex, req.Usage, req.Status)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toExerciseResponse(rec))
}

// remove deletes an exercise: DELETE /teacher/modules/{id}/exercises/{exerciseId}.
func (h *ExerciseHandler) remove(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	ex, exOK := exerciseID(c)
	if !ok || !authed || !exOK {
		return
	}
	if err := h.bank.Delete(c.Request.Context(), who, id, ex); err != nil {
		exerciseFail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type orderRequest struct {
	Items []struct {
		ExerciseID uuid.UUID `json:"exerciseId"`
		Mandatory  bool      `json:"mandatory"`
	} `json:"items"`
}

// reorder sets the trail: PUT /teacher/modules/{id}/exercises/order.
func (h *ExerciseHandler) reorder(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req orderRequest
	if !bindBody(c, &req) {
		return
	}
	items := make([]service.OrderItem, len(req.Items))
	for i, it := range req.Items {
		items[i] = service.OrderItem{ExerciseID: it.ExerciseID, Mandatory: it.Mandatory}
	}
	if err := h.bank.Reorder(c.Request.Context(), who, id, items); err != nil {
		exerciseFail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type setupsRequest struct {
	ExercisesSetup  json.RawMessage `json:"exercisesSetup"`
	AssessmentSetup json.RawMessage `json:"assessmentSetup"`
}

// setups stores the snapshots of the two sets: PUT /teacher/modules/{id}/exercise-setups.
func (h *ExerciseHandler) setups(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req setupsRequest
	if !bindBody(c, &req) {
		return
	}
	exercises, assessment, err := h.bank.SetSetups(c.Request.Context(), who, id, req.ExercisesSetup, req.AssessmentSetup)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "exercisesSetup": exercises, "assessmentSetup": assessment})
}

// exerciseFail turns the errors of the exercises into problems; the others go the way of the authoring.
func exerciseFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrExerciseNotFound):
		err = problem.NotFound("exercise-not-found", "The exercise does not exist.")
	case errors.Is(err, service.ErrExerciseConflict):
		err = problem.Conflict("block-conflict", "The exercise was changed by someone else after you opened it.")
	case errors.Is(err, service.ErrInvalidExerciseOrder):
		err = problem.Validation("The order must list every available exercise exactly once.",
			problem.InvalidParam{Name: "items", Reason: "must be exactly the available exercises of the module"})
	case errors.Is(err, service.ErrExerciseIncomplete):
		err = problem.Validation("An exercise needs at least one condition of finalization to be published.",
			problem.InvalidParam{Name: "conditions", Reason: "required"})
	case errors.Is(err, service.ErrInvalidAvailability):
		err = problem.Validation("The usage and the status are not valid.",
			problem.InvalidParam{Name: "usage", Reason: "must be EXERCISE or ASSESSMENT"}, problem.InvalidParam{Name: "status", Reason: "must be DRAFT or PUBLISHED"})
	}
	authorFail(c, err)
}
