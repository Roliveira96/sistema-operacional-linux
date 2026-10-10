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

type bearerFunc func(ctx context.Context, raw string) (Principal, error)

func (f bearerFunc) AuthenticateAccessToken(ctx context.Context, raw string) (Principal, error) {
	return f(ctx, raw)
}

func bearerEngine(v BearerValidator) *gin.Engine {
	gin.SetMode(gin.TestMode)
	return server.NewEngine(zap.NewNop(), nil, routes(func(r gin.IRouter) {
		r.GET("/mcp", RequiredBearer(v), func(c *gin.Context) {
			p, _ := FromContext(c.Request.Context())
			c.String(http.StatusOK, p.Role)
		})
	}))
}

func callBearer(e *gin.Engine, header string, cookie bool) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mcp", nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	if cookie {
		req.AddCookie(&http.Cookie{Name: CookieName, Value: "session-token"})
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec, body
}

// Covers SPEC-024 RN-08: cookie routes ignore the Authorization header.
func TestRequiredRefusesBearerHeaders(t *testing.T) {
	e := engine(validatorFunc(func(context.Context, string) (Principal, error) {
		t.Fatal("validator must not be called for a Bearer header")
		return Principal{}, nil
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/open", nil)
	req.Header.Set("Authorization", "Bearer some-access-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "not-authenticated")
}

// Covers SPEC-024 RN-02 and RN-03.
func TestRequiredBearer(t *testing.T) {
	var got string
	e := bearerEngine(bearerFunc(func(_ context.Context, raw string) (Principal, error) {
		got = raw
		return Principal{Role: RoleTeacher}, nil
	}))

	rec, _ := callBearer(e, "Bearer abc123", false)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, RoleTeacher, rec.Body.String())
	assert.Equal(t, "abc123", got)

	rec, _ = callBearer(e, "bearer abc123", false)
	assert.Equal(t, http.StatusOK, rec.Code, "scheme is case-insensitive")
}

func TestRequiredBearerRejectsBadHeaders(t *testing.T) {
	e := bearerEngine(bearerFunc(func(context.Context, string) (Principal, error) {
		t.Fatal("validator must not be called")
		return Principal{}, nil
	}))
	for _, h := range []string{"", "Bearer", "Bearer ", "Basic abc", "abc", "Token abc"} {
		rec, body := callBearer(e, h, false)
		assert.Equal(t, http.StatusUnauthorized, rec.Code, "header %q", h)
		assert.Equal(t, "invalid-access-token", body["type"], "header %q", h)
	}
	rec, body := callBearer(e, "", true)
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "a session cookie is not accepted")
	assert.Equal(t, "invalid-access-token", body["type"])
}

func TestRequiredBearerMapsErrors(t *testing.T) {
	cases := map[string]struct {
		err    error
		status int
		typ    string
	}{
		"invalid":   {ErrNotAuthenticated, http.StatusUnauthorized, "invalid-access-token"},
		"forbidden": {ErrForbidden, http.StatusForbidden, "forbidden"},
		"internal":  {errors.New("database down"), http.StatusInternalServerError, ""},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			e := bearerEngine(bearerFunc(func(context.Context, string) (Principal, error) { return Principal{}, tc.err }))
			rec, body := callBearer(e, "Bearer abc", false)
			assert.Equal(t, tc.status, rec.Code)
			if tc.typ != "" {
				assert.Equal(t, tc.typ, body["type"])
			}
		})
	}
}

func TestRequiredBearerRefusesStudents(t *testing.T) {
	e := bearerEngine(bearerFunc(func(context.Context, string) (Principal, error) { return Principal{Role: RoleStudent}, nil }))
	rec, body := callBearer(e, "Bearer abc", false)
	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Equal(t, "forbidden", body["type"])

	admin := bearerEngine(bearerFunc(func(context.Context, string) (Principal, error) { return Principal{Role: RoleAdmin}, nil }))
	rec, _ = callBearer(admin, "Bearer abc", false)
	assert.Equal(t, http.StatusOK, rec.Code)
}
