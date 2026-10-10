package handler_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

func setupMyClassesServer(principal authn.Principal, authErr error) (*httptest.Server, *fakeService) {
	svc := newFakeService()
	h := handler.New(svc, &fakeValidator{principal: principal, err: authErr}).WithNow(time.Now)
	return httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h)), svc
}

func getMyClasses(t *testing.T, srv *httptest.Server, withCookie bool) (*http.Response, []byte) {
	t.Helper()
	res := doRequest(t, srv, http.MethodGet, "/api/v1/me/classes", nil, withCookie)
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return res, body
}

func TestListMyClasses_Student(t *testing.T) {
	srv, svc := setupMyClassesServer(authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}, nil)
	defer srv.Close()
	pending := "PENDING_MODERATION"
	id := uuid.New()
	svc.myResult = repository.MyClassesResult{
		Items: []repository.MyClass{{
			ID: id, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
			Relation: "STUDENT", EnrollmentStatus: &pending,
		}},
		Total: 25,
	}

	res, body := getMyClasses(t, srv, true)
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, authn.RoleStudent, svc.myRole)

	var got struct {
		Items []map[string]any `json:"items"`
		Total int64            `json:"total"`
	}
	require.NoError(t, json.Unmarshal(body, &got))
	assert.Equal(t, int64(25), got.Total)
	require.Len(t, got.Items, 1)
	assert.Equal(t, map[string]any{
		"id": id.String(), "name": "SO", "courseCode": "SO34E", "semester": "2026/2",
		"relation": "STUDENT", "enrollmentStatus": "PENDING_MODERATION",
	}, got.Items[0])
}

// CA-17: nothing but the whitelisted fields is serialized (no members, no invite token).
func TestListMyClasses_TeacherPayloadHasNoMembersNorInviteToken(t *testing.T) {
	srv, svc := setupMyClassesServer(authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher}, nil)
	defer srv.Close()
	svc.myResult = repository.MyClassesResult{
		Items: []repository.MyClass{{ID: uuid.New(), Name: "SO", Relation: "TEACHER"}},
		Total: 1,
	}

	res, body := getMyClasses(t, srv, true)
	require.Equal(t, http.StatusOK, res.StatusCode)

	var got struct {
		Items []map[string]any `json:"items"`
	}
	require.NoError(t, json.Unmarshal(body, &got))
	require.Len(t, got.Items, 1)
	keys := make([]string, 0)
	for k := range got.Items[0] {
		keys = append(keys, k)
	}
	assert.ElementsMatch(t, []string{"id", "name", "courseCode", "semester", "relation"}, keys)
	assert.NotContains(t, string(body), "enrollmentStatus")
	for _, forbidden := range []string{"invite", "members", "teacherId", "userEmail"} {
		assert.False(t, strings.Contains(strings.ToLower(string(body)), strings.ToLower(forbidden)), forbidden)
	}
}

// CA-15: admin receives an empty list, encoded as [] (never null).
func TestListMyClasses_AdminEmpty(t *testing.T) {
	srv, _ := setupMyClassesServer(authn.Principal{UserID: uuid.New(), Role: authn.RoleAdmin}, nil)
	defer srv.Close()

	res, body := getMyClasses(t, srv, true)
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.JSONEq(t, `{"items":[],"total":0}`, string(body))
}

// CA-16: no session yields 401 not-authenticated.
func TestListMyClasses_Unauthenticated(t *testing.T) {
	srv, _ := setupMyClassesServer(authn.Principal{}, authn.ErrNotAuthenticated)
	defer srv.Close()

	res, body := getMyClasses(t, srv, false)
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
	assert.Contains(t, string(body), "not-authenticated")

	res, _ = getMyClasses(t, srv, true) // cookie present but validator rejects it
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}

func TestListMyClasses_PasswordChangeRequired(t *testing.T) {
	srv, _ := setupMyClassesServer(authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent, MustChangePassword: true}, nil)
	defer srv.Close()

	res, body := getMyClasses(t, srv, true)
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
	assert.Contains(t, string(body), "password-change-required")
}

func TestListMyClasses_InternalError(t *testing.T) {
	srv, svc := setupMyClassesServer(authn.Principal{UserID: uuid.New(), Role: authn.RoleTeacher}, nil)
	defer srv.Close()
	svc.myErr = errors.New("boom")

	res, _ := getMyClasses(t, srv, true)
	assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
}
