package handler_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// Covers SPEC-050 section 5 and CA-01: the route answers 204.
func TestDeleteClassRoute(t *testing.T) {
	srv, svc, _ := setupServer(authn.RoleTeacher)
	defer srv.Close()
	id := uuid.New()
	res := doRequest(t, srv, http.MethodDelete, "/api/v1/classes/"+id.String(), nil, true)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
	assert.Equal(t, []uuid.UUID{id}, svc.deleted)
}

// Covers SPEC-050 CA-02, CA-03 and RN-04: the refusals of the service.
func TestDeleteClassRouteErrors(t *testing.T) {
	srv, svc, _ := setupServer(authn.RoleTeacher)
	defer srv.Close()
	path := "/api/v1/classes/" + uuid.NewString()

	when := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	svc.deleteErr = &domain.NotDeletableError{After: &when}
	body := decode(t, doRequest(t, srv, http.MethodDelete, path, nil, true))
	assert.Equal(t, "class-not-deletable", body["type"])
	assert.EqualValues(t, http.StatusConflict, body["status"])
	assert.Equal(t, "2026-10-14T12:00:00Z", body["deletableAfter"])

	svc.deleteErr = &domain.NotDeletableError{}
	body = decode(t, doRequest(t, srv, http.MethodDelete, path, nil, true))
	assert.Equal(t, "class-not-deletable", body["type"])
	assert.NotContains(t, body, "deletableAfter", "a class that is not archived has no date to wait for")

	cases := []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
	}
	for _, tc := range cases {
		svc.deleteErr = tc.err
		res := doRequest(t, srv, http.MethodDelete, path, nil, true)
		assert.Equal(t, tc.status, res.StatusCode)
		out := decode(t, res)
		assert.Equal(t, tc.typ, out["type"])
	}
}

// Covers SPEC-050 section 5: the id is checked and a student cannot delete.
func TestDeleteClassRouteChecksTheRequest(t *testing.T) {
	srv, _, _ := setupServer(authn.RoleTeacher)
	defer srv.Close()
	res := doRequest(t, srv, http.MethodDelete, "/api/v1/classes/not-a-uuid", nil, true)
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
	assert.Equal(t, "invalid-uuid", decode(t, res)["type"])

	student, _, _ := setupServer(authn.RoleStudent)
	defer student.Close()
	res = doRequest(t, student, http.MethodDelete, "/api/v1/classes/"+uuid.NewString(), nil, true)
	defer res.Body.Close()
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
}
