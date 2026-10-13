package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/mcptest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

type env struct {
	f      *mcptest.Fake
	g      *mcptest.Grading
	srv    *httptest.Server
	logs   *observer.ObservedLogs
	people map[string]authn.Principal
}

func init() { gin.SetMode(gin.TestMode) }

// start runs the real handler on a Gin router. The authentication middleware is a stand-in for the one the
// composition root injects: the token names who is calling.
func start(t *testing.T, withAuth bool) *env {
	t.Helper()
	f := mcptest.New()
	core, logs := observer.New(zap.InfoLevel)
	log := zap.New(core)
	e := &env{f: f, logs: logs, people: map[string]authn.Principal{
		"teacher": {UserID: uuid.New(), Role: authn.RoleTeacher},
		"other":   {UserID: uuid.New(), Role: authn.RoleTeacher},
		"admin":   {UserID: uuid.New(), Role: authn.RoleAdmin},
		"student": {UserID: uuid.New(), Role: authn.RoleStudent},
	}}
	authenticate := func(c *gin.Context) {
		if !withAuth {
			return
		}
		p, ok := e.people[strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")]
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"type": "invalid-access-token"})
			return
		}
		c.Request = c.Request.WithContext(authn.WithPrincipal(c.Request.Context(), p))
	}
	e.g = mcptest.NewGrading(f)
	svc := service.New(f, f, mcptest.Exercises{F: f}, mcptest.Versions{F: f}, f, log).WithGrading(e.g)
	r := gin.New()
	handler.New(svc, authenticate, log).Register(r)
	e.srv = httptest.NewServer(r)
	t.Cleanup(e.srv.Close)
	return e
}

type bearer struct{ token string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

func (e *env) connect(t *testing.T, who string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint: e.srv.URL + handler.Path, HTTPClient: &http.Client{Transport: bearer{who}}, DisableStandaloneSSE: true,
	}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

func call(t *testing.T, cs *mcp.ClientSession, tool string, args any) (map[string]any, bool) {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: tool, Arguments: args})
	require.NoError(t, err, "a tool failure is a tool result, not a protocol error")
	require.NotEmpty(t, res.Content)
	text, ok := res.Content[0].(*mcp.TextContent)
	require.True(t, ok)
	var fromText map[string]any
	require.NoError(t, json.Unmarshal([]byte(text.Text), &fromText))
	structured, ok := res.StructuredContent.(map[string]any)
	require.True(t, ok, "structured content is an object")
	assert.Equal(t, fromText, structured)
	return structured, res.IsError
}

func mustOK(t *testing.T, cs *mcp.ClientSession, tool string, args any) map[string]any {
	t.Helper()
	out, isErr := call(t, cs, tool, args)
	require.False(t, isErr, "%s failed: %v", tool, out)
	return out
}

func mustFail(t *testing.T, cs *mcp.ClientSession, tool string, args any, errType string) map[string]any {
	t.Helper()
	out, isErr := call(t, cs, tool, args)
	require.True(t, isErr, "%s should fail", tool)
	require.Equal(t, errType, out["type"])
	assert.NotEmpty(t, out["title"])
	assert.NotEmpty(t, out["detail"])
	return out
}

type obj = map[string]any

func TestListsExactlyTheToolsOfTheSpec(t *testing.T) { // CA-01, CA-12, CA-20
	e := start(t, true)
	cs := e.connect(t, "teacher")
	got := map[string]*mcp.Tool{}
	for tool, err := range cs.Tools(context.Background(), nil) {
		require.NoError(t, err)
		got[tool.Name] = tool
	}
	want := []string{"list_modules", "get_module", "create_module", "update_module_metadata", "archive_module", "append_content_blocks",
		"update_content_block", "replace_content_blocks", "set_module_setup", "create_module_exercise", "update_module_exercise",
		"set_exercise_setup", "validate_module", "list_module_versions", "list_pending_answers", "get_answer", "suggest_grade"}
	assert.Len(t, got, len(want))
	for _, name := range want {
		require.Contains(t, got, name)
	}
	for name := range got {
		lower := strings.ToLower(name)
		assert.NotContains(t, lower, "publish")
		assert.NotContains(t, lower, "restore")
		assert.NotContains(t, lower, "test_result")
	}
	assert.Equal(t, want, domain.Names())

	// RN-12: the descriptions list the accepted values.
	for _, enum := range []string{"TEXT", "COMMAND", "TIP", "CURIOSITY", "STEP_BY_STEP", "CARDS", "WIDGET"} {
		assert.Contains(t, got["append_content_blocks"].Description, enum)
		assert.Contains(t, got["replace_content_blocks"].Description, enum)
	}
	for _, enum := range []string{"PRACTICAL", "THEORETICAL_SINGLE", "THEORETICAL_MULTIPLE", "THEORETICAL_BOOLEAN", "DISCURSIVE", "EXERCISE", "ASSESSMENT", "EASY", "MEDIUM", "HARD"} {
		assert.Contains(t, got["create_module_exercise"].Description, enum)
	}
	for _, enum := range []string{"PUBLIC", "AUTHENTICATED", "PRIVATE", "ACTIVE", "INACTIVE", "ARCHIVED"} {
		assert.Contains(t, got["update_module_metadata"].Description, enum)
	}
	assert.Contains(t, got["validate_module"].Description, "web app")
	assert.Contains(t, got["validate_module"].Description, "exercise bank test")
	assert.Contains(t, got["list_module_versions"].Description, "Read only")
	assert.True(t, domain.IsWrite("create_module"))
	assert.False(t, domain.IsWrite("get_module"))
	assert.False(t, domain.IsWrite("nope"))
}

// CA-03: a STUDENT is refused with 403 before any tool runs. CA-02 belongs to the injected middleware.
func TestRolesThatMayNotUseTheServerAreRefused(t *testing.T) {
	e := start(t, true)
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_module","arguments":{"title":"x","description":"d","visibility":"PUBLIC"}}}`
	post := func(token string) (*http.Response, string) {
		req, _ := http.NewRequest(http.MethodPost, e.srv.URL+handler.Path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		var sb strings.Builder
		buf := make([]byte, 4096)
		for {
			n, err := resp.Body.Read(buf)
			sb.Write(buf[:n])
			if err != nil {
				break
			}
		}
		return resp, sb.String()
	}

	resp, payload := post("student")
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	assert.Equal(t, "application/problem+json", resp.Header.Get("Content-Type"))
	var p map[string]any
	require.NoError(t, json.Unmarshal([]byte(payload), &p))
	assert.Equal(t, "forbidden", p["type"])
	assert.Equal(t, float64(403), p["status"])
	assert.False(t, e.f.Called("CreateModule"), "no tool ran")

	resp, _ = post("nobody")
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)

	// A client of the SDK cannot even connect as a student.
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	_, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: e.srv.URL + handler.Path, HTTPClient: &http.Client{Transport: bearer{"student"}}, DisableStandaloneSSE: true}, nil)
	assert.Error(t, err)

	// Without a principal in the context (the middleware was not wired) nothing runs either.
	bare := start(t, false)
	resp, payload = func() (*http.Response, string) {
		req, _ := http.NewRequest(http.MethodPost, bare.srv.URL+handler.Path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		var m map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&m)
		b, _ := json.Marshal(m)
		return resp, string(b)
	}()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	assert.Contains(t, payload, "invalid-access-token")
}

// The whole authoring flow, tool by tool, as a teacher does it (CA-08, CA-09, CA-14).
func TestAuthoringFlowThroughEveryTool(t *testing.T) {
	e := start(t, true)
	cs := e.connect(t, "teacher")

	created := mustOK(t, cs, "create_module", obj{"title": "Permissions", "description": "<p>chmod</p>", "visibility": "PUBLIC", "slug": "permissions"})
	id := created["id"].(string)
	assert.Equal(t, "ACTIVE", created["status"])

	list := mustOK(t, cs, "list_modules", obj{"search": "Perm"})
	assert.Len(t, list["items"], 1)

	mustOK(t, cs, "update_module_metadata", obj{"moduleId": id, "title": "Permissions 101", "status": "INACTIVE", "slug": nil})
	appended := mustOK(t, cs, "append_content_blocks", obj{"moduleId": id, "blocks": []obj{
		{"type": "TIP", "payload": obj{"html": "<p>use chmod</p>"}},
		{"type": "COMMAND", "payload": obj{"steps": []obj{{"command": "ls -l"}}}},
	}})
	blocks := appended["blocks"].([]any)
	require.Len(t, blocks, 2)
	firstBlock := blocks[0].(map[string]any)

	upd := mustOK(t, cs, "update_content_block", obj{"moduleId": id, "blockId": firstBlock["id"], "operation": "UPDATE", "payload": obj{"html": "<p>use chmod wisely</p>"}})
	assert.Contains(t, upd["block"].(map[string]any)["payload"].(map[string]any)["html"], "wisely")
	off := mustOK(t, cs, "update_content_block", obj{"moduleId": id, "blockId": firstBlock["id"], "operation": "DEACTIVATE"})
	assert.Equal(t, false, off["block"].(map[string]any)["active"])

	replaced := mustOK(t, cs, "replace_content_blocks", obj{"moduleId": id, "blocks": []obj{{"type": "STEP_BY_STEP", "payload": obj{"steps": []string{"one", "two"}}}}})
	assert.Len(t, replaced["blocks"], 1)

	setup := mustOK(t, cs, "set_module_setup", obj{"moduleId": id, "setup": obj{"steps": []obj{{"command": "mkdir /lab"}}}})
	assert.Contains(t, jsonOf(setup["setup"]), "mkdir /lab")

	ex := mustOK(t, cs, "create_module_exercise", obj{"moduleId": id, "title": "Make dir", "difficulty": "EASY",
		"conditions": []obj{{"kind": "DIR_EXISTS", "path": "/lab/d"}}, "links": obj{"practice": true}})
	exID := ex["exercise"].(map[string]any)["id"].(string)
	assert.Equal(t, "DRAFT", ex["exercise"].(map[string]any)["status"])
	ex2 := mustOK(t, cs, "create_module_exercise", obj{"moduleId": id, "title": "Make file", "difficulty": "HARD", "dependsOn": exID,
		"conditions": []obj{{"kind": "FILE_EXISTS", "path": "/lab/d/f"}}, "links": obj{"practice": true}})
	ex2ID := ex2["exercise"].(map[string]any)["id"].(string)

	mustOK(t, cs, "update_module_exercise", obj{"moduleId": id, "exerciseId": exID, "operation": "UPDATE", "title": "Make the dir"})
	mustOK(t, cs, "update_module_exercise", obj{"moduleId": id, "exerciseId": exID, "operation": "SET_LINKS", "links": obj{"practice": true, "assessment": true}})
	reordered := mustOK(t, cs, "update_module_exercise", obj{"moduleId": id, "operation": "REORDER", "order": []obj{{"exerciseId": ex2ID}, {"exerciseId": exID, "mandatory": true}}})
	assert.Equal(t, true, reordered["reordered"])
	mustOK(t, cs, "set_exercise_setup", obj{"moduleId": id, "exerciseId": ex2ID, "solution": obj{"steps": []obj{{"command": "touch /lab/d/f"}}}})
	mustOK(t, cs, "set_exercise_setup", obj{"moduleId": id, "bankSetup": obj{"steps": []obj{{"command": "mkdir /shared"}}}})
	deleted := mustOK(t, cs, "update_module_exercise", obj{"moduleId": id, "exerciseId": ex2ID, "operation": "DELETE"})
	assert.Equal(t, true, deleted["deleted"])

	mid, _ := uuid.Parse(id)
	e.f.Versions_[mid] = nil
	got := mustOK(t, cs, "get_module", obj{"moduleId": id})
	assert.Equal(t, "Permissions 101", got["module"].(map[string]any)["title"])
	assert.Len(t, got["blocks"], 1)
	assert.Len(t, got["exercises"], 1)
	assert.NotNil(t, got["setup"])
	assert.NotNil(t, got["bankSetup"])

	valid := mustOK(t, cs, "validate_module", obj{"moduleId": id})
	assert.Equal(t, true, valid["valid"], "%v", valid["problems"])
	assert.Contains(t, valid["next"], "publish")

	e.f.Versions_[mid] = nil
	e.f.Changed[mid] = true
	versions := mustOK(t, cs, "list_module_versions", obj{"moduleId": id})
	assert.Equal(t, true, versions["hasUnpublishedChanges"])

	archived := mustOK(t, cs, "archive_module", obj{"moduleId": id})
	assert.Equal(t, "ARCHIVED", archived["status"])

	// The MCP never published anything: no version exists and the services have no way to publish.
	assert.Empty(t, e.f.Versions_[mid])
}

// RN-06, CA-10: the error is a tool result with field, value received and value expected, and writes nothing.
func TestInvalidBlockReturnsAStructuredErrorAndWritesNothing(t *testing.T) {
	e := start(t, true)
	cs := e.connect(t, "teacher")
	id := e.f.AddModule(e.people["teacher"].UserID, "m").String()
	out := mustFail(t, cs, "append_content_blocks", obj{"moduleId": id, "blocks": []obj{
		{"type": "TIP", "payload": obj{"html": "<p>ok</p>"}},
		{"type": "COMMAND", "payload": obj{"steps": []obj{{"command": ""}}}},
	}}, "validation-error")
	assert.Equal(t, float64(400), out["status"])
	fields := out["fields"].([]any)
	require.Len(t, fields, 1)
	assert.Equal(t, obj{"field": "blocks[1].payload.steps[0].command", "received": `""`, "expected": "required"}, fields[0])
	mid, _ := uuid.Parse(id)
	assert.Empty(t, e.f.Blocks[mid])
}

func TestArgumentErrorsAreStructured(t *testing.T) {
	e := start(t, true)
	cs := e.connect(t, "teacher")
	id := e.f.AddModule(e.people["teacher"].UserID, "m").String()

	out := mustFail(t, cs, "get_module", obj{"moduleId": id, "colour": "red"}, "validation-error")
	assert.Equal(t, "colour", out["fields"].([]any)[0].(map[string]any)["field"])
	out = mustFail(t, cs, "get_module", obj{"moduleId": 12}, "validation-error")
	f := out["fields"].([]any)[0].(map[string]any)
	assert.Equal(t, "moduleId", f["field"])
	assert.Equal(t, "string", f["expected"])
	mustFail(t, cs, "get_module", []string{"x"}, "validation-error")
	mustFail(t, cs, "get_module", obj{}, "validation-error")
	mustFail(t, cs, "list_modules", obj{"page": "one"}, "validation-error")
}

// CA-04 and CA-05.
func TestOwnershipThroughTheTools(t *testing.T) {
	e := start(t, true)
	id := e.f.AddModule(e.people["teacher"].UserID, "mine").String()
	other, admin := e.connect(t, "other"), e.connect(t, "admin")

	for tool, args := range map[string]obj{
		"get_module":             {"moduleId": id},
		"update_module_metadata": {"moduleId": id, "title": "x"},
		"archive_module":         {"moduleId": id},
		"append_content_blocks":  {"moduleId": id, "blocks": []obj{{"type": "TIP", "payload": obj{"html": "<p>x</p>"}}}},
		"replace_content_blocks": {"moduleId": id, "blocks": []obj{}},
		"set_module_setup":       {"moduleId": id, "setup": obj{"steps": []obj{}}},
		"create_module_exercise": {"moduleId": id, "title": "x", "difficulty": "EASY"},
		"set_exercise_setup":     {"moduleId": id, "bankSetup": nil},
		"validate_module":        {"moduleId": id},
		"list_module_versions":   {"moduleId": id},
	} {
		out := mustFail(t, other, tool, args, "module-not-found")
		assert.Equal(t, float64(404), out["status"], tool)
	}
	assert.Equal(t, "mine", mustOK(t, admin, "get_module", obj{"moduleId": id})["module"].(map[string]any)["title"])
	assert.Len(t, mustOK(t, admin, "list_modules", obj{})["items"], 1)
	assert.Empty(t, mustOK(t, other, "list_modules", obj{})["items"])
}

// RN-11, CA-15: user, tool and module are logged, never the content or the token.
func TestWritesAreLogged(t *testing.T) {
	e := start(t, true)
	cs := e.connect(t, "teacher")
	id := e.f.AddModule(e.people["teacher"].UserID, "m").String()
	secret := "the-secret-lesson"
	mustOK(t, cs, "append_content_blocks", obj{"moduleId": id, "blocks": []obj{{"type": "TIP", "payload": obj{"html": "<p>" + secret + "</p>"}}}})
	entries := e.logs.FilterMessage("mcp write").All()
	require.Len(t, entries, 1)
	m := entries[0].ContextMap()
	assert.Equal(t, e.people["teacher"].UserID.String(), m["userId"])
	assert.Equal(t, "append_content_blocks", m["tool"])
	assert.Equal(t, id, m["moduleId"])
	for _, entry := range e.logs.All() {
		assert.NotContains(t, entry.Message+jsonOf(entry.ContextMap()), secret)
		assert.NotContains(t, jsonOf(entry.ContextMap()), "teacher\"")
	}
}

// An unexpected failure is one internal-error result, logged once at the border with its cause.
func TestUnexpectedFailureIsLoggedOnce(t *testing.T) {
	e := start(t, true)
	cs := e.connect(t, "teacher")
	id := e.f.AddModule(e.people["teacher"].UserID, "m").String()
	e.f.Fail["Authoring.List"] = errors.New("database is down")
	out := mustFail(t, cs, "get_module", obj{"moduleId": id}, "internal-error")
	assert.NotContains(t, jsonOf(out), "database is down")
	errs := e.logs.FilterLevelExact(zap.ErrorLevel).All()
	require.Len(t, errs, 1)
	assert.Equal(t, "get_module", errs[0].ContextMap()["tool"])
	assert.Contains(t, jsonOf(errs[0].ContextMap()), "database is down")
}

func TestRateLimitedWriteIsAToolError(t *testing.T) {
	e := start(t, true)
	cs := e.connect(t, "teacher")
	id := e.f.AddModule(e.people["teacher"].UserID, "m").String()
	e.f.Deny = true
	mustFail(t, cs, "archive_module", obj{"moduleId": id}, "rate-limited")
	mustOK(t, cs, "get_module", obj{"moduleId": id})
}

func TestToolsServeDescriptionOfThePublishRule(t *testing.T) {
	e := start(t, true)
	cs := e.connect(t, "teacher")
	res := cs.InitializeResult()
	assert.Contains(t, res.Instructions, "cannot publish")
	assert.Equal(t, "linux-lab-modules", res.ServerInfo.Name)
}

func jsonOf(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// SPEC-039 RN-04: the agent lists, reads and suggests the grade of a descriptive answer through the server, without the name of the
// student; another teacher does not see it.
func TestCorrectionThroughTheTools(t *testing.T) {
	e := start(t, true)
	mid := e.f.AddModule(e.people["teacher"].UserID, "m")
	answer := e.g.AddAnswer(mid, "Permissions", "<p>rwx</p>", "Ana Souza").String()
	teacher, other := e.connect(t, "teacher"), e.connect(t, "other")

	list := mustOK(t, teacher, "list_pending_answers", obj{"moduleId": mid.String()})
	require.Len(t, list["items"], 1)
	assert.Equal(t, answer, list["items"].([]any)[0].(map[string]any)["answerId"])

	got := mustOK(t, teacher, "get_answer", obj{"answerId": answer})
	assert.Equal(t, "<p>rwx</p>", got["studentAnswer"].(map[string]any)["html"])
	assert.NotContains(t, jsonOf(got), "Ana")

	mustFail(t, teacher, "suggest_grade", obj{"answerId": answer, "score": 60, "reason": "x"}, "validation-error")
	out := mustOK(t, teacher, "suggest_grade", obj{"answerId": answer, "score": 75, "reason": "misses the others", "studentNote": "Look at the others."})
	assert.Equal(t, "SUGGESTED", out["status"])
	assert.Nil(t, e.g.Answers[uuid.MustParse(answer)].Grade.Score, "a suggestion is never a grade")

	mustFail(t, other, "get_answer", obj{"answerId": answer}, "answer-not-found")
	mustFail(t, other, "suggest_grade", obj{"answerId": answer, "score": 100, "reason": "x"}, "answer-not-found")
	mustFail(t, other, "list_pending_answers", obj{"moduleId": mid.String()}, "module-not-found")
}
