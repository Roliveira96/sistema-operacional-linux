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
	Create(ctx context.Context, who service.Actor, moduleID uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, links service.ExerciseLinks) (service.ExerciseRecord, error)
	Update(ctx context.Context, who service.Actor, moduleID, id uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, expected time.Time, force bool) (service.ExerciseRecord, error)
	SetLinks(ctx context.Context, who service.Actor, moduleID, id uuid.UUID, links service.ExerciseLinks, status string) (service.ExerciseRecord, error)
	Delete(ctx context.Context, who service.Actor, moduleID, id uuid.UUID) error
	Reorder(ctx context.Context, who service.Actor, moduleID uuid.UUID, items []service.OrderItem) error
	SetBankSetup(ctx context.Context, who service.Actor, moduleID uuid.UUID, setup json.RawMessage) (json.RawMessage, error)
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
	teacher.PUT("/modules/:id/exercises/:exerciseId/links", h.bounded(maxAuthoringBody), h.links)
	teacher.DELETE("/modules/:id/exercises/:exerciseId", h.bounded(maxAuthoringBody), h.remove)
	teacher.PUT("/modules/:id/exercise-setup", h.bounded(maxSetupBody), h.setup)
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
	// The links of the exercise (SPEC-023 11.1): in the practice (with a place in the trail), in the assessment, and exclusive to it.
	Practice   bool `json:"practice"`
	Assessment bool `json:"assessment"`
	Exclusive  bool `json:"exclusive"`
	// DependsOn is the exercise whose recipe is built before this one (D-16).
	DependsOn *uuid.UUID `json:"dependsOn"`
	Status    string     `json:"status"`
	Position  int        `json:"position"`
	Mandatory bool       `json:"mandatory"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	CreatedBy string     `json:"createdBy"`
	UpdatedBy string     `json:"updatedBy"`
	// Legacy marks what came from the initial load: it has no solution recorded and no conditions in the form of the editor.
	Legacy bool `json:"legacy"`
}

func toExerciseResponse(r service.ExerciseRecord) exerciseResponse {
	links := r.Links()
	out := exerciseResponse{
		ID: r.ID, Title: r.Title, Difficulty: r.Difficulty, Statement: r.Statement, Hints: rawOrEmptyList(r.Hints),
		Practice: links.Practice, Assessment: links.Assessment, Exclusive: links.Exclusive, DependsOn: r.DependsOn,
		Status: r.Status, Position: r.Position, Mandatory: r.Mandatory, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
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

// linksBody are the links of an exercise as a request carries them.
type linksBody struct {
	Practice   bool `json:"practice"`
	Assessment bool `json:"assessment"`
	Exclusive  bool `json:"exclusive"`
}

func (l linksBody) links() service.ExerciseLinks {
	return service.ExerciseLinks{Practice: l.Practice, Assessment: l.Assessment, Exclusive: l.Exclusive}
}

type exerciseRequest struct {
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement"`
	Hints      json.RawMessage `json:"hints"`
	Solution   json.RawMessage `json:"solution"`
	Conditions json.RawMessage `json:"conditions"`
	// DependsOn is the exercise this one depends on (SPEC-023 D-16).
	DependsOn *uuid.UUID `json:"dependsOn"`
	// Links are where a new exercise comes linked, when it is created from a block of the screen.
	Links     linksBody  `json:"links"`
	UpdatedAt *time.Time `json:"updatedAt"`
	Force     bool       `json:"force"`
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
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "items": items, "bankSetup": bank.BankSetup})
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

// create stores a new exercise in the bank: POST /teacher/modules/{id}/exercises.
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
	rec, err := h.bank.Create(c.Request.Context(), who, id, req.input(), req.DependsOn, req.Links.links())
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
	rec, err := h.bank.Update(c.Request.Context(), who, id, ex, req.input(), req.DependsOn, expected, req.Force)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toExerciseResponse(rec))
}

type linksRequest struct {
	linksBody
	Status string `json:"status"`
}

// links links the exercise to the practice and to the assessment, and sets its publication: PUT .../exercises/{exerciseId}/links.
func (h *ExerciseHandler) links(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	ex, exOK := exerciseID(c)
	if !ok || !authed || !exOK {
		return
	}
	var req linksRequest
	if !bindBody(c, &req) {
		return
	}
	rec, err := h.bank.SetLinks(c.Request.Context(), who, id, ex, req.links(), req.Status)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toExerciseResponse(rec))
}

// remove deletes an exercise from the bank: DELETE /teacher/modules/{id}/exercises/{exerciseId}.
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

type setupRequest struct {
	BankSetup json.RawMessage `json:"bankSetup"`
}

// setup stores the snapshot of the bank: PUT /teacher/modules/{id}/exercise-setup.
func (h *ExerciseHandler) setup(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req setupRequest
	if !bindBody(c, &req) {
		return
	}
	setup, err := h.bank.SetBankSetup(c.Request.Context(), who, id, req.BankSetup)
	if err != nil {
		exerciseFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "bankSetup": setup})
}

// exerciseFail turns the errors of the exercises into problems; the others go the way of the authoring.
func exerciseFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrExerciseNotFound):
		err = problem.NotFound("exercise-not-found", "The exercise does not exist.")
	case errors.Is(err, service.ErrExerciseConflict):
		err = problem.Conflict("block-conflict", "The exercise was changed by someone else after you opened it.")
	case errors.Is(err, service.ErrInvalidExerciseOrder):
		err = problem.Validation("The order must list every exercise of the practice exactly once.",
			problem.InvalidParam{Name: "items", Reason: "must be exactly the exercises of the practice"})
	case errors.Is(err, service.ErrExerciseIncomplete):
		err = problem.Validation("An exercise needs at least one condition of finalization to be published.",
			problem.InvalidParam{Name: "conditions", Reason: "required"})
	case errors.Is(err, service.ErrInvalidLinks):
		err = problem.Validation("An exclusive exercise must be linked to the assessment and not to the practice.",
			problem.InvalidParam{Name: "exclusive", Reason: "needs the assessment and no practice"})
	case errors.Is(err, service.ErrInvalidStatus):
		err = problem.Validation("The status is not valid.", problem.InvalidParam{Name: "status", Reason: "must be DRAFT or PUBLISHED"})
	case errors.Is(err, service.ErrInvalidDependency):
		err = problem.Validation("An exercise can only depend on another exercise of the module, without cycles.",
			problem.InvalidParam{Name: "dependsOn", Reason: "must be another exercise of the module that does not depend on this one"})
	}
	authorFail(c, err)
}
