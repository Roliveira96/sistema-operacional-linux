package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// modulesService adds to the fake service the writing of the modules of a class (SPEC-078).
type modulesService struct {
	*fakeService
	err      error
	gotClass uuid.UUID
	gotIDs   []uuid.UUID
	gotAdmin bool
	gotUser  uuid.UUID
}

func (s *modulesService) SetClassModules(_ context.Context, callerID uuid.UUID, isAdmin bool, classID uuid.UUID, moduleIDs []uuid.UUID) ([]uuid.UUID, error) {
	s.gotUser, s.gotAdmin, s.gotClass, s.gotIDs = callerID, isAdmin, classID, moduleIDs
	if s.err != nil {
		return nil, s.err
	}
	return moduleIDs, nil
}

func setupClassModules(role string) (*httptest.Server, *modulesService, uuid.UUID) {
	userID := uuid.New()
	validator := &fakeValidator{principal: authn.Principal{UserID: userID, Role: role}}
	svc := &modulesService{fakeService: newFakeService()}
	engine := server.NewEngine(zap.NewNop(), nil, handler.New(svc, validator).WithNow(time.Now))
	return httptest.NewServer(engine), svc, userID
}

func put(t *testing.T, srv *httptest.Server, class string, body any, withCookie bool) *http.Response {
	t.Helper()
	return doRequest(t, srv, http.MethodPut, "/api/v1/classes/"+class+"/modules", body, withCookie)
}

// Covers SPEC-078 CA-12 (section 5): the list goes to the service with the class, the user and the role, and comes back as the set written.
func TestHandler_PutClassModulesAnswersTheSetWritten(t *testing.T) {
	srv, svc, teacher := setupClassModules(authn.RoleTeacher)
	defer srv.Close()
	class, m1, m2 := uuid.New(), uuid.New(), uuid.New()

	resp := put(t, srv, class.String(), map[string]any{"moduleIds": []string{m1.String(), m2.String()}}, true)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	var body struct {
		ModuleIDs []string `json:"moduleIds"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	assert.Equal(t, []string{m1.String(), m2.String()}, body.ModuleIDs)
	assert.Equal(t, class, svc.gotClass)
	assert.Equal(t, teacher, svc.gotUser)
	assert.False(t, svc.gotAdmin)

	resp = put(t, srv, class.String(), map[string]any{"moduleIds": []string{}}, true)
	assert.Equal(t, http.StatusOK, resp.StatusCode, "an empty list takes every module away")
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	assert.NotNil(t, body.ModuleIDs, "and the answer is a list, not null")
	assert.Empty(t, body.ModuleIDs)

	adminSrv, adminSvc, _ := setupClassModules(authn.RoleAdmin)
	defer adminSrv.Close()
	assert.Equal(t, http.StatusOK, put(t, adminSrv, class.String(), map[string]any{"moduleIds": []string{}}, true).StatusCode)
	assert.True(t, adminSvc.gotAdmin)
}

// Covers SPEC-078 CA-13, CA-15 (section 5): one case for each problem the route answers.
func TestHandler_PutClassModulesStatusCodesAndProblemTypes(t *testing.T) {
	srv, svc, _ := setupClassModules(authn.RoleTeacher)
	defer srv.Close()
	class := uuid.New().String()
	valid := map[string]any{"moduleIds": []string{uuid.New().String()}}

	stuck := uuid.New()
	for name, tc := range map[string]struct {
		err    error
		status int
		kind   string
	}{
		"repeated or unknown module": {domain.ErrInvalidModules, http.StatusBadRequest, "invalid-modules"},
		"module of another teacher":  {domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		"class that does not exist":  {domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		"private module left alone":  {&domain.ModuleNeedsClassError{ModuleID: stuck}, http.StatusConflict, "module-needs-a-class"},
	} {
		svc.err = tc.err
		resp := put(t, srv, class, valid, true)
		assert.Equal(t, tc.status, resp.StatusCode, name)
		body := problemBody(t, resp)
		assert.Contains(t, body["type"], tc.kind, name)
		if tc.kind == "module-needs-a-class" {
			assert.Equal(t, stuck.String(), body["moduleId"], "it says which module")
		}
	}
	svc.err = nil

	assert.Equal(t, http.StatusBadRequest, put(t, srv, class, map[string]any{}, true).StatusCode, "the list is required")
	assert.Equal(t, http.StatusBadRequest, put(t, srv, class, map[string]any{"moduleIds": []string{"not-a-uuid"}}, true).StatusCode, "an id that is not a uuid")
	resp := put(t, srv, "not-a-uuid", valid, true)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, problemBody(t, resp)["type"], "invalid-uuid")
}

// Covers SPEC-078 CA-13 (section 5): no session is 401 and a student is 403, whatever the body.
func TestHandler_PutClassModulesRolesAndAuthentication(t *testing.T) {
	srv, _, _ := setupClassModules(authn.RoleTeacher)
	defer srv.Close()
	class := uuid.New().String()
	body := map[string]any{"moduleIds": []string{}}

	assert.Equal(t, http.StatusUnauthorized, put(t, srv, class, body, false).StatusCode)

	student, _, _ := setupClassModules(authn.RoleStudent)
	defer student.Close()
	assert.Equal(t, http.StatusForbidden, put(t, student, class, body, true).StatusCode)
}
