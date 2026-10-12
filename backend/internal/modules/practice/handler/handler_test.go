package handler

import (
	"context"
	"encoding/json"
	"errors"
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

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeService struct {
	err      error
	snapshot json.RawMessage
	response json.RawMessage
	passed   bool
	topic    json.RawMessage
}

func (f *fakeService) TopicScenario(context.Context, uuid.UUID, contentservice.Viewer) (json.RawMessage, error) {
	return f.topic, f.err
}

func (f *fakeService) CheckModule(_ context.Context, _ uuid.UUID, _ contentservice.Viewer, s json.RawMessage) (service.ModuleCheckResult, error) {
	f.snapshot = s
	now := time.Now()
	q := uuid.New()
	return service.ModuleCheckResult{Passed: []uuid.UUID{q}, Progress: []service.ProgressEntry{{Progress: domain.Progress{QuestionID: q, CompletedAt: &now}}}}, f.err
}

func (f *fakeService) Scenario(context.Context, uuid.UUID, contentservice.Viewer) (json.RawMessage, error) {
	return json.RawMessage(`{"formato":"exame-so/maquina"}`), f.err
}

// Submit behaves as a practical exercise unless a response comes, then as a true or false question answered right.
func (f *fakeService) Submit(_ context.Context, _ uuid.UUID, _ contentservice.Viewer, sub service.Submission) (service.CheckResult, error) {
	f.snapshot, f.response = sub.Snapshot, sub.Response
	if f.err != nil {
		return service.CheckResult{}, f.err
	}
	now := time.Now()
	if len(sub.Response) > 0 {
		why := "<p>Because.</p>"
		return service.CheckResult{Passed: f.passed, CompletedAt: &now, Correct: json.RawMessage("true"), Explanation: &why}, nil
	}
	if len(sub.Snapshot) == 0 || string(sub.Snapshot) == "null" {
		return service.CheckResult{}, service.ErrSnapshotRequired
	}
	return service.CheckResult{Passed: f.passed, CompletedAt: &now}, nil
}

func (f *fakeService) ModuleProgress(context.Context, uuid.UUID, contentservice.Viewer) ([]service.ProgressEntry, error) {
	passed := true
	why := "<p>Because.</p>"
	return []service.ProgressEntry{
		{Progress: domain.Progress{QuestionID: uuid.New(), Attempts: 2}},
		{Progress: domain.Progress{QuestionID: uuid.New(), Attempts: 1, LastPassed: passed, Response: json.RawMessage(`{"value":true}`)}, Correct: json.RawMessage("true"), Explanation: &why},
	}, f.err
}

type validator struct{ ok bool }

func (v validator) Authenticate(context.Context, string) (authn.Principal, error) {
	if !v.ok {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	return authn.Principal{UserID: uuid.New(), Role: "STUDENT"}, nil
}

func call(t *testing.T, svc *fakeService, auth bool, limit int, method, path, body string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, New(svc, validator{ok: auth}, ratelimit.New(limit, time.Minute), ratelimit.New(limit, time.Minute)))
	req := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	return rec.Code, out
}

var qPath = "/questions/" + uuid.NewString()

// Covers SPEC-014 CA-01 and CA-02 at the HTTP level.
func TestScenario(t *testing.T) {
	code, body := call(t, &fakeService{}, false, 30, http.MethodGet, qPath+"/scenario", "")
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "exame-so/maquina", body["snapshot"].(map[string]any)["formato"])

	code, body = call(t, &fakeService{err: contentservice.ErrQuestionNotFound}, false, 30, http.MethodGet, qPath+"/scenario", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "question-not-found", body["type"])

	code, _ = call(t, &fakeService{}, false, 30, http.MethodGet, "/questions/nope/scenario", "")
	assert.Equal(t, http.StatusNotFound, code)
}

// Covers SPEC-014 CA-03, CA-05 and CA-07 at the HTTP level.
func TestCheck(t *testing.T) {
	svc := &fakeService{passed: true}
	code, body := call(t, svc, true, 30, http.MethodPost, qPath+"/check", `{"snapshot":{"formato":"exame-so/maquina"}}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, true, body["passed"])
	assert.NotNil(t, body["completedAt"])
	assert.JSONEq(t, `{"formato":"exame-so/maquina"}`, string(svc.snapshot))

	code, _ = call(t, &fakeService{}, false, 30, http.MethodPost, qPath+"/check", `{"snapshot":{}}`)
	assert.Equal(t, http.StatusUnauthorized, code, "CA-07: visitors cannot check")

	for _, bad := range []string{`not json`, `{}`, `{"snapshot":null}`} {
		code, body = call(t, &fakeService{}, true, 30, http.MethodPost, qPath+"/check", bad)
		assert.Equal(t, http.StatusBadRequest, code, bad)
		assert.Equal(t, "validation-error", body["type"])
	}

	huge := `{"snapshot":"` + strings.Repeat("x", MaxSnapshotBytes) + `"}`
	code, body = call(t, &fakeService{}, true, 30, http.MethodPost, qPath+"/check", huge)
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)
	assert.Equal(t, "file-too-large", body["type"])

	cases := map[error]int{
		service.ErrInvalidSnapshot:       http.StatusBadRequest,
		contentservice.ErrForbidden:      http.StatusForbidden,
		contentservice.ErrAuthRequired:   http.StatusUnauthorized,
		contentservice.ErrModuleNotFound: http.StatusNotFound,
		errors.New("db down"):            http.StatusInternalServerError,
	}
	for err, want := range cases {
		code, _ = call(t, &fakeService{err: err}, true, 30, http.MethodPost, qPath+"/check", `{"snapshot":{}}`)
		assert.Equal(t, want, code, err.Error())
	}
}

func TestCheckRateLimitAndProgress(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// One limiter shared by two requests of the same user would need a stable
	// user ID; with a limit of 0 the first request is already refused.
	code, body := call(t, &fakeService{}, true, 0, http.MethodPost, qPath+"/check", `{"snapshot":{}}`)
	assert.Equal(t, http.StatusTooManyRequests, code)
	assert.Equal(t, "rate-limited", body["type"])

	code, body = call(t, &fakeService{}, true, 30, http.MethodGet, "/modules/"+uuid.NewString()+"/progress", "")
	assert.Equal(t, http.StatusOK, code)
	assert.Len(t, body["items"], 2)
	code, _ = call(t, &fakeService{err: errors.New("x")}, true, 30, http.MethodGet, "/modules/"+uuid.NewString()+"/progress", "")
	assert.Equal(t, http.StatusInternalServerError, code)
	code, _ = call(t, &fakeService{}, true, 30, http.MethodGet, "/modules/x/progress", "")
	assert.Equal(t, http.StatusNotFound, code)
	code, _ = call(t, &fakeService{}, false, 30, http.MethodGet, "/modules/"+uuid.NewString()+"/progress", "")
	assert.Equal(t, http.StatusUnauthorized, code)
}

var mPath = "/modules/" + uuid.NewString()

// Covers SPEC-016 5.1 and CA-09 at the HTTP level.
func TestTopicScenarioRoute(t *testing.T) {
	code, body := call(t, &fakeService{topic: json.RawMessage(`{"formato":"exame-so/maquina"}`)}, false, 30, http.MethodGet, mPath+"/scenario", "")
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "exame-so/maquina", body["snapshot"].(map[string]any)["formato"])

	code, body = call(t, &fakeService{}, false, 30, http.MethodGet, mPath+"/scenario", "")
	assert.Equal(t, http.StatusOK, code)
	assert.Nil(t, body["snapshot"], "the default machine is a null snapshot")

	for err, want := range map[error][2]any{
		contentservice.ErrModuleNotFound: {http.StatusNotFound, "module-not-found"},
		contentservice.ErrAuthRequired:   {http.StatusUnauthorized, "not-authenticated"},
		contentservice.ErrForbidden:      {http.StatusForbidden, "forbidden"},
	} {
		code, body = call(t, &fakeService{err: err}, false, 30, http.MethodGet, mPath+"/scenario", "")
		assert.Equal(t, want[0], code)
		assert.Equal(t, want[1], body["type"])
	}

	code, body = call(t, &fakeService{}, false, 30, http.MethodGet, "/modules/x/scenario", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "module-not-found", body["type"])
}

// Covers SPEC-016 5.2, CA-04, CA-05 and RN-02 at the HTTP level.
func TestCheckModuleRoute(t *testing.T) {
	svc := &fakeService{}
	code, body := call(t, svc, true, 120, http.MethodPost, mPath+"/check", `{"snapshot":{"formato":"exame-so/maquina"}}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Len(t, body["passed"], 1)
	assert.Len(t, body["progress"], 1)
	assert.JSONEq(t, `{"formato":"exame-so/maquina"}`, string(svc.snapshot))

	code, body = call(t, &fakeService{}, false, 120, http.MethodPost, mPath+"/check", `{"snapshot":{}}`)
	assert.Equal(t, http.StatusUnauthorized, code)
	assert.Equal(t, "not-authenticated", body["type"])

	code, body = call(t, &fakeService{}, true, 0, http.MethodPost, mPath+"/check", `{"snapshot":{}}`)
	assert.Equal(t, http.StatusTooManyRequests, code)
	assert.Equal(t, "rate-limited", body["type"])

	code, _ = call(t, &fakeService{}, true, 120, http.MethodPost, mPath+"/check", `{}`)
	assert.Equal(t, http.StatusBadRequest, code)

	code, _ = call(t, &fakeService{}, true, 120, http.MethodPost, mPath+"/check", `{"snapshot":"`+strings.Repeat("a", MaxSnapshotBytes)+`"}`)
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)

	code, body = call(t, &fakeService{err: contentservice.ErrModuleNotFound}, true, 120, http.MethodPost, mPath+"/check", `{"snapshot":{}}`)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "module-not-found", body["type"])

	code, _ = call(t, &fakeService{err: service.ErrInvalidSnapshot}, true, 120, http.MethodPost, mPath+"/check", `{"snapshot":{}}`)
	assert.Equal(t, http.StatusBadRequest, code)

	code, _ = call(t, &fakeService{}, true, 120, http.MethodPost, "/modules/x/check", `{"snapshot":{}}`)
	assert.Equal(t, http.StatusNotFound, code)
}

// Covers SPEC-035 CA-09, CA-15 and CA-17 at the HTTP level: the response of a true or false question, the answer key after it,
// the second answer refused and the response that is not a boolean.
func TestCheckTrueFalse(t *testing.T) {
	svc := &fakeService{passed: false}
	code, body := call(t, svc, true, 30, http.MethodPost, qPath+"/check", `{"response":{"value":false}}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, false, body["passed"])
	assert.Equal(t, true, body["correctAnswer"])
	assert.Equal(t, "<p>Because.</p>", body["explanation"])
	assert.JSONEq(t, `{"value":false}`, string(svc.response))

	code, _ = call(t, &fakeService{}, false, 30, http.MethodPost, qPath+"/check", `{"response":{"value":true}}`)
	assert.Equal(t, http.StatusUnauthorized, code, "CA-15")

	code, body = call(t, &fakeService{err: service.ErrAlreadyAnswered}, true, 30, http.MethodPost, qPath+"/check", `{"response":{"value":true}}`)
	assert.Equal(t, http.StatusConflict, code, "CA-17")
	assert.Equal(t, "already-answered", body["type"])

	for _, err := range []error{service.ErrResponseRequired, contentdomain.ErrInvalidResponse} {
		code, body = call(t, &fakeService{err: err}, true, 30, http.MethodPost, qPath+"/check", `{"response":{"value":"x"}}`)
		assert.Equal(t, http.StatusBadRequest, code, err.Error())
		assert.Equal(t, "validation-error", body["type"])
	}
}

// Covers SPEC-035 CA-10 at the HTTP level: the progress of an answered question brings the answer, its result and the answer key.
func TestProgressOfAnsweredQuestions(t *testing.T) {
	code, body := call(t, &fakeService{}, true, 30, http.MethodGet, "/modules/"+uuid.NewString()+"/progress", "")
	require.Equal(t, http.StatusOK, code)
	items := body["items"].([]any)
	require.Len(t, items, 2)
	practical, answered := items[0].(map[string]any), items[1].(map[string]any)
	assert.NotContains(t, practical, "response")
	assert.NotContains(t, practical, "correctAnswer")
	assert.Equal(t, map[string]any{"value": true}, answered["response"])
	assert.Equal(t, true, answered["passed"])
	assert.Equal(t, true, answered["correctAnswer"])
	assert.Equal(t, "<p>Because.</p>", answered["explanation"])
}
