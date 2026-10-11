package authn

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

func optionsEngine(v BearerValidator, opts BearerOptions) *gin.Engine {
	gin.SetMode(gin.TestMode)
	return server.NewEngine(zap.NewNop(), nil, routes(func(r gin.IRouter) {
		r.GET("/mcp", RequiredBearerWith(v, opts), func(c *gin.Context) {
			p, _ := FromContext(c.Request.Context())
			c.String(http.StatusOK, p.Role)
		})
	}))
}

func callOpts(e *gin.Engine, header string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mcp", nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// Covers SPEC-024 CA-22: the 401 tells the client where the OAuth metadata is.
func TestRequiredBearerAdvertisesTheResourceMetadata(t *testing.T) {
	denied := bearerFunc(func(context.Context, string) (Principal, error) { return Principal{}, ErrNotAuthenticated })
	e := optionsEngine(denied, BearerOptions{ResourceMetadataURL: "http://localhost:8080/.well-known/oauth-protected-resource"})

	for _, header := range []string{"", "Bearer wrong", "Basic abc"} {
		rec := callOpts(e, header)
		assert.Equal(t, http.StatusUnauthorized, rec.Code, "header %q", header)
		assert.Equal(t, `Bearer resource_metadata="http://localhost:8080/.well-known/oauth-protected-resource"`, rec.Header().Get("WWW-Authenticate"))
	}

	plain := callOpts(optionsEngine(denied, BearerOptions{}), "")
	assert.Equal(t, http.StatusUnauthorized, plain.Code)
	assert.Empty(t, plain.Header().Get("WWW-Authenticate"))
}

// Covers SPEC-024 CA-27: without a header the local user acts; a header always wins.
func TestRequiredBearerDevUser(t *testing.T) {
	bearer := bearerFunc(func(_ context.Context, raw string) (Principal, error) {
		if raw != "good" {
			return Principal{}, ErrNotAuthenticated
		}
		return Principal{UserID: uuid.New(), Role: RoleAdmin}, nil
	})
	dev := func(role string, err error) func(context.Context) (Principal, error) {
		return func(context.Context) (Principal, error) { return Principal{UserID: uuid.New(), Role: role}, err }
	}

	e := optionsEngine(bearer, BearerOptions{DevUser: dev(RoleTeacher, nil)})
	rec := callOpts(e, "")
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, RoleTeacher, rec.Body.String())

	rec = callOpts(e, "Bearer good")
	assert.Equal(t, RoleAdmin, rec.Body.String(), "a token is used as is, never replaced by the dev user")
	assert.Equal(t, http.StatusUnauthorized, callOpts(e, "Bearer bad").Code, "a wrong token does not fall back to the dev user")

	assert.Equal(t, http.StatusUnauthorized, callOpts(optionsEngine(bearer, BearerOptions{DevUser: dev("", ErrNotAuthenticated)}), "").Code)
	assert.Equal(t, http.StatusForbidden, callOpts(optionsEngine(bearer, BearerOptions{DevUser: dev("", ErrForbidden)}), "").Code)
	assert.Equal(t, http.StatusForbidden, callOpts(optionsEngine(bearer, BearerOptions{DevUser: dev(RoleStudent, nil)}), "").Code)
	assert.Equal(t, http.StatusUnauthorized, callOpts(optionsEngine(bearer, BearerOptions{}), "").Code, "no dev user: no header is refused")
}
