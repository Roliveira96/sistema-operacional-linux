package authn

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type validatorFunc func(ctx context.Context, token string) (Principal, error)

func (f validatorFunc) Authenticate(ctx context.Context, token string) (Principal, error) {
	return f(ctx, token)
}

type routes func(r gin.IRouter)

func (f routes) Register(r gin.IRouter) { f(r) }

func engine(v Validator) *gin.Engine {
	gin.SetMode(gin.TestMode)
	return server.NewEngine(zap.NewNop(), nil, routes(func(r gin.IRouter) {
		g := r.Group("", Required(v))
		g.GET("/open", func(c *gin.Context) { c.Status(http.StatusNoContent) })
		g.GET("/protected", PasswordChanged(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
		g.GET("/teachers", PasswordChanged(), Roles(RoleTeacher, RoleAdmin), func(c *gin.Context) {
			p, _ := FromContext(c.Request.Context())
			c.String(http.StatusOK, p.Role)
		})
	}))
}

func call(e *gin.Engine, path string, withCookie bool) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1"+path, nil)
	if withCookie {
		req.AddCookie(&http.Cookie{Name: CookieName, Value: "token"})
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec, body
}

func TestRequiredRejectsMissingCookie(t *testing.T) {
	rec, body := call(engine(validatorFunc(func(context.Context, string) (Principal, error) {
		t.Fatal("validator must not be called")
		return Principal{}, nil
	})), "/open", false)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, "not-authenticated", body["type"])
}

// Covers SPEC-003 CA-07 and CA-08 at the HTTP level.
func TestRequiredReportsExpiredSessions(t *testing.T) {
	e := engine(validatorFunc(func(context.Context, string) (Principal, error) {
		return Principal{}, &SessionExpiredError{Reason: ReasonIdle}
	}))
	rec, body := call(e, "/open", true)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, "session-expired", body["type"])
	assert.Equal(t, ReasonIdle, body["reason"])
}

func TestRequiredMapsErrors(t *testing.T) {
	rec, body := call(engine(validatorFunc(func(context.Context, string) (Principal, error) {
		return Principal{}, ErrNotAuthenticated
	})), "/open", true)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, "not-authenticated", body["type"])

	rec, _ = call(engine(validatorFunc(func(context.Context, string) (Principal, error) {
		return Principal{}, errors.New("database down")
	})), "/open", true)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

// Covers SPEC-003 CA-06.
func TestPasswordChangeRequiredBlocksOtherRoutes(t *testing.T) {
	e := engine(validatorFunc(func(context.Context, string) (Principal, error) {
		return Principal{Role: RoleAdmin, MustChangePassword: true}, nil
	}))
	rec, _ := call(e, "/open", true)
	assert.Equal(t, http.StatusNoContent, rec.Code, "routes without the guard stay reachable")

	rec, body := call(e, "/protected", true)
	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Equal(t, "password-change-required", body["type"])
}

func TestRoles(t *testing.T) {
	student := engine(validatorFunc(func(context.Context, string) (Principal, error) {
		return Principal{Role: RoleStudent}, nil
	}))
	rec, body := call(student, "/teachers", true)
	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Equal(t, "forbidden", body["type"])

	teacher := engine(validatorFunc(func(context.Context, string) (Principal, error) {
		return Principal{Role: RoleTeacher}, nil
	}))
	rec, _ = call(teacher, "/teachers", true)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, RoleTeacher, rec.Body.String())
}

func TestSessionExpiredErrorMessage(t *testing.T) {
	assert.Equal(t, "session expired: ABSOLUTE", (&SessionExpiredError{Reason: ReasonAbsolute}).Error())
	_, ok := FromContext(context.Background())
	assert.False(t, ok)
}
