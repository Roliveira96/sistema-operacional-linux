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
	ID uuid.UUID `json:"id"`
	// Kind is the kind of question (SPEC-035): PRACTICAL or THEORETICAL_BOOLEAN.
	Kind       string          `json:"kind"`
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement"`
	Hints      json.RawMessage `json:"hints"`
	Solution   json.RawMessage `json:"solution"`
	Conditions json.RawMessage `json:"conditions"`
	// CorrectAnswer and Explanation are the answer key and the justification of a true or false question (SPEC-035 5.1).
	CorrectAnswer *bool   `json:"correctAnswer,omitempty"`
	Explanation   *string `json:"explanation,omitempty"`
	// Choices and CorrectChoice are the alternatives and the correct one of a single choice question (SPEC-036 5.1).
	Choices        json.RawMessage `json:"choices,omitempty"`
	CorrectChoice  *string         `json:"correctChoice,omitempty"`
	ShuffleChoices *bool           `json:"shuffleChoices,omitempty"`
	// Left, Right and Pairs are the columns and the correct pairs of a matching question (SPEC-037 5.1).
	Left  json.RawMessage `json:"left,omitempty"`
	Right json.RawMessage `json:"right,omitempty"`
	Pairs json.RawMessage `json:"pairs,omitempty"`
	// ExpectedAnswer and MaxLength are the correct answer and the size of the answer of a descriptive question (SPEC-039 5).
	ExpectedAnswer *string `json:"expectedAnswer,omitempty"`
	MaxLength      *int    `json:"maxLength,omitempty"`
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
		ID: r.ID, Kind: r.Kind, Title: r.Title, Difficulty: r.Difficulty, Statement: r.Statement, Hints: rawOrEmptyList(r.Hints),
		Practice: links.Practice, Assessment: links.Assessment, Exclusive: links.Exclusive, DependsOn: r.DependsOn,
		Status: r.Status, Position: r.Position, Mandatory: r.Mandatory, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		CreatedBy: r.CreatedByName, UpdatedBy: r.UpdatedByName, Legacy: domain.UsesTerminal(r.Kind) && len(r.EndConditions) == 0,
	}
	switch r.Kind {
	case domain.KindTheoreticalBoolean:
		if correct, ok := domain.BooleanAnswer(r.AnswerKey); ok {
			out.CorrectAnswer = &correct
		}
		out.Explanation = r.Explanation
	case domain.KindTheoreticalSingle:
		out.Choices = json.RawMessage("[]")
		if domain.ReadChoices(r.Choices) != nil {
			out.Choices = r.Choices
		}
		if correct, ok := domain.CorrectChoice(r.AnswerKey); ok {
			out.CorrectChoice = &correct
		}
		shuffle := r.ShuffleChoices
		out.ShuffleChoices = &shuffle
		out.Explanation = r.Explanation
	case domain.KindTheoreticalMatching:
		out.Left, out.Right, out.Pairs = json.RawMessage("[]"), json.RawMessage("[]"), json.RawMessage("[]")
		if cols, ok := domain.ReadColumns(r.Choices); ok {
			out.Left, _ = json.Marshal(cols.Left)
			out.Right, _ = json.Marshal(cols.Right)
		}
		if pairs := domain.ReadPairs(r.AnswerKey); len(pairs) > 0 {
			out.Pairs, _ = json.Marshal(pairs)
		}
		shuffle := r.ShuffleChoices
		out.ShuffleChoices = &shuffle
		out.Explanation = r.Explanation
	case domain.KindDiscursive:
		expected, size := domain.ReadDiscursiveKey(r.AnswerKey)
		out.ExpectedAnswer, out.MaxLength = &expected, &size
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
	// Kind is the kind of question; empty in a POST is PRACTICAL, and a PUT cannot change it (SPEC-035 5.1).
	Kind       string          `json:"kind"`
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement"`
	Hints      json.RawMessage `json:"hints"`
	Solution   json.RawMessage `json:"solution"`
	Conditions json.RawMessage `json:"conditions"`
	// CorrectAnswer and Explanation belong to a true or false question (SPEC-035 RN-03).
	CorrectAnswer *bool  `json:"correctAnswer"`
	Explanation   string `json:"explanation"`
	// Choices and CorrectChoice belong to a single choice question (SPEC-036 RN-03).
	Choices        json.RawMessage `json:"choices"`
	CorrectChoice  *string         `json:"correctChoice"`
	ShuffleChoices *bool           `json:"shuffleChoices"`
	// Left, Right and Pairs belong to a matching question (SPEC-037 RN-03).
	Left  json.RawMessage `json:"left"`
	Right json.RawMessage `json:"right"`
	Pairs json.RawMessage `json:"pairs"`
	// ExpectedAnswer and MaxLength belong to a descriptive question (SPEC-039 RN-01).
	ExpectedAnswer string `json:"expectedAnswer"`
	MaxLength      *int   `json:"maxLength"`
	// DependsOn is the exercise this one depends on (SPEC-023 D-16).
	DependsOn *uuid.UUID `json:"dependsOn"`
	// Links are where a new exercise comes linked, when it is created from a block of the screen.
	Links     linksBody  `json:"links"`
	UpdatedAt *time.Time `json:"updatedAt"`
	Force     bool       `json:"force"`
}

func (r exerciseRequest) input() domain.ExerciseInput {
	return domain.ExerciseInput{
		Kind: r.Kind, Title: r.Title, Difficulty: r.Difficulty, Statement: r.Statement, Hints: r.Hints, Solution: r.Solution, Conditions: r.Conditions,
		CorrectAnswer: r.CorrectAnswer, Explanation: r.Explanation, HasDependency: r.DependsOn != nil,
		Choices: r.Choices, CorrectChoice: r.CorrectChoice, ShuffleChoices: r.ShuffleChoices, Left: r.Left, Right: r.Right, Pairs: r.Pairs,
		ExpectedAnswer: r.ExpectedAnswer, MaxLength: r.MaxLength,
	}
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
	// The bank can be filtered by kind of question (SPEC-035 CA-06).
	kind := c.Query("kind")
	if kind != "" {
		if _, ok := domain.TypeOf(kind); !ok {
			authFail(c, problem.Validation("The kind of question is not valid.", problem.InvalidParam{Name: "kind", Reason: "unknown kind"}))
			return
		}
	}
	items := make([]exerciseResponse, 0, len(bank.Items))
	for _, it := range bank.Items {
		if kind == "" || it.Kind == kind {
			items = append(items, toExerciseResponse(it))
		}
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
		params := []problem.InvalidParam{{Name: "conditions", Reason: "required"}}
		var incomplete *service.IncompleteError
		if errors.As(err, &incomplete) {
			params = make([]problem.InvalidParam, len(incomplete.Fields))
			for i, f := range incomplete.Fields {
				params[i] = problem.InvalidParam{Name: f.Field, Reason: f.Reason}
			}
		}
		err = problem.Validation("The question is missing what it needs to be published.", params...)
	case errors.Is(err, service.ErrQuestionInUse):
		err = problem.Conflict("question-in-use", "The question is in a scheduled assessment, or the assessments need the questions of its level, so it cannot leave the assessment bank.")
	case errors.Is(err, service.ErrKindChange):
		err = problem.Validation("The kind of a question cannot change.", problem.InvalidParam{Name: "kind", Reason: "cannot change"})
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
