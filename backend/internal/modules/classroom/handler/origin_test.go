package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// Covers SPEC-051 section 5.8 (RN-05, entrada não confiável): a page of another site cannot open the channel; the frontend can, and
// so can any origin in local development.
func TestWebSocketOrigin(t *testing.T) {
	teacher := authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher}
	session := domain.LiveClassroomSession{Model: database.Model{ID: uuid.New()}, Status: domain.StatusActive}
	try := func(opts handler.Options, origin string) int {
		svc := &fakeService{session: session, active: service.Active{Found: true, Session: session}}
		h := handler.New(svc, validator{people: map[string]authn.Principal{"t": teacher}}, zap.NewNop(), opts)
		srv := httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h))
		defer srv.Close()
		hdr := http.Header{"Cookie": []string{authn.CookieName + "=t"}}
		if origin != "" {
			hdr.Set("Origin", origin)
		}
		ws, res, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/v1/classes/"+uuid.NewString()+"/live/ws", hdr)
		if err == nil {
			_ = ws.Close()
			return http.StatusSwitchingProtocols
		}
		return res.StatusCode
	}

	allowed := handler.Options{AllowedOrigins: []string{"http://192.168.3.104:3010"}}
	assert.Equal(t, http.StatusSwitchingProtocols, try(allowed, ""), "no origin: not a browser")
	assert.Equal(t, http.StatusSwitchingProtocols, try(allowed, "http://192.168.3.104:3010"))
	assert.Equal(t, http.StatusForbidden, try(allowed, "https://evil.example"))
	assert.Equal(t, http.StatusForbidden, try(allowed, "http://localhost:3010"), "another address of the same app is not the allowed one")
	assert.Equal(t, http.StatusSwitchingProtocols, try(handler.Options{AnyOrigin: true}, "http://localhost:3010"), "local development")
	assert.Equal(t, http.StatusForbidden, try(handler.Options{}, "https://evil.example"), "by default only the host the request went to")
}
