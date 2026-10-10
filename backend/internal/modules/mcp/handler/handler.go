// Package handler is the transport of the MCP server (SPEC-024): the Streamable HTTP endpoint at /mcp, the
// refusal of roles that may not use it, and the translation of tool calls and results to the protocol.
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// Path is where the server is mounted. It is outside /api/v1 because it is not REST.
const Path = "/mcp"

// serverInstructions are shown to the agent when it connects.
const serverInstructions = "Tools to author teaching modules of the Linux lab. Everything is written to the draft of the module. " +
	"Students see changes only after the teacher runs the module test and the exercise bank test and publishes the version in the web app; this server cannot publish."

// Handler serves the MCP endpoint.
type Handler struct {
	authenticate gin.HandlerFunc
	log          *zap.Logger
	mcp          http.Handler
}

// New creates the handler. authenticate is the middleware that resolves the personal access token of the
// Authorization header into an authn.Principal in the request context (it aborts with 401 otherwise); it
// is injected by the composition root.
func New(svc *service.Service, authenticate gin.HandlerFunc, log *zap.Logger) *Handler {
	h := &Handler{authenticate: authenticate, log: log.Named("mcp")}
	server := mcp.NewServer(&mcp.Implementation{Name: "linux-lab-modules", Version: "1.0.0"}, &mcp.ServerOptions{Instructions: serverInstructions})
	h.addTools(server, svc)
	stream := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	h.mcp = auth.RequireBearerToken(verifyPrincipal, &auth.RequireBearerTokenOptions{AllowMissingExpiration: true})(stream)
	return h
}

// Register mounts the endpoint on the router (the root, not /api/v1).
func (h *Handler) Register(r gin.IRouter) {
	r.Any(Path, h.authenticate, h.serve)
}

// serve refuses everyone but ADMIN and TEACHER before any tool runs (RN-03, CA-03).
func (h *Handler) serve(c *gin.Context) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		refuse(c, problem.Unauthorized(domain.TypeInvalidAccessToken, "The access token is not valid."))
		return
	}
	if !domain.CanUse(p.Role) {
		refuse(c, problem.Forbidden(domain.TypeForbidden, "This server is only for administrators and teachers."))
		return
	}
	h.mcp.ServeHTTP(c.Writer, c.Request)
}

func refuse(c *gin.Context, p *problem.Problem) {
	body, _ := json.Marshal(p)
	c.Data(p.Status, problem.ContentType, body)
	c.Abort()
}

// verifyPrincipal hands the principal the authentication put in the request to the SDK, which carries it
// to the tool handlers of that same request.
func verifyPrincipal(_ context.Context, _ string, req *http.Request) (*auth.TokenInfo, error) {
	p, ok := authn.FromContext(req.Context())
	if !ok {
		return nil, auth.ErrInvalidToken
	}
	return &auth.TokenInfo{UserID: p.UserID.String(), Extra: map[string]any{"role": p.Role}}, nil
}

// callerOf reads who is calling from the request of the tool call.
func callerOf(req *mcp.CallToolRequest) (service.Caller, bool) {
	if req.Extra == nil || req.Extra.TokenInfo == nil {
		return service.Caller{}, false
	}
	id, err := uuid.Parse(req.Extra.TokenInfo.UserID)
	role, _ := req.Extra.TokenInfo.Extra["role"].(string)
	if err != nil || !domain.CanUse(role) {
		return service.Caller{}, false
	}
	return service.Caller{UserID: id, Role: role}, true
}

// addTools registers every tool of the catalog with the service method that runs it.
func (h *Handler) addTools(s *mcp.Server, svc *service.Service) {
	handlers := map[string]mcp.ToolHandler{
		domain.ToolListModules:          bind(h, domain.ToolListModules, svc.ListModules),
		domain.ToolGetModule:            bind(h, domain.ToolGetModule, svc.GetModule),
		domain.ToolCreateModule:         bind(h, domain.ToolCreateModule, svc.CreateModule),
		domain.ToolUpdateModuleMetadata: bind(h, domain.ToolUpdateModuleMetadata, svc.UpdateModuleMetadata),
		domain.ToolArchiveModule:        bind(h, domain.ToolArchiveModule, svc.ArchiveModule),
		domain.ToolAppendContentBlocks:  bind(h, domain.ToolAppendContentBlocks, svc.AppendContentBlocks),
		domain.ToolUpdateContentBlock:   bind(h, domain.ToolUpdateContentBlock, svc.UpdateContentBlock),
		domain.ToolReplaceContentBlocks: bind(h, domain.ToolReplaceContentBlocks, svc.ReplaceContentBlocks),
		domain.ToolSetModuleSetup:       bind(h, domain.ToolSetModuleSetup, svc.SetModuleSetup),
		domain.ToolCreateModuleExercise: bind(h, domain.ToolCreateModuleExercise, svc.CreateModuleExercise),
		domain.ToolUpdateModuleExercise: bind(h, domain.ToolUpdateModuleExercise, svc.UpdateModuleExercise),
		domain.ToolSetExerciseSetup:     bind(h, domain.ToolSetExerciseSetup, svc.SetExerciseSetup),
		domain.ToolValidateModule:       bind(h, domain.ToolValidateModule, svc.ValidateModule),
		domain.ToolListModuleVersions:   bind(h, domain.ToolListModuleVersions, svc.ListModuleVersions),
	}
	for _, spec := range domain.Catalog() {
		fn, ok := handlers[spec.Name]
		if !ok {
			panic("mcp: no handler for tool " + spec.Name)
		}
		s.AddTool(&mcp.Tool{Name: spec.Name, Description: spec.Description, InputSchema: spec.InputSchema}, fn)
	}
}

// bind adapts a service method to a tool handler: it decodes the arguments, runs the method and shapes the
// result. A refusal is a tool result with the error flag (RN-06), never a protocol error.
func bind[In, Out any](h *Handler, tool string, fn func(context.Context, service.Caller, In) (Out, *domain.ToolError)) mcp.ToolHandler {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		caller, ok := callerOf(req)
		if !ok {
			return errorResult(domain.NewToolError(http.StatusForbidden, domain.TypeForbidden, "This server is only for administrators and teachers.")), nil
		}
		var in In
		if terr := decodeArguments(req.Params.Arguments, &in); terr != nil {
			return errorResult(terr), nil
		}
		out, terr := fn(ctx, caller, in)
		if terr != nil {
			if terr.Cause != nil {
				h.log.Error("mcp tool failed", zap.String("tool", tool), zap.String("userId", caller.UserID.String()), zap.Error(terr.Cause))
			}
			return errorResult(terr), nil
		}
		return okResult(out), nil
	}
}

// decodeArguments reads the arguments strictly: an unknown field or a wrong type is a validation error
// that names the field, what was received and what is expected.
func decodeArguments(raw json.RawMessage, into any) *domain.ToolError {
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	err := dec.Decode(into)
	if err == nil {
		return nil
	}
	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.As(err, &typeErr):
		return domain.Validation("An argument has the wrong type.", domain.FieldProblem{Field: typeErr.Field, Received: "a JSON " + typeErr.Value, Expected: typeErr.Type.String()})
	case strings.HasPrefix(err.Error(), "json: unknown field "):
		name := strings.Trim(strings.TrimPrefix(err.Error(), "json: unknown field "), `"`)
		return domain.Validation("An argument is not known to this tool.", domain.FieldProblem{Field: name, Received: "an argument", Expected: "one of the arguments in the input schema of the tool"})
	}
	return domain.Validation("The arguments must be a JSON object.", domain.FieldProblem{Field: "arguments", Received: "invalid JSON", Expected: "a JSON object"})
}

func okResult(out any) *mcp.CallToolResult {
	text, _ := json.Marshal(out)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(text)}}, StructuredContent: out}
}

func errorResult(terr *domain.ToolError) *mcp.CallToolResult {
	text, _ := json.Marshal(terr)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(text)}}, StructuredContent: terr, IsError: true}
}
