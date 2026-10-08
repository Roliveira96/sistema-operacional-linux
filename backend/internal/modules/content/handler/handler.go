// Package handler exposes the content read endpoints (SPEC-012).
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// Reader is the read use-case port.
type Reader interface {
	Blocks(ctx context.Context, moduleID uuid.UUID, v service.Viewer) ([]domain.ContentBlock, error)
	Questions(ctx context.Context, moduleID uuid.UUID, usage string, v service.Viewer) ([]service.PublicQuestion, error)
	TeacherQuestions(ctx context.Context, moduleID uuid.UUID, v service.Viewer) ([]service.TeacherQuestion, error)
	Templates(ctx context.Context) ([]service.TemplateSummary, error)
}

// Handler serves the content routes.
type Handler struct {
	reader Reader
	auth   authn.Validator
}

// New creates the handler.
func New(reader Reader, auth authn.Validator) *Handler {
	return &Handler{reader: reader, auth: auth}
}

// Register mounts the routes under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	public := r.Group("", authn.Optional(h.auth))
	public.GET("/modules/:id/blocks", h.blocks)
	public.GET("/modules/:id/questions", h.questions)
	r.GET("/assessment-templates", h.templates)

	teacher := r.Group("/teacher", authn.Required(h.auth), authn.PasswordChanged(),
		authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacher.GET("/modules/:id/questions", h.teacherQuestions)
}

type blockResponse struct {
	ID       uuid.UUID       `json:"id"`
	Type     string          `json:"type"`
	Position int             `json:"position"`
	Payload  json.RawMessage `json:"payload"`
}

func (h *Handler) blocks(c *gin.Context) {
	id, ok := moduleID(c)
	if !ok {
		return
	}
	blocks, err := h.reader.Blocks(c.Request.Context(), id, viewer(c))
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]blockResponse, len(blocks))
	for i, b := range blocks {
		out[i] = blockResponse{ID: b.ID, Type: string(b.BlockType), Position: b.Position, Payload: b.Payload}
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "blocks": out})
}

func (h *Handler) questions(c *gin.Context) {
	id, ok := moduleID(c)
	if !ok {
		return
	}
	usage := c.Query("usage")
	if usage != "" && usage != domain.UsageExercise && usage != domain.UsageAssessment {
		fail(c, problem.Validation("usage must be EXERCISE or ASSESSMENT.", problem.InvalidParam{Name: "usage", Reason: "invalid value"}))
		return
	}
	qs, err := h.reader.Questions(c.Request.Context(), id, usage, viewer(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "questions": qs})
}

func (h *Handler) teacherQuestions(c *gin.Context) {
	id, ok := moduleID(c)
	if !ok {
		return
	}
	qs, err := h.reader.TeacherQuestions(c.Request.Context(), id, viewer(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "questions": qs})
}

func (h *Handler) templates(c *gin.Context) {
	ts, err := h.reader.Templates(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": ts})
}

func viewer(c *gin.Context) service.Viewer {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		return service.Viewer{}
	}
	id := p.UserID
	return service.Viewer{UserID: &id, Role: p.Role}
}

func moduleID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.NotFound("module-not-found", "The module does not exist or is not available."))
		return uuid.Nil, false
	}
	return id, true
}

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrModuleNotFound):
		err = problem.NotFound("module-not-found", "The module does not exist or is not available.")
	case errors.Is(err, service.ErrAuthRequired):
		err = problem.Unauthorized("not-authenticated", "Authentication is required to read this module.")
	case errors.Is(err, service.ErrForbidden):
		err = problem.Forbidden("forbidden", "Access to this module is not allowed.")
	}
	_ = c.Error(err)
	c.Abort()
}
