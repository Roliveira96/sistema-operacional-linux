package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeVersioning struct {
	err    error
	who    service.Actor
	note   string
	number int
}

func (f *fakeVersioning) List(_ context.Context, who service.Actor, _ uuid.UUID) ([]service.VersionSummary, bool, error) {
	f.who = who
	return []service.VersionSummary{{Number: 2, Note: "n", Current: true}, {Number: 1}}, true, f.err
}

func (f *fakeVersioning) Publish(_ context.Context, who service.Actor, _ uuid.UUID, note string) (domain.ModuleVersion, error) {
	f.who, f.note = who, note
	return domain.ModuleVersion{Number: 3, Note: note, CreatedAt: time.Now()}, f.err
}

func (f *fakeVersioning) Restore(_ context.Context, who service.Actor, _ uuid.UUID, number int) ([]domain.ContentBlock, json.RawMessage, error) {
	f.who, f.number = who, number
	return []domain.ContentBlock{{ID: uuid.New(), BlockType: domain.BlockTip, Position: 1, Payload: json.RawMessage(`{"html":"x"}`)}}, json.RawMessage(`{"steps":[]}`), f.err
}

func versionCall(t *testing.T, f *fakeVersioning, v validator, limit int, method, path, body string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, NewVersions(f, v, ratelimit.New(limit, time.Minute)))
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func versionsPath() string { return "/teacher/modules/" + uuid.NewString() + "/versions" }

// Covers SPEC-021 6: list, publish and restore.
func TestVersionHandler_ListPublishRestore(t *testing.T) {
	f := &fakeVersioning{}
	code, body := versionCall(t, f, teacher, 100, http.MethodGet, versionsPath(), "")
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, true, body["hasUnpublishedChanges"])
	assert.Len(t, body["versions"], 2)
	assert.Equal(t, "TEACHER", f.who.Role)

	code, body = versionCall(t, f, teacher, 100, http.MethodPost, versionsPath(), `{"note":"revisado"}`)
	assert.Equal(t, http.StatusCreated, code)
	assert.EqualValues(t, 3, body["number"])
	assert.Equal(t, "revisado", f.note)

	// The note is optional.
	code, _ = versionCall(t, f, teacher, 100, http.MethodPost, versionsPath(), "")
	assert.Equal(t, http.StatusCreated, code)
	assert.Empty(t, f.note)

	code, body = versionCall(t, f, teacher, 100, http.MethodPost, versionsPath()+"/2/restore", "")
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, 2, f.number)
	assert.Len(t, body["blocks"], 1)
	require.NotNil(t, body["setup"])

	code, body = versionCall(t, f, teacher, 100, http.MethodPost, versionsPath()+"/zero/restore", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Contains(t, body["type"], "version-not-found")
}

func TestVersionHandler_Errors(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		kind   string
	}{
		{"no changes", service.ErrNoChanges, 409, "no-changes"},
		{"version", service.ErrVersionNotFound, 404, "version-not-found"},
		{"note", service.ErrNoteTooLong, 400, "validation-error"},
		{"forbidden", service.ErrForbidden, 403, "forbidden"},
		{"module", service.ErrModuleNotFound, 404, "module-not-found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := versionCall(t, &fakeVersioning{err: tc.err}, teacher, 100, http.MethodPost, versionsPath(), `{}`)
			assert.Equal(t, tc.status, code)
			assert.Contains(t, body["type"], tc.kind)
		})
	}
}

func TestVersionHandler_NeedsASessionAndATeacher(t *testing.T) {
	student := validator{p: authn.Principal{UserID: uuid.New(), Role: "STUDENT"}}
	code, _ := versionCall(t, &fakeVersioning{}, student, 100, http.MethodPost, versionsPath(), `{}`)
	assert.Equal(t, http.StatusForbidden, code)

	// Publishing is limited like any change of content.
	f := &fakeVersioning{}
	e := server.NewEngine(zap.NewNop(), nil, NewVersions(f, teacher, ratelimit.New(1, time.Minute)))
	var codes []int
	for range 2 {
		req := httptest.NewRequest(http.MethodPost, "/api/v1"+versionsPath(), bytes.NewBufferString(`{}`))
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		codes = append(codes, rec.Code)
	}
	assert.Equal(t, []int{http.StatusCreated, http.StatusTooManyRequests}, codes)
}

// Covers SPEC-021 RN-06: the draft is read with ?draft=true.
func TestHandler_DraftQuery(t *testing.T) {
	r := &fakeReader{}
	e := server.NewEngine(zap.NewNop(), nil, New(r, teacher))
	for _, tc := range []struct {
		query string
		draft bool
	}{{"", false}, {"?draft=true", true}} {
		r.draft = false
		req := httptest.NewRequest(http.MethodGet, "/api/v1/modules/"+uuid.NewString()+"/blocks"+tc.query, nil)
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, tc.draft, r.draft, tc.query)
	}
}
