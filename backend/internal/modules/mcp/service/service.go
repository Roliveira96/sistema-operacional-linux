// Package service holds the tools of the MCP server for module authoring (SPEC-024). Every tool is a
// thin adapter over the services of the coursemodule and content modules: it shapes the input, calls the
// service, and shapes the result or the error. It has no business rule of its own (RN-04).
package service

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
)

// Caller is the user behind the call, as the authentication resolved it.
type Caller struct {
	UserID uuid.UUID
	Role   string
}

func (c Caller) actor() contentservice.Actor {
	return contentservice.Actor{UserID: c.UserID, Role: c.Role}
}

func (c Caller) access() cmservice.UserAccessContext {
	id := c.UserID
	return cmservice.UserAccessContext{
		UserID: &id, Role: c.Role,
		IsAdmin: c.Role == domain.RoleAdmin, IsTeacher: c.Role == domain.RoleTeacher,
	}
}

// Service runs the tools.
type Service struct {
	modules   Modules
	authoring Authoring
	exercises Exercises
	versions  Versions
	grading   Grading
	limiter   Limiter
	san       *contentdomain.HTMLSanitizer
	log       *zap.Logger
}

// New creates the service. The limiter may be nil (no rate limit).
func New(modules Modules, authoring Authoring, exercises Exercises, versions Versions, limiter Limiter, log *zap.Logger) *Service {
	return &Service{modules: modules, authoring: authoring, exercises: exercises, versions: versions, limiter: limiter, san: contentdomain.NewHTMLSanitizer(), log: log.Named("mcp")}
}

// begin opens a write: it parses the module id, applies the rate limit (RN-10) and returns the function
// that records the call in the log (RN-11). The log has the user, the tool and the module, never the
// content or the token.
func (s *Service) begin(c Caller, tool, rawModuleID string) (uuid.UUID, func(*domain.ToolError), *domain.ToolError) {
	id, terr := parseID("moduleId", rawModuleID)
	if terr != nil {
		return uuid.Nil, nil, terr
	}
	if terr := s.allow(c); terr != nil {
		return uuid.Nil, nil, terr
	}
	return id, func(terr *domain.ToolError) { s.audit(c, tool, id.String(), terr) }, nil
}

func rateLimited(retry time.Duration) *domain.ToolError {
	return domain.NewToolError(429, domain.TypeRateLimited, fmt.Sprintf("Too many changes. Try again in %d seconds.", int(math.Ceil(retry.Seconds()))))
}

func itoa(i int) string { return strconv.Itoa(i) }

func (s *Service) audit(c Caller, tool, moduleID string, terr *domain.ToolError) {
	s.log.Info("mcp write", zap.String("userId", c.UserID.String()), zap.String("tool", tool),
		zap.String("moduleId", moduleID), zap.Bool("ok", terr == nil))
}

func parseID(field, raw string) (uuid.UUID, *domain.ToolError) {
	id, err := uuid.Parse(raw)
	if err != nil {
		received := raw
		if raw == "" {
			received = missing
		}
		return uuid.Nil, domain.Validation("The "+field+" is not valid.", domain.FieldProblem{Field: field, Received: received, Expected: "a UUID"})
	}
	return id, nil
}

func parseTime(field, raw string) (time.Time, *domain.ToolError) {
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}, domain.NewToolError(400, "invalid-date-format", "The "+field+" is not a date.",
			domain.FieldProblem{Field: field, Received: raw, Expected: "an RFC 3339 date-time, like 2026-10-10T12:00:00Z"})
	}
	return t, nil
}

// rootOf is the JSON of an input, to read the values received when a field is refused.
func rootOf(in any) json.RawMessage {
	b, _ := json.Marshal(in)
	return b
}

// isNull tells an explicit JSON null from an absent field (empty).
func isNull(raw json.RawMessage) bool { return strings.TrimSpace(string(raw)) == "null" }

// BlockView is a block of the draft.
type BlockView struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"type"`
	Position  int             `json:"position"`
	Active    bool            `json:"active"`
	Payload   json.RawMessage `json:"payload"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func blockViews(blocks []contentdomain.ContentBlock) []BlockView {
	out := make([]BlockView, len(blocks))
	for i, b := range blocks {
		out[i] = blockView(b)
	}
	return out
}

func blockView(b contentdomain.ContentBlock) BlockView {
	return BlockView{ID: b.ID, Type: string(b.BlockType), Position: b.Position, Active: b.Active(), Payload: b.Payload, UpdatedAt: b.UpdatedAt}
}

// rawOrNull makes an empty JSON value show up as null.
func rawOrNull(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return raw
}

// rawOrEmptyList makes an empty or null JSON list show up as [].
func rawOrEmptyList(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || isNull(raw) {
		return json.RawMessage("[]")
	}
	return raw
}
