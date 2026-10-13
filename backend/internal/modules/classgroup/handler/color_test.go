package handler_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// Covers SPEC-042 RN-12 and section 5: create and update carry the color, and an unknown color is a problem on the field.
func TestClassRoutes_Color(t *testing.T) {
	srv, svc, _ := setupServer(authn.RoleTeacher)
	defer srv.Close()
	body := map[string]any{
		"name": "SO", "courseCode": "SO34E", "semester": "2026/2", "color": "teal",
		"startDate": "2026-08-01T03:00:00Z", "endDate": "2026-12-01T02:59:59Z",
	}
	res := doRequest(t, srv, http.MethodPost, "/api/v1/classes", body, true)
	require.Equal(t, http.StatusCreated, res.StatusCode)
	created := readJSON(t, res)
	require.NotNil(t, svc.createInput)
	assert.Equal(t, "teal", svc.createInput.Color)
	assert.Contains(t, created, "color")

	svc.createErr = domain.ErrInvalidColor
	res = doRequest(t, srv, http.MethodPost, "/api/v1/classes", body, true)
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
	problem := readJSON(t, res)
	assert.Equal(t, "invalid-color", problem["type"])
	assert.Equal(t, "color", problem["field"])
}
