// Package handler exposes the practice endpoints (SPEC-014, SPEC-016).
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

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// MaxSnapshotBytes bounds the body of a check (P-05).
const MaxSnapshotBytes = 2 << 20

// Service is the practice use-case port.
type Service interface {
	Scenario(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error)
	Submit(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer, sub service.Submission) (service.CheckResult, error)
	ModuleProgress(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) ([]service.ProgressEntry, error)
	TopicScenario(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error)
	CheckModule(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer, snapshot json.RawMessage) (service.ModuleCheckResult, error)
}

// Limiter is the per-user check limiter (RN-04).
type Limiter interface {
	Allow(key string) (bool, time.Duration)
}

// Handler serves the practice routes.
type Handler struct {
	svc     Service
	auth    authn.Validator
	limiter Limiter
	// batch limits the automatic module checks (SPEC-016 RN-02).
	batch Limiter
}

// New creates the handler.
func New(svc Service, auth authn.Validator, limiter, batch Limiter) *Handler {
	return &Handler{svc: svc, auth: auth, limiter: limiter, batch: batch}
}

// Register mounts the routes under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	r.GET("/questions/:id/scenario", authn.Optional(h.auth), h.scenario)
	r.GET("/modules/:id/scenario", authn.Optional(h.auth), h.topicScenario)
	authed := r.Group("", authn.Required(h.auth), authn.PasswordChanged())
	authed.POST("/questions/:id/check", h.check)
	authed.POST("/modules/:id/check", h.checkModule)
	authed.GET("/modules/:id/progress", h.progress)
}

func (h *Handler) scenario(c *gin.Context) {
	id, ok := parseID(c, "question-not-found")
	if !ok {
		return
	}
	snapshot, err := h.svc.Scenario(c.Request.Context(), id, viewer(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"questionId": id, "snapshot": snapshot})
}

type checkRequest struct {
	Snapshot json.RawMessage `json:"snapshot"`
	// Response is the answer of the student to a question without a terminal (SPEC-035 5.2).
	Response json.RawMessage `json:"response"`
}

type checkResponse struct {
	Passed      bool       `json:"passed"`
	CompletedAt *time.Time `json:"completedAt"`
	// CorrectAnswer (true or false) or CorrectChoice (single choice) and Explanation come only for a question without a terminal,
	// after the answer (SPEC-035 RN-06, SPEC-036 RN-05).
	CorrectAnswer json.RawMessage `json:"correctAnswer,omitempty"`
	CorrectChoice json.RawMessage `json:"correctChoice,omitempty"`
	Explanation   *string         `json:"explanation,omitempty"`
}

// revealed puts the answer key in the field of its kind.
func revealed(field string, value json.RawMessage) (answer, choice json.RawMessage) {
	if field == "correctChoice" {
		return nil, value
	}
	return value, nil
}

func (h *Handler) check(c *gin.Context) {
	id, ok := parseID(c, "question-not-found")
	if !ok {
		return
	}
	v := viewer(c)
	if allowed, retry := h.limiter.Allow(v.UserID.String()); !allowed {
		fail(c, problem.TooManyRequests("Too many checks. Try again later.", int(math.Ceil(retry.Seconds()))))
		return
	}
	body, ok := readBody(c)
	if !ok {
		return
	}
	result, err := h.svc.Submit(c.Request.Context(), id, v, service.Submission{Snapshot: body.Snapshot, Response: body.Response})
	if err != nil {
		fail(c, err)
		return
	}
	answer, choice := revealed(result.CorrectField, result.Correct)
	c.JSON(http.StatusOK, checkResponse{Passed: result.Passed, CompletedAt: result.CompletedAt, CorrectAnswer: answer, CorrectChoice: choice, Explanation: result.Explanation})
}

// readBody decodes the body of a check, bounded to 2 MB; which field is required depends on the kind of the question.
func readBody(c *gin.Context) (checkRequest, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxSnapshotBytes)
	var body checkRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, problem.PayloadTooLarge("The submitted state exceeds 2 MB."))
			return checkRequest{}, false
		}
		fail(c, problem.Validation("The request body must be a JSON object with a snapshot or a response."))
		return checkRequest{}, false
	}
	return body, true
}

// readSnapshot decodes the {"snapshot": ...} body, bounded to 2 MB.
func readSnapshot(c *gin.Context) (json.RawMessage, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxSnapshotBytes)
	var body checkRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, problem.PayloadTooLarge("The submitted state exceeds 2 MB."))
			return nil, false
		}
		fail(c, problem.Validation("The request body must be a JSON object with a snapshot."))
		return nil, false
	}
	if len(body.Snapshot) == 0 || string(body.Snapshot) == "null" {
		fail(c, problem.Validation("The snapshot is required.", problem.InvalidParam{Name: "snapshot", Reason: "required"}))
		return nil, false
	}
	return body.Snapshot, true
}

func (h *Handler) topicScenario(c *gin.Context) {
	id, ok := parseID(c, "module-not-found")
	if !ok {
		return
	}
	snapshot, err := h.svc.TopicScenario(c.Request.Context(), id, viewer(c))
	if err != nil {
		failModule(c, err)
		return
	}
	if snapshot == nil {
		snapshot = json.RawMessage("null")
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "snapshot": snapshot})
}

type moduleCheckResponse struct {
	Passed   []uuid.UUID    `json:"passed"`
	Progress []progressItem `json:"progress"`
}

func (h *Handler) checkModule(c *gin.Context) {
	id, ok := parseID(c, "module-not-found")
	if !ok {
		return
	}
	v := viewer(c)
	if allowed, retry := h.batch.Allow(v.UserID.String()); !allowed {
		fail(c, problem.TooManyRequests("Too many checks. Try again later.", int(math.Ceil(retry.Seconds()))))
		return
	}
	snapshot, ok := readSnapshot(c)
	if !ok {
		return
	}
	result, err := h.svc.CheckModule(c.Request.Context(), id, v, snapshot)
	if err != nil {
		failModule(c, err)
		return
	}
	c.JSON(http.StatusOK, moduleCheckResponse{Passed: result.Passed, Progress: progressItems(result.Progress)})
}

type progressItem struct {
	QuestionID  uuid.UUID  `json:"questionId"`
	CompletedAt *time.Time `json:"completedAt"`
	Attempts    int        `json:"attempts"`
	// An answered question without a terminal brings the answer, its result, the correct answer and the justification, so the
	// screen shows it locked (SPEC-035 5.2).
	Response      json.RawMessage `json:"response,omitempty"`
	Passed        *bool           `json:"passed,omitempty"`
	CorrectAnswer json.RawMessage `json:"correctAnswer,omitempty"`
	CorrectChoice json.RawMessage `json:"correctChoice,omitempty"`
	Explanation   *string         `json:"explanation,omitempty"`
}

func (h *Handler) progress(c *gin.Context) {
	moduleID, ok := parseID(c, "module-not-found")
	if !ok {
		return
	}
	v := viewer(c)
	rows, err := h.svc.ModuleProgress(c.Request.Context(), moduleID, v)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": moduleID, "items": progressItems(rows)})
}

func progressItems(rows []service.ProgressEntry) []progressItem {
	items := make([]progressItem, len(rows))
	for i, p := range rows {
		items[i] = progressItem{QuestionID: p.QuestionID, CompletedAt: p.CompletedAt, Attempts: p.Attempts}
		if p.Response != nil {
			passed := p.LastPassed
			items[i].Response, items[i].Passed = p.Response, &passed
			items[i].CorrectAnswer, items[i].CorrectChoice = revealed(p.CorrectField, p.Correct)
			items[i].Explanation = p.Explanation
		}
	}
	return items
}

func viewer(c *gin.Context) contentservice.Viewer {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		return contentservice.Viewer{}
	}
	id := p.UserID
	return contentservice.Viewer{UserID: &id, Role: p.Role}
}

func parseID(c *gin.Context, notFoundType string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.NotFound(notFoundType, "The requested resource does not exist."))
		return uuid.Nil, false
	}
	return id, true
}

// failModule maps the errors of the module routes, whose missing resource is
// the module itself.
func failModule(c *gin.Context, err error) {
	if errors.Is(err, contentservice.ErrModuleNotFound) {
		err = problem.NotFound("module-not-found", "The module does not exist or is not available.")
	}
	fail(c, err)
}

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, contentservice.ErrQuestionNotFound), errors.Is(err, contentservice.ErrModuleNotFound):
		err = problem.NotFound("question-not-found", "The exercise does not exist or is not available for practice.")
	case errors.Is(err, contentservice.ErrAuthRequired):
		err = problem.Unauthorized("not-authenticated", "Authentication is required.")
	case errors.Is(err, contentservice.ErrForbidden):
		err = problem.Forbidden("forbidden", "Access to this exercise is not allowed.")
	case errors.Is(err, service.ErrAlreadyAnswered):
		err = problem.Conflict("already-answered", "This question was already answered.")
	case errors.Is(err, service.ErrSnapshotRequired):
		err = problem.Validation("The snapshot is required.", problem.InvalidParam{Name: "snapshot", Reason: "required"})
	case errors.Is(err, service.ErrResponseRequired), errors.Is(err, contentdomain.ErrInvalidResponse):
		err = problem.Validation("The response does not fit this question.", problem.InvalidParam{Name: "response", Reason: "required: a boolean value, or the id of one of the choices"})
	case errors.Is(err, service.ErrInvalidSnapshot):
		err = problem.Validation("The snapshot is not a valid serialized machine.",
			problem.InvalidParam{Name: "snapshot", Reason: "invalid format"})
	}
	_ = c.Error(err)
	c.Abort()
}
