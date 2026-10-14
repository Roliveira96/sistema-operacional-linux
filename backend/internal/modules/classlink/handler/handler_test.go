package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeValidator struct{ principal authn.Principal }

func (f *fakeValidator) Authenticate(context.Context, string) (authn.Principal, error) {
	return f.principal, nil
}

// fakeService records the last call and returns err when set.
type fakeService struct {
	err     error
	actor   service.Actor
	classID uuid.UUID
	input   []domain.Input
	links   []domain.ClassLink
}

func (f *fakeService) List(_ context.Context, a service.Actor, classID uuid.UUID) ([]domain.ClassLink, error) {
	f.actor, f.classID = a, classID
	return f.links, f.err
}

func (f *fakeService) Replace(_ context.Context, a service.Actor, classID uuid.UUID, in []domain.Input) ([]domain.ClassLink, error) {
	f.actor, f.classID, f.input = a, classID, in
	if f.err != nil {
		return nil, f.err
	}
	return domain.BuildLinks(classID, in)
}

func setup(role string) (*httptest.Server, *fakeService, uuid.UUID) {
	userID := uuid.New()
	svc := &fakeService{}
	h := handler.New(svc, &fakeValidator{principal: authn.Principal{UserID: userID, Role: role}})
	return httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h)), svc, userID
}

func call(t *testing.T, srv *httptest.Server, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var raw []byte
	switch b := body.(type) {
	case nil:
	case string:
		raw = []byte(b)
	default:
		var err error
		raw, err = json.Marshal(b)
		require.NoError(t, err)
	}
	req, err := http.NewRequest(method, srv.URL+path, bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "session"})
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &out)
	}
	return res.StatusCode, out
}

type obj = map[string]any

// Covers SPEC-048 section 5 and CA-01: the list is saved and read in order.
func TestLinksRoutes(t *testing.T) {
	srv, svc, userID := setup(authn.RoleTeacher)
	defer srv.Close()
	class := uuid.New()
	path := "/api/v1/classes/" + class.String() + "/links"

	code, out := call(t, srv, http.MethodPut, path, obj{"links": []obj{
		{"name": "Link do Meet", "url": "https://meet.google.com/abc"},
		{"name": "Conteúdo", "url": "https://example.com/c"},
	}})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, authn.RoleTeacher, svc.actor.Role)
	assert.Equal(t, class, svc.classID)
	require.Len(t, svc.input, 2)
	links := out["links"].([]any)
	require.Len(t, links, 2)
	first := links[0].(map[string]any)
	assert.Equal(t, "Link do Meet", first["name"])
	assert.Equal(t, "https://meet.google.com/abc", first["url"])
	assert.EqualValues(t, 0, first["position"])
	assert.NotEmpty(t, first["id"])

	svc.links, _ = domain.BuildLinks(class, svc.input)
	code, out = call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["links"], 2)

	// CA-02: an empty list is valid and comes back as an empty list, not null.
	code, out = call(t, srv, http.MethodPut, path, obj{"links": []obj{}})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []any{}, out["links"])
	svc.links = nil
	_, out = call(t, srv, http.MethodGet, path, nil)
	assert.Equal(t, []any{}, out["links"])
}

// Covers SPEC-048 section 5: the body and the id are checked.
func TestLinksRoutesRejectBadRequests(t *testing.T) {
	srv, _, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	path := "/api/v1/classes/" + uuid.NewString() + "/links"

	code, out := call(t, srv, http.MethodGet, "/api/v1/classes/not-a-uuid/links", nil)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-uuid", out["type"])
	code, out = call(t, srv, http.MethodPut, "/api/v1/classes/not-a-uuid/links", obj{"links": []obj{}})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-uuid", out["type"])

	code, out = call(t, srv, http.MethodPut, path, "{not json")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "malformed-request", out["type"])
	code, out = call(t, srv, http.MethodPut, path, obj{})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "malformed-request", out["type"], "the links field is required")
}

// Covers SPEC-048 section 5, CA-03 to CA-07: the problems the service reports.
func TestLinksRoutesTranslateErrors(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	path := "/api/v1/classes/" + uuid.NewString() + "/links"
	body := obj{"links": []obj{{"name": "x", "url": "https://a.com"}}}

	svc.err = &domain.FieldError{Field: "links[2].url", Err: domain.ErrInvalidLink}
	code, out := call(t, srv, http.MethodPut, path, body)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "invalid-link", out["type"])
	assert.Equal(t, "links[2].url", out["field"])

	cases := []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrTooManyLinks, http.StatusBadRequest, "too-many-links"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrClassArchived, http.StatusConflict, "class-archived"},
		{errors.New("boom"), http.StatusInternalServerError, "internal-error"},
	}
	for _, tc := range cases {
		svc.err = tc.err
		code, out = call(t, srv, http.MethodPut, path, body)
		assert.Equal(t, tc.status, code, tc.typ)
		assert.Equal(t, tc.typ, out["type"])
		code, out = call(t, srv, http.MethodGet, path, nil)
		if tc.err != domain.ErrTooManyLinks && tc.err != domain.ErrClassArchived {
			assert.Equal(t, tc.status, code, tc.typ)
		}
	}
}

// Covers SPEC-048 RN-04: a student reads; the write is refused by the service with the same actor.
func TestStudentActor(t *testing.T) {
	srv, svc, userID := setup(authn.RoleStudent)
	defer srv.Close()
	path := "/api/v1/classes/" + uuid.NewString() + "/links"
	code, _ := call(t, srv, http.MethodGet, path, nil)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, authn.RoleStudent, svc.actor.Role)
	assert.Equal(t, userID, svc.actor.UserID)

	svc.err = domain.ErrForbidden
	code, out := call(t, srv, http.MethodPut, path, obj{"links": []obj{}})
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["type"])
}
