package handler_test

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/mcptest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// Covers SPEC-024 CA-27: a client that sends no Authorization header works when the authentication step
// vouched for a (local development) user.
func TestCallerWithoutAuthorizationHeaderIsServedWhenAuthenticated(t *testing.T) {
	f := mcptest.New()
	svc := service.New(f, f, mcptest.Exercises{F: f}, mcptest.Versions{F: f}, f, zap.NewNop())
	teacher := authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher}
	r := gin.New()
	handler.New(svc, func(c *gin.Context) {
		c.Request = c.Request.WithContext(authn.WithPrincipal(c.Request.Context(), teacher))
	}, zap.NewNop()).Register(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: srv.URL + handler.Path, DisableStandaloneSSE: true}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cs.Close() })

	out, isErr := call(t, cs, "list_modules", obj{})
	assert.False(t, isErr, "%v", out)
}
