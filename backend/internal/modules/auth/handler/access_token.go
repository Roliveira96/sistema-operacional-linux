package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// AccessTokenService is the use-case port of the personal access token
// endpoints (SPEC-024).
type AccessTokenService interface {
	CreateAccessToken(ctx context.Context, p authn.Principal, name string, validityDays int) (domain.AccessToken, string, error)
	ListAccessTokens(ctx context.Context, p authn.Principal) ([]domain.AccessToken, error)
	RevokeAccessToken(ctx context.Context, p authn.Principal, id uuid.UUID) error
}

// CreateLimiter limits token creation per user (see platform/ratelimit).
type CreateLimiter interface {
	Allow(key string) (bool, time.Duration)
}

// AccessTokenHandler serves /api/v1/access-tokens. Session cookie only: a
// personal access token cannot manage personal access tokens.
type AccessTokenHandler struct {
	svc       AccessTokenService
	sessions  authn.Validator
	createLim CreateLimiter
	now       func() time.Time
}

// NewAccessTokens creates the handler. sessions authenticates the cookie
// (the auth service); createLim limits creations per user.
func NewAccessTokens(svc AccessTokenService, sessions authn.Validator, createLim CreateLimiter) *AccessTokenHandler {
	return &AccessTokenHandler{svc: svc, sessions: sessions, createLim: createLim, now: time.Now}
}

// Register mounts the routes under the given group (expected: /api/v1).
func (h *AccessTokenHandler) Register(r gin.IRouter) {
	g := r.Group("/access-tokens", authn.Required(h.sessions), authn.PasswordChanged(),
		authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	g.GET("", h.list)
	g.POST("", h.create)
	g.DELETE("/:id", h.revoke)
}

type accessTokenItem struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	Status     string     `json:"status"`
}

func (h *AccessTokenHandler) list(c *gin.Context) {
	p, _ := authn.FromContext(c.Request.Context())
	tokens, err := h.svc.ListAccessTokens(c.Request.Context(), p)
	if err != nil {
		fail(c, err)
		return
	}
	now := h.now()
	items := make([]accessTokenItem, 0, len(tokens))
	for _, t := range tokens {
		items = append(items, accessTokenItem{
			ID: t.ID, Name: t.Name, CreatedAt: t.CreatedAt.UTC(), LastUsedAt: t.LastUsedAt,
			ExpiresAt: t.ExpiresAt.UTC(), Status: string(t.Status(now)),
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type createAccessTokenRequest struct {
	Name         string `json:"name"`
	ValidityDays int    `json:"validityDays"`
}

type createAccessTokenResponse struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	ExpiresAt time.Time `json:"expiresAt"`
	Token     string    `json:"token"`
}

func (h *AccessTokenHandler) create(c *gin.Context) {
	p, _ := authn.FromContext(c.Request.Context())
	if ok, retry := h.createLim.Allow(p.UserID.String()); !ok {
		fail(c, rateLimited(retry))
		return
	}
	var body createAccessTokenRequest
	if !bind(c, &body) {
		return
	}
	t, raw, err := h.svc.CreateAccessToken(c.Request.Context(), p, body.Name, body.ValidityDays)
	if err != nil {
		fail(c, accessTokenProblem(err))
		return
	}
	c.JSON(http.StatusCreated, createAccessTokenResponse{ID: t.ID, Name: t.Name, ExpiresAt: t.ExpiresAt.UTC(), Token: raw})
}

func (h *AccessTokenHandler) revoke(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, accessTokenProblem(domain.ErrAccessTokenNotFound))
		return
	}
	p, _ := authn.FromContext(c.Request.Context())
	if err := h.svc.RevokeAccessToken(c.Request.Context(), p, id); err != nil {
		fail(c, accessTokenProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

// accessTokenProblem maps access token errors to RFC 7807 problems.
func accessTokenProblem(err error) error {
	switch {
	case errors.Is(err, domain.ErrAccessTokenName):
		return problem.Validation("The name must have 1 to 80 characters.",
			problem.InvalidParam{Name: "name", Reason: "must have 1 to 80 characters"})
	case errors.Is(err, domain.ErrAccessTokenValidity):
		return problem.Validation("The validity must be 30, 90 or 365 days.",
			problem.InvalidParam{Name: "validityDays", Reason: "must be 30, 90 or 365"})
	case errors.Is(err, domain.ErrAccessTokenForbidden):
		return problem.Forbidden("forbidden", "This action is not allowed for the current user.")
	case errors.Is(err, domain.ErrAccessTokenNotFound):
		return problem.NotFound("access-token-not-found", "The access token does not exist.")
	}
	return err
}
