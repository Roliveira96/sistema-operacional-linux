package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

func (f *fakeAuthoring) CreateEnvironment(_ context.Context, who service.Actor, _ uuid.UUID, snapshot json.RawMessage) (uuid.UUID, error) {
	f.who, f.created = who, snapshot
	return f.envID, f.err
}

func (f *fakeAuthoring) Environment(context.Context, uuid.UUID) (json.RawMessage, error) {
	return json.RawMessage(`{"formato":"exame-so/maquina"}`), f.err
}

// Covers SPEC-020 5.1 and 5.2.
func TestAuthorHandler_Environments(t *testing.T) {
	f := &fakeAuthoring{envID: uuid.New()}
	path := "/teacher/modules/" + uuid.NewString() + "/environments"

	code, body := authorCall(t, f, teacher, 100, http.MethodPost, path, `{"snapshot":{"formato":"exame-so/maquina"}}`)
	assert.Equal(t, http.StatusCreated, code)
	assert.Equal(t, f.envID.String(), body["scenarioId"])
	assert.JSONEq(t, `{"formato":"exame-so/maquina"}`, string(f.created))

	code, _ = authorCall(t, f, teacher, 100, http.MethodPost, path, `{}`)
	assert.Equal(t, http.StatusBadRequest, code)
	code, _ = authorCall(t, f, teacher, 100, http.MethodPost, path, `{"snapshot":null}`)
	assert.Equal(t, http.StatusBadRequest, code)

	// A machine is bigger than a block: 1 MB is fine here, but not much more than 2 MB.
	big := `{"snapshot":"` + strings.Repeat("a", 1500000) + `"}`
	code, _ = authorCall(t, f, teacher, 100, http.MethodPost, path, big)
	assert.Equal(t, http.StatusCreated, code)
	huge := `{"snapshot":"` + strings.Repeat("a", 2300000) + `"}`
	code, _ = authorCall(t, f, teacher, 100, http.MethodPost, path, huge)
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)

	code, body = authorCall(t, f, teacher, 100, http.MethodGet, "/teacher/environments/"+f.envID.String(), "")
	assert.Equal(t, http.StatusOK, code)
	assert.NotNil(t, body["snapshot"])
	code, _ = authorCall(t, f, teacher, 100, http.MethodGet, "/teacher/environments/not-a-uuid", "")
	assert.Equal(t, http.StatusNotFound, code)
}

func TestAuthorHandler_EnvironmentErrors(t *testing.T) {
	path := "/teacher/modules/" + uuid.NewString() + "/environments"
	cases := map[string]struct {
		err    error
		status int
	}{
		"invalid":   {service.ErrInvalidSnapshot, 400},
		"too large": {service.ErrSnapshotTooLarge, 413},
		"forbidden": {service.ErrForbidden, 403},
		"module":    {service.ErrModuleNotFound, 404},
	}
	for name, tc := range cases {
		code, _ := authorCall(t, &fakeAuthoring{err: tc.err}, teacher, 100, http.MethodPost, path, `{"snapshot":{"a":1}}`)
		assert.Equal(t, tc.status, code, name)
	}
	code, body := authorCall(t, &fakeAuthoring{err: service.ErrEnvironmentNotFound}, teacher, 100, http.MethodGet, "/teacher/environments/"+uuid.NewString(), "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Contains(t, body["type"], "scenario-not-found")
}
