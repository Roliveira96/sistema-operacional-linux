// Package handler exposes the links of a class over HTTP (SPEC-048, section 5).
package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// LinkService is what the handler uses from the service.
type LinkService interface {
	List(ctx context.Context, actor service.Actor, classID uuid.UUID) ([]domain.ClassLink, error)
	Replace(ctx context.Context, actor service.Actor, classID uuid.UUID, in []domain.Input) ([]domain.ClassLink, error)
}

// Handler serves the routes of the links.
type Handler struct {
	svc  LinkService
	auth authn.Validator
}

// New creates the handler.
func New(svc LinkService, auth authn.Validator) *Handler { return &Handler{svc: svc, auth: auth} }

// Register wires the routes under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("", authn.Required(h.auth), authn.PasswordChanged())
	g.GET("/classes/:id/links", h.list)
	g.PUT("/classes/:id/links", h.replace)
}

type linkJSON struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	URL      string    `json:"url"`
	Position int       `json:"position"`
}

type linkInput struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func toJSON(links []domain.ClassLink) gin.H {
	out := make([]linkJSON, 0, len(links))
	for _, l := range links {
		out = append(out, linkJSON{ID: l.ID, Name: l.Name, URL: l.URL, Position: l.Position})
	}
	return gin.H{"links": out}
}

func (h *Handler) list(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	links, err := h.svc.List(c.Request.Context(), actor, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toJSON(links))
}

func (h *Handler) replace(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	var req struct {
		Links []linkInput `json:"links" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}
	in := make([]domain.Input, len(req.Links))
	for i, l := range req.Links {
		in[i] = domain.Input{Name: l.Name, URL: l.URL}
	}
	links, err := h.svc.Replace(c.Request.Context(), actor, classID, in)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toJSON(links))
}

func requestOf(c *gin.Context) (service.Actor, uuid.UUID, bool) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return service.Actor{}, uuid.Nil, false
	}
	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The id parameter is invalid."))
		return service.Actor{}, uuid.Nil, false
	}
	return service.Actor{UserID: p.UserID, Role: p.Role}, classID, true
}

func toProblem(err error) *problem.Problem {
	var fe *domain.FieldError
	switch {
	case errors.Is(err, domain.ErrInvalidLink):
		p := problem.BadRequest("invalid-link", err.Error())
		if errors.As(err, &fe) {
			p = p.WithExtension("field", fe.Field)
		}
		return p
	case errors.Is(err, domain.ErrTooManyLinks):
		return problem.BadRequest("too-many-links", err.Error())
	case errors.Is(err, domain.ErrForbidden):
		return problem.Forbidden("forbidden", err.Error())
	case errors.Is(err, domain.ErrClassNotFound):
		return problem.NotFound("class-not-found", err.Error())
	case errors.Is(err, domain.ErrClassArchived):
		return problem.Conflict("class-archived", err.Error())
	default:
		return problem.Internal()
	}
}

func fail(c *gin.Context, p *problem.Problem) {
	_ = c.Error(p)
	c.Abort()
}
