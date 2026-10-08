// Package authn is the authentication contract shared by every module: the
// session cookie name, the authenticated principal carried in the request
// context and the middlewares that protect routes. The auth module provides
// the Validator implementation; this package never imports a module.
package authn

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// CookieName is the session cookie.
const CookieName = "linux_lab_session"

// Roles.
const (
	RoleAdmin   = "ADMIN"
	RoleTeacher = "TEACHER"
	RoleStudent = "STUDENT"
)

// Session expiry reasons reported in the session-expired problem.
const (
	ReasonIdle     = "IDLE"
	ReasonAbsolute = "ABSOLUTE"
)

// ErrNotAuthenticated means there is no valid session.
var ErrNotAuthenticated = errors.New("not authenticated")

// SessionExpiredError means the session existed but expired.
type SessionExpiredError struct {
	Reason string
}

func (e *SessionExpiredError) Error() string { return "session expired: " + e.Reason }

// Principal is the authenticated user of a request.
type Principal struct {
	UserID             uuid.UUID
	SessionID          uuid.UUID
	Role               string
	MustChangePassword bool
	SessionCreatedAt   time.Time
	SessionExpiresAt   time.Time
}

// Validator resolves a raw session token into a principal, or returns
// ErrNotAuthenticated or *SessionExpiredError.
type Validator interface {
	Authenticate(ctx context.Context, token string) (Principal, error)
}

type principalKey struct{}

// WithPrincipal stores the principal in ctx.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// FromContext returns the principal stored in ctx.
func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}

// Required authenticates the request from the session cookie and stores the
// principal in the request context. Failures abort with a 401 problem.
func Required(v Validator) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(CookieName)
		if err != nil || token == "" {
			abort(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
			return
		}
		p, err := v.Authenticate(c.Request.Context(), token)
		if err != nil {
			var expired *SessionExpiredError
			switch {
			case errors.As(err, &expired):
				abort(c, problem.Unauthorized("session-expired", "The session has expired.").
					WithExtension("reason", expired.Reason))
			case errors.Is(err, ErrNotAuthenticated):
				abort(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
			default:
				_ = c.Error(err)
				c.Abort()
			}
			return
		}
		c.Request = c.Request.WithContext(WithPrincipal(c.Request.Context(), p))
		c.Next()
	}
}

// Optional stores the principal when the request carries a valid session and
// continues anonymously otherwise (public routes that adapt to the user).
func Optional(v Validator) gin.HandlerFunc {
	return func(c *gin.Context) {
		if token, err := c.Cookie(CookieName); err == nil && token != "" {
			if p, err := v.Authenticate(c.Request.Context(), token); err == nil {
				c.Request = c.Request.WithContext(WithPrincipal(c.Request.Context(), p))
			}
		}
		c.Next()
	}
}

// PasswordChanged blocks principals that must change their password.
// Must run after Required.
func PasswordChanged() gin.HandlerFunc {
	return func(c *gin.Context) {
		if p, ok := FromContext(c.Request.Context()); ok && p.MustChangePassword {
			abort(c, problem.Forbidden("password-change-required", "The password must be changed before continuing."))
			return
		}
		c.Next()
	}
}

// Roles allows only principals with one of the given roles. Must run after
// Required.
func Roles(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, ok := FromContext(c.Request.Context())
		if !ok || !slices.Contains(roles, p.Role) {
			abort(c, problem.Forbidden("forbidden", "This action is not allowed for the current user."))
			return
		}
		c.Next()
	}
}

func abort(c *gin.Context, p *problem.Problem) {
	_ = c.Error(p)
	c.Abort()
}
