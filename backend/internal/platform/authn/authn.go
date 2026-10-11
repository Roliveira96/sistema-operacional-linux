// Package authn is the authentication contract shared by every module: the
// session cookie name, the authenticated principal carried in the request
// context and the middlewares that protect routes. The auth module provides
// the Validator implementation; this package never imports a module.
package authn

import (
	"context"
	"errors"
	"slices"
	"strings"
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

// ErrForbidden means the credential is valid but its user may not use it
// (for example, a personal access token of a user that is no longer a teacher).
var ErrForbidden = errors.New("forbidden")

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

// BearerValidator resolves a raw personal access token into a principal, or
// returns ErrNotAuthenticated or ErrForbidden.
type BearerValidator interface {
	AuthenticateAccessToken(ctx context.Context, raw string) (Principal, error)
}

// RequiredBearer authenticates the request from "Authorization: Bearer
// <token>" (SPEC-024) and stores the principal in the request context. It
// never reads the session cookie. Failures abort with 401 invalid-access-token;
// a role other than ADMIN or TEACHER aborts with 403 forbidden.
func RequiredBearer(v BearerValidator) gin.HandlerFunc {
	return RequiredBearerWith(v, BearerOptions{})
}

// BearerOptions tunes RequiredBearerWith.
type BearerOptions struct {
	// ResourceMetadataURL, when set, is advertised in the WWW-Authenticate header of the 401 so an MCP client
	// can discover the OAuth login (SPEC-024 RN-14).
	ResourceMetadataURL string
	// DevUser, when set, authenticates requests that carry no Authorization header as a fixed local user
	// (SPEC-024 RN-15). It must only be wired in development.
	DevUser func(ctx context.Context) (Principal, error)
}

// RequiredBearerWith is RequiredBearer with the options of BearerOptions.
func RequiredBearerWith(v BearerValidator, opts BearerOptions) gin.HandlerFunc {
	deny := func(c *gin.Context) {
		if opts.ResourceMetadataURL != "" {
			c.Header("WWW-Authenticate", `Bearer resource_metadata="`+opts.ResourceMetadataURL+`"`)
		}
		abort(c, invalidAccessToken())
	}
	return func(c *gin.Context) {
		var p Principal
		var err error
		header := c.GetHeader("Authorization")
		if header == "" && opts.DevUser != nil {
			p, err = opts.DevUser(c.Request.Context())
		} else {
			scheme, token, ok := strings.Cut(header, " ")
			token = strings.TrimSpace(token)
			if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
				deny(c)
				return
			}
			p, err = v.AuthenticateAccessToken(c.Request.Context(), token)
		}
		switch {
		case errors.Is(err, ErrNotAuthenticated):
			deny(c)
			return
		case errors.Is(err, ErrForbidden):
			abort(c, problem.Forbidden("forbidden", "This action is not allowed for the current user."))
			return
		case err != nil:
			_ = c.Error(err)
			c.Abort()
			return
		}
		if p.Role != RoleAdmin && p.Role != RoleTeacher {
			abort(c, problem.Forbidden("forbidden", "This action is not allowed for the current user."))
			return
		}
		c.Request = c.Request.WithContext(WithPrincipal(c.Request.Context(), p))
		c.Next()
	}
}

func invalidAccessToken() *problem.Problem {
	return problem.Unauthorized("invalid-access-token", "The access token is missing, unknown, expired or revoked.")
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
