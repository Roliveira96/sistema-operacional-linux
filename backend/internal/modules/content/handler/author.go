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

// maxAuthoringBody is the largest request body the authoring routes accept (SPEC-019 5.6).
const maxAuthoringBody = 1 << 20

// Authoring is the block authoring use-case port (SPEC-019).
type Authoring interface {
	List(ctx context.Context, who service.Actor, moduleID uuid.UUID) ([]domain.ContentBlock, error)
	Create(ctx context.Context, who service.Actor, moduleID uuid.UUID, t domain.BlockType, payload json.RawMessage, afterID *uuid.UUID) (domain.ContentBlock, error)
	Update(ctx context.Context, who service.Actor, blockID uuid.UUID, payload json.RawMessage, expected time.Time, force bool) (domain.ContentBlock, error)
	Delete(ctx context.Context, who service.Actor, blockID uuid.UUID) error
	SetActive(ctx context.Context, who service.Actor, blockID uuid.UUID, active bool) (domain.ContentBlock, error)
	Setup(ctx context.Context, who service.Actor, moduleID uuid.UUID) (json.RawMessage, error)
	SetSetup(ctx context.Context, who service.Actor, moduleID uuid.UUID, setup json.RawMessage) (json.RawMessage, error)
	SaveCard(ctx context.Context, who service.Actor, moduleID uuid.UUID, in service.SaveCardInput) ([]domain.ContentBlock, error)
	SetActiveMany(ctx context.Context, who service.Actor, moduleID uuid.UUID, ids []uuid.UUID, active bool) ([]domain.ContentBlock, error)
	Reorder(ctx context.Context, who service.Actor, moduleID uuid.UUID, ids []uuid.UUID) ([]domain.ContentBlock, error)
}

// Limiter limits writes per user.
type Limiter interface {
	Allow(key string) (bool, time.Duration)
}

// AuthorHandler serves the block authoring routes.
type AuthorHandler struct {
	author  Authoring
	auth    authn.Validator
	limiter Limiter
}

// NewAuthor creates the authoring handler.
func NewAuthor(author Authoring, auth authn.Validator, limiter Limiter) *AuthorHandler {
	return &AuthorHandler{author: author, auth: auth, limiter: limiter}
}

// Register mounts the routes under /api/v1/teacher.
func (h *AuthorHandler) Register(r gin.IRouter) {
	teacher := r.Group("/teacher", authn.Required(h.auth), authn.PasswordChanged(),
		authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacher.GET("/modules/:id/blocks", h.list)
	teacher.POST("/modules/:id/blocks", h.write, h.create)
	teacher.PUT("/modules/:id/blocks/order", h.write, h.reorder)
	teacher.PATCH("/blocks/:id", h.write, h.update)
	teacher.DELETE("/blocks/:id", h.write, h.remove)
	teacher.PUT("/blocks/:id/active", h.write, h.setActive)
	teacher.PUT("/modules/:id/setup", h.write, h.putSetup)
	teacher.PUT("/modules/:id/cards", h.write, h.saveCard)
	teacher.PUT("/modules/:id/cards/active", h.write, h.setCardActive)
}

// write bounds the body and the rate of the routes that change content.
func (h *AuthorHandler) write(c *gin.Context) { h.bounded(maxAuthoringBody)(c) }

// bounded is write with another body limit (a recorded machine is larger than a block).
func (h *AuthorHandler) bounded(limit int64) gin.HandlerFunc {
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

type authoredBlock struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"type"`
	Position  int             `json:"position"`
	Payload   json.RawMessage `json:"payload"`
	Edited    bool            `json:"edited"`
	Active    bool            `json:"active"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func toAuthored(b domain.ContentBlock) authoredBlock {
	return authoredBlock{ID: b.ID, Type: string(b.BlockType), Position: b.Position, Payload: b.Payload, Edited: b.EditedByTeacherAt != nil, Active: b.Active(), UpdatedAt: b.UpdatedAt}
}

func toAuthoredList(blocks []domain.ContentBlock) []authoredBlock {
	out := make([]authoredBlock, len(blocks))
	for i, b := range blocks {
		out[i] = toAuthored(b)
	}
	return out
}

func actor(c *gin.Context) (service.Actor, bool) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		return service.Actor{}, false
	}
	return service.Actor{UserID: p.UserID, Role: p.Role}, true
}

func authFail(c *gin.Context, err error) {
	_ = c.Error(err)
	c.Abort()
}

func (h *AuthorHandler) list(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	blocks, err := h.author.List(c.Request.Context(), who, id)
	if err != nil {
		authorFail(c, err)
		return
	}
	setup, err := h.author.Setup(c.Request.Context(), who, id)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "blocks": toAuthoredList(blocks), "setup": setupOrNull(setup)})
}

type createBlockRequest struct {
	Type         string          `json:"type"`
	Payload      json.RawMessage `json:"payload"`
	AfterBlockID *uuid.UUID      `json:"afterBlockId"`
}

func (h *AuthorHandler) create(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req createBlockRequest
	if !bindBody(c, &req) {
		return
	}
	b, err := h.author.Create(c.Request.Context(), who, id, domain.BlockType(req.Type), req.Payload, req.AfterBlockID)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, toAuthored(b))
}

type updateBlockRequest struct {
	Payload           json.RawMessage `json:"payload"`
	ExpectedUpdatedAt *time.Time      `json:"expectedUpdatedAt"`
	Force             bool            `json:"force"`
}

func (h *AuthorHandler) update(c *gin.Context) {
	blockID, ok := blockID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req updateBlockRequest
	if !bindBody(c, &req) {
		return
	}
	if req.ExpectedUpdatedAt == nil && !req.Force {
		authFail(c, problem.Validation("The instant of the last known change is required.",
			problem.InvalidParam{Name: "expectedUpdatedAt", Reason: "required"}))
		return
	}
	var expected time.Time
	if req.ExpectedUpdatedAt != nil {
		expected = *req.ExpectedUpdatedAt
	}
	b, err := h.author.Update(c.Request.Context(), who, blockID, req.Payload, expected, req.Force)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toAuthored(b))
}

func (h *AuthorHandler) remove(c *gin.Context) {
	blockID, ok := blockID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	if err := h.author.Delete(c.Request.Context(), who, blockID); err != nil {
		authorFail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type activeRequest struct {
	Active *bool `json:"active"`
}

func (h *AuthorHandler) setActive(c *gin.Context) {
	blockID, ok := blockID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req activeRequest
	if !bindBody(c, &req) {
		return
	}
	if req.Active == nil {
		authFail(c, problem.Validation("The new situation is required.", problem.InvalidParam{Name: "active", Reason: "required"}))
		return
	}
	b, err := h.author.SetActive(c.Request.Context(), who, blockID, *req.Active)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toAuthored(b))
}

type reorderBlocksRequest struct {
	BlockIDs []uuid.UUID `json:"blockIds"`
}

func (h *AuthorHandler) reorder(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req reorderBlocksRequest
	if !bindBody(c, &req) {
		return
	}
	blocks, err := h.author.Reorder(c.Request.Context(), who, id, req.BlockIDs)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "blocks": toAuthoredList(blocks)})
}

func blockID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		authFail(c, problem.NotFound("block-not-found", "The block does not exist."))
		return uuid.Nil, false
	}
	return id, true
}

// bindBody reads the JSON body, telling an oversized one from a malformed one.
func bindBody(c *gin.Context, into any) bool {
	if err := c.ShouldBindJSON(into); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			authFail(c, problem.PayloadTooLarge("The request body must have at most 1 MB."))
			return false
		}
		authFail(c, problem.Validation("The request body must be a valid JSON object."))
		return false
	}
	return true
}

func authorFail(c *gin.Context, err error) {
	var payloadErr *domain.PayloadError
	switch {
	case errors.As(err, &payloadErr):
		params := make([]problem.InvalidParam, len(payloadErr.Fields))
		for i, f := range payloadErr.Fields {
			params[i] = problem.InvalidParam{Name: f.Field, Reason: f.Reason}
		}
		err = problem.Validation("The block content is not valid for its type.", params...)
	case errors.Is(err, service.ErrInvalidCard):
		err = problem.Validation("The card does not match the blocks of the module.",
			problem.InvalidParam{Name: "replaceIds", Reason: "must be adjacent blocks of the module, and kept blocks must keep their type"})
	case errors.Is(err, service.ErrInvalidOrder):
		err = problem.Validation("The order must list every block of the module exactly once.",
			problem.InvalidParam{Name: "blockIds", Reason: "must be exactly the blocks of the module"})
	case errors.Is(err, service.ErrBlockNotFound):
		err = problem.NotFound("block-not-found", "The block does not exist.")
	case errors.Is(err, service.ErrBlockConflict):
		err = problem.Conflict("block-conflict", "The block was changed by someone else after you opened it.")
	case errors.Is(err, service.ErrModuleNotFound):
		err = problem.NotFound("module-not-found", "The module does not exist.")
	case errors.Is(err, service.ErrForbidden):
		err = problem.Forbidden("forbidden", "You cannot edit the content of this module.")
	}
	authFail(c, err)
}
