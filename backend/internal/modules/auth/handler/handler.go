// Package handler exposes the /api/v1/auth endpoints (SPEC-003).
package handler

import (
	"context"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// Service is the auth use-case port consumed by the handler.
type Service interface {
	authn.Validator
	Login(ctx context.Context, id userdomain.Identifier, rawIdentifier, password string, req domain.RequestInfo) (service.LoginResult, error)
	RecordRateLimited(ctx context.Context, rawIdentifier string, req domain.RequestInfo)
	Logout(ctx context.Context, p authn.Principal, req domain.RequestInfo) error
	Me(ctx context.Context, p authn.Principal) (userdomain.User, error)
	ForgotPassword(ctx context.Context, id userdomain.Identifier, rawIdentifier string, req domain.RequestInfo) error
	ResetPassword(ctx context.Context, token, newPassword string, req domain.RequestInfo) (int64, error)
	ChangePassword(ctx context.Context, p authn.Principal, current, newPassword string, req domain.RequestInfo) error
}

// Limiter is the rate limiter port (see platform/ratelimit).
type Limiter interface {
	Allow(key string) (bool, time.Duration)
	Check(key string) (bool, time.Duration)
	Record(key string)
	Reset(key string)
}

// Limiters groups the limits of RN-09.
type Limiters struct {
	LoginIP       Limiter // 20 requests per IP per minute
	LoginFailures Limiter // 5 failures per identifier per 15 minutes
	ForgotIP      Limiter // 20 requests per IP per minute
	ForgotID      Limiter // 3 requests per identifier per hour
}

// Handler serves the auth routes.
type Handler struct {
	svc          Service
	limits       Limiters
	secureCookie bool
	now          func() time.Time
}

// New creates the handler. secureCookie sets the Secure cookie attribute; it
// is false only in development, which is reached by IP over plain HTTP.
func New(svc Service, limits Limiters, secureCookie bool) *Handler {
	return &Handler{svc: svc, limits: limits, secureCookie: secureCookie, now: time.Now}
}

// Register mounts the routes under the given group (expected: /api/v1).
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("/auth")
	g.POST("/login", h.login)
	g.POST("/forgot-password", h.forgotPassword)
	g.POST("/reset-password", h.resetPassword)

	authed := g.Group("", authn.Required(h.svc))
	authed.POST("/logout", h.logout)
	authed.GET("/me", h.me)
	authed.POST("/change-password", h.changePassword)
}

type loginRequest struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

type loginResponse struct {
	UserID             uuid.UUID `json:"userId"`
	Name               *string   `json:"name,omitempty"`
	Role               string    `json:"role"`
	MustChangePassword bool      `json:"mustChangePassword"`
	SessionExpiresAt   time.Time `json:"sessionExpiresAt"`
}

func (h *Handler) login(c *gin.Context) {
	req := requestInfo(c)
	if ok, retry := h.limits.LoginIP.Allow(req.IP); !ok {
		h.svc.RecordRateLimited(c.Request.Context(), "", req)
		fail(c, rateLimited(retry))
		return
	}

	var body loginRequest
	if !bind(c, &body) {
		return
	}
	var params []problem.InvalidParam
	if body.Identifier == "" {
		params = append(params, problem.InvalidParam{Name: "identifier", Reason: "required"})
	}
	if body.Password == "" {
		params = append(params, problem.InvalidParam{Name: "password", Reason: "required"})
	}
	if len(params) > 0 {
		fail(c, problem.Validation("Required fields are missing.", params...))
		return
	}
	id, err := userdomain.ParseIdentifier(body.Identifier)
	if err != nil {
		fail(c, invalidIdentifier())
		return
	}

	key := id.Key()
	if ok, retry := h.limits.LoginFailures.Check(key); !ok {
		h.svc.RecordRateLimited(c.Request.Context(), body.Identifier, req)
		fail(c, rateLimited(retry))
		return
	}

	result, err := h.svc.Login(c.Request.Context(), id, body.Identifier, body.Password, req)
	if errors.Is(err, domain.ErrInvalidCredentials) {
		h.limits.LoginFailures.Record(key)
	} else if err == nil {
		h.limits.LoginFailures.Reset(key)
	}
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	h.setSessionCookie(c, result.Token, result.Session.ExpiresAt)
	c.JSON(http.StatusOK, loginResponse{
		UserID:             result.User.ID,
		Name:               result.User.Name,
		Role:               string(result.User.Role),
		MustChangePassword: result.User.MustChangePassword,
		SessionExpiresAt:   result.Session.ExpiresAt.UTC(),
	})
}

func (h *Handler) logout(c *gin.Context) {
	p, _ := authn.FromContext(c.Request.Context())
	if err := h.svc.Logout(c.Request.Context(), p, requestInfo(c)); err != nil {
		fail(c, err)
		return
	}
	h.clearSessionCookie(c)
	c.Status(http.StatusNoContent)
}

type meResponse struct {
	UserID             uuid.UUID `json:"userId"`
	Email              string    `json:"email"`
	Name               *string   `json:"name,omitempty"`
	Role               string    `json:"role"`
	Status             string    `json:"status"`
	MustChangePassword bool      `json:"mustChangePassword"`
	SessionCreatedAt   time.Time `json:"sessionCreatedAt"`
	SessionExpiresAt   time.Time `json:"sessionExpiresAt"`
}

func (h *Handler) me(c *gin.Context) {
	p, _ := authn.FromContext(c.Request.Context())
	u, err := h.svc.Me(c.Request.Context(), p)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, meResponse{
		UserID:             u.ID,
		Email:              u.Email,
		Name:               u.Name,
		Role:               string(u.Role),
		Status:             string(u.Status),
		MustChangePassword: u.MustChangePassword,
		SessionCreatedAt:   p.SessionCreatedAt.UTC(),
		SessionExpiresAt:   p.SessionExpiresAt.UTC(),
	})
}

type forgotRequest struct {
	Identifier string `json:"identifier"`
}

type messageResponse struct {
	Message string `json:"message"`
}

func (h *Handler) forgotPassword(c *gin.Context) {
	req := requestInfo(c)
	if ok, retry := h.limits.ForgotIP.Allow(req.IP); !ok {
		fail(c, rateLimited(retry))
		return
	}
	var body forgotRequest
	if !bind(c, &body) {
		return
	}
	if body.Identifier == "" {
		fail(c, problem.Validation("Required fields are missing.",
			problem.InvalidParam{Name: "identifier", Reason: "required"}))
		return
	}
	id, err := userdomain.ParseIdentifier(body.Identifier)
	if err != nil {
		fail(c, invalidIdentifier())
		return
	}
	if ok, retry := h.limits.ForgotID.Allow(id.Key()); !ok {
		fail(c, rateLimited(retry))
		return
	}
	if err := h.svc.ForgotPassword(c.Request.Context(), id, body.Identifier, req); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusAccepted, messageResponse{
		Message: "If the account exists, a password reset link has been sent to its e-mail.",
	})
}

type resetRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

type resetResponse struct {
	SessionsRevoked int64 `json:"sessionsRevoked"`
}

func (h *Handler) resetPassword(c *gin.Context) {
	var body resetRequest
	if !bind(c, &body) {
		return
	}
	var params []problem.InvalidParam
	if body.Token == "" {
		params = append(params, problem.InvalidParam{Name: "token", Reason: "required"})
	}
	if body.NewPassword == "" {
		params = append(params, problem.InvalidParam{Name: "newPassword", Reason: "required"})
	}
	if len(params) > 0 {
		fail(c, problem.Validation("Required fields are missing.", params...))
		return
	}
	n, err := h.svc.ResetPassword(c.Request.Context(), body.Token, body.NewPassword, requestInfo(c))
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, resetResponse{SessionsRevoked: n})
}

type changeRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (h *Handler) changePassword(c *gin.Context) {
	var body changeRequest
	if !bind(c, &body) {
		return
	}
	var params []problem.InvalidParam
	if body.CurrentPassword == "" {
		params = append(params, problem.InvalidParam{Name: "currentPassword", Reason: "required"})
	}
	if body.NewPassword == "" {
		params = append(params, problem.InvalidParam{Name: "newPassword", Reason: "required"})
	}
	if len(params) > 0 {
		fail(c, problem.Validation("Required fields are missing.", params...))
		return
	}
	p, _ := authn.FromContext(c.Request.Context())
	if err := h.svc.ChangePassword(c.Request.Context(), p, body.CurrentPassword, body.NewPassword, requestInfo(c)); err != nil {
		fail(c, toProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) setSessionCookie(c *gin.Context, token string, expiresAt time.Time) {
	maxAge := int(math.Ceil(expiresAt.Sub(h.now()).Seconds()))
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     authn.CookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteStrictMode,
	})
}

func (h *Handler) clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     authn.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteStrictMode,
	})
}

func requestInfo(c *gin.Context) domain.RequestInfo {
	return domain.RequestInfo{IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}
}

func bind(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		fail(c, problem.Validation("The request body must be a valid JSON object."))
		return false
	}
	return true
}

func fail(c *gin.Context, err error) {
	_ = c.Error(err)
	c.Abort()
}

func invalidIdentifier() *problem.Problem {
	return problem.Validation("The identifier must be an e-mail or a 7-digit academic id.",
		problem.InvalidParam{Name: "identifier", Reason: "invalid format"})
}

func rateLimited(retry time.Duration) *problem.Problem {
	return problem.TooManyRequests("Too many attempts. Try again later.", int(math.Ceil(retry.Seconds())))
}

// toProblem maps domain errors to RFC 7807 problems. Unknown errors are
// returned as is and become a generic 500 in the error middleware.
func toProblem(err error) error {
	var policy *domain.PolicyError
	switch {
	case errors.Is(err, domain.ErrInvalidCredentials):
		return problem.Unauthorized("invalid-credentials", "Invalid credentials.")
	case errors.Is(err, domain.ErrResetTokenInvalid):
		return problem.Gone("reset-token-invalid", "The reset link is invalid, expired or was already used.")
	case errors.As(err, &policy):
		return problem.BadRequest("weak-password", "The password does not meet the policy.").
			WithExtension("violations", policy.Violations)
	}
	return err
}
