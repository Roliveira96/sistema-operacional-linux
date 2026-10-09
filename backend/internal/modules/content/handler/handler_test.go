package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeReader struct {
	err    error
	viewer service.Viewer
	usage  string
	setup  json.RawMessage
	draft  bool
}

func (f *fakeReader) Content(_ context.Context, _ uuid.UUID, v service.Viewer) (service.ModuleContent, error) {
	f.viewer = v
	blocks := []domain.ContentBlock{{ID: uuid.New(), BlockType: domain.BlockTip, Position: 1, Payload: json.RawMessage(`{"html":"x"}`)}}
	return service.ModuleContent{Blocks: blocks, Setup: f.setup}, f.err
}

func (f *fakeReader) Draft(_ context.Context, _ uuid.UUID, v service.Viewer) (service.ModuleContent, error) {
	f.viewer, f.draft = v, true
	return service.ModuleContent{Blocks: []domain.ContentBlock{{ID: uuid.New(), BlockType: domain.BlockTip, Position: 1, Payload: json.RawMessage(`{"html":"rascunho"}`)}}}, f.err
}

func (f *fakeReader) Questions(_ context.Context, _ uuid.UUID, usage string, v service.Viewer) ([]service.PublicQuestion, error) {
	f.viewer, f.usage = v, usage
	return []service.PublicQuestion{{Title: "Q"}}, f.err
}

func (f *fakeReader) TeacherQuestions(_ context.Context, _ uuid.UUID, v service.Viewer) ([]service.TeacherQuestion, error) {
	f.viewer = v
	return []service.TeacherQuestion{{Status: "DRAFT"}}, f.err
}

func (f *fakeReader) Templates(context.Context) ([]service.TemplateSummary, error) {
	return []service.TemplateSummary{{Title: "Quiz"}}, f.err
}

func (f *fakeReader) ToggleBlockProgress(_ context.Context, blockID uuid.UUID, completed bool, _ service.Viewer) (service.BlockProgressResult, error) {
	return service.BlockProgressResult{BlockID: blockID, Completed: completed}, f.err
}

func (f *fakeReader) ModuleBlockProgress(_ context.Context, moduleID uuid.UUID, _ service.Viewer) (service.ModuleBlockProgressResult, error) {
	return service.ModuleBlockProgressResult{ModuleID: moduleID, CompletedBlockIDs: []uuid.UUID{}}, f.err
}

type validator struct {
	p   authn.Principal
	err error
}

func (v validator) Authenticate(context.Context, string) (authn.Principal, error) { return v.p, v.err }

func call(t *testing.T, r *fakeReader, v validator, path string, cookie bool) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, New(r, v))
	req := httptest.NewRequest(http.MethodGet, "/api/v1"+path, nil)
	if cookie {
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return rec.Code, body
}

var anonymous = validator{err: authn.ErrNotAuthenticated}

// Covers SPEC-012 CA-02 at the HTTP level.
func TestBlocksForVisitorsAndUsers(t *testing.T) {
	r := &fakeReader{}
	code, body := call(t, r, anonymous, "/modules/"+uuid.NewString()+"/blocks", false)
	assert.Equal(t, http.StatusOK, code)
	assert.Len(t, body["blocks"], 1)
	assert.Nil(t, r.viewer.UserID)

	user := uuid.New()
	code, _ = call(t, r, validator{p: authn.Principal{UserID: user, Role: "STUDENT"}}, "/modules/"+uuid.NewString()+"/blocks", true)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, user, *r.viewer.UserID)

	code, _ = call(t, r, anonymous, "/modules/"+uuid.NewString()+"/blocks", true)
	assert.Equal(t, http.StatusOK, code, "an invalid cookie degrades to anonymous")
}

// Covers SPEC-012 CA-03.
func TestErrorsAreProblems(t *testing.T) {
	cases := map[error]struct {
		code int
		typ  string
	}{
		service.ErrModuleNotFound: {http.StatusNotFound, "module-not-found"},
		service.ErrAuthRequired:   {http.StatusUnauthorized, "not-authenticated"},
		service.ErrForbidden:      {http.StatusForbidden, "forbidden"},
		errors.New("db down"):     {http.StatusInternalServerError, "internal-error"},
	}
	for err, want := range cases {
		code, body := call(t, &fakeReader{err: err}, anonymous, "/modules/"+uuid.NewString()+"/questions", false)
		assert.Equal(t, want.code, code, err.Error())
		assert.Equal(t, want.typ, body["type"])
	}
	code, body := call(t, &fakeReader{}, anonymous, "/modules/not-a-uuid/blocks", false)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "module-not-found", body["type"])
}

func TestQuestionsUsageFilter(t *testing.T) {
	r := &fakeReader{}
	code, body := call(t, r, anonymous, "/modules/"+uuid.NewString()+"/questions?usage=EXERCISE", false)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "EXERCISE", r.usage)
	assert.Len(t, body["questions"], 1)

	code, body = call(t, r, anonymous, "/modules/"+uuid.NewString()+"/questions?usage=OTHER", false)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "validation-error", body["type"])
}

// Covers SPEC-012 CA-06 and CA-07 at the HTTP level.
func TestTeacherQuestionsAndTemplates(t *testing.T) {
	teacher := validator{p: authn.Principal{UserID: uuid.New(), Role: "TEACHER"}}
	code, body := call(t, &fakeReader{}, teacher, "/teacher/modules/"+uuid.NewString()+"/questions", true)
	assert.Equal(t, http.StatusOK, code)
	assert.Len(t, body["questions"], 1)

	code, _ = call(t, &fakeReader{}, validator{p: authn.Principal{UserID: uuid.New(), Role: "STUDENT"}}, "/teacher/modules/"+uuid.NewString()+"/questions", true)
	assert.Equal(t, http.StatusForbidden, code)
	code, _ = call(t, &fakeReader{}, anonymous, "/teacher/modules/"+uuid.NewString()+"/questions", false)
	assert.Equal(t, http.StatusUnauthorized, code)
	code, _ = call(t, &fakeReader{err: errors.New("x")}, teacher, "/teacher/modules/"+uuid.NewString()+"/questions", true)
	assert.Equal(t, http.StatusInternalServerError, code)

	code, body = call(t, &fakeReader{}, anonymous, "/assessment-templates", false)
	assert.Equal(t, http.StatusOK, code)
	assert.Len(t, body["items"], 1)
	code, _ = call(t, &fakeReader{err: errors.New("x")}, anonymous, "/assessment-templates", false)
	assert.Equal(t, http.StatusInternalServerError, code)
}

// Covers SPEC-021 5: the blocks of a module come with its snapshot, or null.
func TestBlocksCarryTheModuleSetup(t *testing.T) {
	_, body := call(t, &fakeReader{}, anonymous, "/modules/"+uuid.NewString()+"/blocks", false)
	assert.Contains(t, body, "setup")
	assert.Nil(t, body["setup"])

	_, body = call(t, &fakeReader{setup: json.RawMessage(`{"steps":[{"command":"mkdir /x"}]}`)}, anonymous, "/modules/"+uuid.NewString()+"/blocks", false)
	setup := body["setup"].(map[string]any)
	assert.Len(t, setup["steps"], 1)
}
