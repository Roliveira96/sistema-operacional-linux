package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

type fakeAuthoring struct {
	err      error
	who      service.Actor
	created  json.RawMessage
	after    *uuid.UUID
	expected time.Time
	force    bool
	order    []uuid.UUID
}

func (f *fakeAuthoring) block() domain.ContentBlock {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	return domain.ContentBlock{ID: uuid.New(), BlockType: domain.BlockTip, Position: 1, Payload: json.RawMessage(`{"html":"x"}`), EditedByTeacherAt: &now, UpdatedAt: now}
}

func (f *fakeAuthoring) List(_ context.Context, who service.Actor, _ uuid.UUID) ([]domain.ContentBlock, error) {
	f.who = who
	return []domain.ContentBlock{f.block()}, f.err
}

func (f *fakeAuthoring) Create(_ context.Context, who service.Actor, _ uuid.UUID, _ domain.BlockType, p json.RawMessage, after *uuid.UUID) (domain.ContentBlock, error) {
	f.who, f.created, f.after = who, p, after
	return f.block(), f.err
}

func (f *fakeAuthoring) Update(_ context.Context, who service.Actor, _ uuid.UUID, _ json.RawMessage, expected time.Time, force bool) (domain.ContentBlock, error) {
	f.who, f.expected, f.force = who, expected, force
	return f.block(), f.err
}

func (f *fakeAuthoring) Delete(_ context.Context, who service.Actor, _ uuid.UUID) error {
	f.who = who
	return f.err
}

func (f *fakeAuthoring) SetActive(_ context.Context, who service.Actor, _ uuid.UUID, active bool) (domain.ContentBlock, error) {
	f.who = who
	b := f.block()
	if !active {
		now := time.Now()
		b.InactiveAt = &now
	}
	return b, f.err
}

func (f *fakeAuthoring) Reorder(_ context.Context, _ service.Actor, _ uuid.UUID, ids []uuid.UUID) ([]domain.ContentBlock, error) {
	f.order = ids
	return []domain.ContentBlock{f.block()}, f.err
}

var teacher = validator{p: authn.Principal{UserID: uuid.New(), Role: "TEACHER"}}

func authorCall(t *testing.T, f *fakeAuthoring, v validator, limit int, method, path, body string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, NewAuthor(f, v, ratelimit.New(limit, time.Minute)))
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func modulePath() string { return "/teacher/modules/" + uuid.NewString() + "/blocks" }

func TestAuthorHandler_ListAndCreate(t *testing.T) {
	f := &fakeAuthoring{}
	code, body := authorCall(t, f, teacher, 100, http.MethodGet, modulePath(), "")
	assert.Equal(t, http.StatusOK, code)
	blocks := body["blocks"].([]any)
	require.Len(t, blocks, 1)
	first := blocks[0].(map[string]any)
	assert.Equal(t, true, first["edited"])
	assert.NotEmpty(t, first["updatedAt"])
	assert.Equal(t, teacher.p.UserID, f.who.UserID)

	after := uuid.New()
	code, body = authorCall(t, f, teacher, 100, http.MethodPost, modulePath(),
		`{"type":"TIP","payload":{"html":"<p>a</p>"},"afterBlockId":"`+after.String()+`"}`)
	assert.Equal(t, http.StatusCreated, code)
	assert.Equal(t, "TIP", body["type"])
	assert.Equal(t, after, *f.after)
	assert.JSONEq(t, `{"html":"<p>a</p>"}`, string(f.created))
}

func TestAuthorHandler_UpdateRequiresExpectedInstantUnlessForced(t *testing.T) {
	f := &fakeAuthoring{}
	path := "/teacher/blocks/" + uuid.NewString()

	code, body := authorCall(t, f, teacher, 100, http.MethodPatch, path, `{"payload":{"html":"x"}}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, body["type"], "validation-error")

	code, _ = authorCall(t, f, teacher, 100, http.MethodPatch, path, `{"payload":{"html":"x"},"expectedUpdatedAt":"2026-10-09T12:00:00Z"}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC), f.expected)
	assert.False(t, f.force)

	code, _ = authorCall(t, f, teacher, 100, http.MethodPatch, path, `{"payload":{"html":"x"},"force":true}`)
	assert.Equal(t, http.StatusOK, code)
	assert.True(t, f.force)
}

func TestAuthorHandler_DeleteAndReorder(t *testing.T) {
	f := &fakeAuthoring{}
	code, _ := authorCall(t, f, teacher, 100, http.MethodDelete, "/teacher/blocks/"+uuid.NewString(), "")
	assert.Equal(t, http.StatusNoContent, code)

	id := uuid.New()
	code, _ = authorCall(t, f, teacher, 100, http.MethodPut, modulePath()+"/order", `{"blockIds":["`+id.String()+`"]}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, []uuid.UUID{id}, f.order)

	code, _ = authorCall(t, f, teacher, 100, http.MethodDelete, "/teacher/blocks/not-a-uuid", "")
	assert.Equal(t, http.StatusNotFound, code)
}

// Covers SPEC-019 5.6: the error table of the authoring routes.
func TestAuthorHandler_Errors(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		kind   string
	}{
		{"invalid payload", &domain.PayloadError{Fields: []domain.FieldError{{Field: "html", Reason: "required"}}}, 400, "validation-error"},
		{"invalid order", service.ErrInvalidOrder, 400, "validation-error"},
		{"forbidden", service.ErrForbidden, 403, "forbidden"},
		{"module", service.ErrModuleNotFound, 404, "module-not-found"},
		{"block", service.ErrBlockNotFound, 404, "block-not-found"},
		{"conflict", service.ErrBlockConflict, 409, "block-conflict"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := authorCall(t, &fakeAuthoring{err: tc.err}, teacher, 100, http.MethodPost, modulePath(), `{"type":"TIP","payload":{}}`)
			assert.Equal(t, tc.status, code)
			assert.Contains(t, body["type"], tc.kind)
		})
	}

	_, body := authorCall(t, &fakeAuthoring{err: &domain.PayloadError{Fields: []domain.FieldError{{Field: "html", Reason: "required"}}}},
		teacher, 100, http.MethodPost, modulePath(), `{"type":"TIP","payload":{}}`)
	assert.Contains(t, body["invalidParams"].([]any)[0].(map[string]any)["name"], "html")
}

func TestAuthorHandler_AccessAndLimits(t *testing.T) {
	f := &fakeAuthoring{}
	code, _ := authorCall(t, f, anonymous, 100, http.MethodGet, modulePath(), "")
	assert.Equal(t, http.StatusUnauthorized, code)

	student := validator{p: authn.Principal{UserID: uuid.New(), Role: "STUDENT"}}
	code, _ = authorCall(t, f, student, 100, http.MethodGet, modulePath(), "")
	assert.Equal(t, http.StatusForbidden, code)

	code, _ = authorCall(t, f, teacher, 100, http.MethodPost, modulePath(), `not json`)
	assert.Equal(t, http.StatusBadRequest, code)

	big := `{"type":"LEGACY_HTML","payload":{"html":"` + strings.Repeat("a", maxAuthoringBody) + `"}}`
	code, _ = authorCall(t, f, teacher, 100, http.MethodPost, modulePath(), big)
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)

	// 120 changes a minute per user: the limiter is shared by the write routes.
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, NewAuthor(f, teacher, ratelimit.New(1, time.Minute)))
	do := func() int {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/teacher/blocks/"+uuid.NewString(), nil)
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec.Code
	}
	assert.Equal(t, http.StatusNoContent, do())
	assert.Equal(t, http.StatusTooManyRequests, do())
}

// Covers SPEC-019 5.4a.
func TestAuthorHandler_SetActive(t *testing.T) {
	f := &fakeAuthoring{}
	path := "/teacher/blocks/" + uuid.NewString() + "/active"

	code, body := authorCall(t, f, teacher, 100, http.MethodPut, path, `{"active":false}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, false, body["active"])

	code, body = authorCall(t, f, teacher, 100, http.MethodPut, path, `{"active":true}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, true, body["active"])

	code, _ = authorCall(t, f, teacher, 100, http.MethodPut, path, `{}`)
	assert.Equal(t, http.StatusBadRequest, code, "the situation is required")

	code, _ = authorCall(t, &fakeAuthoring{err: service.ErrForbidden}, teacher, 100, http.MethodPut, path, `{"active":false}`)
	assert.Equal(t, http.StatusForbidden, code)
}
