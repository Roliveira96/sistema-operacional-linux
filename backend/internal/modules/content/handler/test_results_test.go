package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// Covers SPEC-024 CA-17: the refusal is a 409 module-not-tested that says which test is missing.
func TestVersionHandler_PublishNotTested(t *testing.T) {
	f := &fakeVersioning{err: &service.MissingTestsError{Tests: []domain.TestKind{domain.TestModule, domain.TestExerciseBank}}}
	code, body := versionCall(t, f, teacher, 100, http.MethodPost, versionsPath(), `{}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, body["type"], "module-not-tested")
	assert.Equal(t, []any{"MODULE", "EXERCISE_BANK"}, body["missingTests"])
}

func testResultsPath() string { return "/teacher/modules/" + uuid.NewString() + "/test-results" }

// Covers SPEC-024 CA-19 (server side): the screen registers the result and gets the hash the server computed.
func TestVersionHandler_RecordTestResult(t *testing.T) {
	f := &fakeVersioning{}
	code, body := versionCall(t, f, teacher, 100, http.MethodPost, testResultsPath(), `{"kind":"EXERCISE_BANK","passed":true,"summary":{"cards":[]}}`)
	assert.Equal(t, http.StatusCreated, code)
	assert.Equal(t, "EXERCISE_BANK", body["kind"])
	assert.Equal(t, true, body["passed"])
	assert.Equal(t, "h", body["contentHash"])
	assert.NotEmpty(t, body["id"])
	assert.NotEmpty(t, body["createdAt"])
	assert.Equal(t, domain.TestExerciseBank, f.kind)
	assert.JSONEq(t, `{"cards":[]}`, f.sum)
	assert.Equal(t, "TEACHER", f.who.Role)

	// The summary is optional.
	code, _ = versionCall(t, f, teacher, 100, http.MethodPost, testResultsPath(), `{"kind":"MODULE","passed":false}`)
	assert.Equal(t, http.StatusCreated, code)
	assert.False(t, f.passed)
}

func TestVersionHandler_RecordTestResultErrors(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		body   string
		status int
		kind   string
	}{
		{"malformed", nil, `{`, 400, "validation-error"},
		{"missing passed", nil, `{"kind":"MODULE"}`, 400, "validation-error"},
		{"kind", service.ErrInvalidTestKind, `{"kind":"X","passed":true}`, 400, "validation-error"},
		{"summary", service.ErrInvalidSummary, `{"kind":"MODULE","passed":true,"summary":[1]}`, 400, "validation-error"},
		{"summary too large", service.ErrSummaryTooLarge, `{"kind":"MODULE","passed":true}`, 413, "payload-too-large"},
		{"forbidden", service.ErrForbidden, `{"kind":"MODULE","passed":true}`, 403, "forbidden"},
		{"module", service.ErrModuleNotFound, `{"kind":"MODULE","passed":true}`, 404, "module-not-found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := versionCall(t, &fakeVersioning{err: tc.err}, teacher, 100, http.MethodPost, testResultsPath(), tc.body)
			assert.Equal(t, tc.status, code)
			assert.Contains(t, body["type"], tc.kind)
		})
	}

	// A body over the limit of the authoring routes is a 413 too.
	big := `{"kind":"MODULE","passed":true,"summary":{"a":"` + strings.Repeat("a", maxAuthoringBody) + `"}}`
	code, body := versionCall(t, &fakeVersioning{}, teacher, 100, http.MethodPost, testResultsPath(), big)
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)
	assert.Contains(t, body["type"], "file-too-large", "the shared limit of the body keeps the problem type of the other authoring routes")
}

// Covers SPEC-024 CA-20: only a session of a teacher registers a result, and the route is limited like any change of content.
func TestVersionHandler_RecordTestResultNeedsASessionAndIsLimited(t *testing.T) {
	student := validator{p: authn.Principal{UserID: uuid.New(), Role: "STUDENT"}}
	code, _ := versionCall(t, &fakeVersioning{}, student, 100, http.MethodPost, testResultsPath(), `{"kind":"MODULE","passed":true}`)
	assert.Equal(t, http.StatusForbidden, code)

	// Without the session cookie (a Bearer token is not a session) the route answers 401.
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, NewVersions(&fakeVersioning{}, teacher, ratelimit.New(1, time.Minute)))
	req := httptest.NewRequest(http.MethodPost, "/api/v1"+testResultsPath(), bytes.NewBufferString(`{"kind":"MODULE","passed":true}`))
	req.Header.Set("Authorization", "Bearer pat_x")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)

	var codes []int
	for range 2 {
		req := httptest.NewRequest(http.MethodPost, "/api/v1"+testResultsPath(), bytes.NewBufferString(`{"kind":"MODULE","passed":true}`))
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		codes = append(codes, rec.Code)
	}
	assert.Equal(t, []int{http.StatusCreated, http.StatusTooManyRequests}, codes)
}
