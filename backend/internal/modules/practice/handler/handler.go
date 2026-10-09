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

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// MaxSnapshotBytes bounds the body of a check (P-05).
const MaxSnapshotBytes = 2 << 20

// Service is the practice use-case port.
type Service interface {
	Scenario(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error)
	Check(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer, snapshot json.RawMessage) (service.CheckResult, error)
	ModuleProgress(ctx context.Context, userID, moduleID uuid.UUID) ([]domain.Progress, error)
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
}

type checkResponse struct {
	Passed      bool       `json:"passed"`
	CompletedAt *time.Time `json:"completedAt"`
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
	snapshot, ok := readSnapshot(c)
	if !ok {
		return
	}
	result, err := h.svc.Check(c.Request.Context(), id, v, snapshot)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, checkResponse{Passed: result.Passed, CompletedAt: result.CompletedAt})
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
}

func (h *Handler) progress(c *gin.Context) {
	moduleID, ok := parseID(c, "module-not-found")
	if !ok {
		return
	}
	v := viewer(c)
	rows, err := h.svc.ModuleProgress(c.Request.Context(), *v.UserID, moduleID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": moduleID, "items": progressItems(rows)})
}

func progressItems(rows []domain.Progress) []progressItem {
	items := make([]progressItem, len(rows))
	for i, p := range rows {
		items[i] = progressItem{QuestionID: p.QuestionID, CompletedAt: p.CompletedAt, Attempts: p.Attempts}
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
	case errors.Is(err, service.ErrInvalidSnapshot):
		err = problem.Validation("The snapshot is not a valid serialized machine.",
			problem.InvalidParam{Name: "snapshot", Reason: "invalid format"})
	}
	_ = c.Error(err)
	c.Abort()
}
