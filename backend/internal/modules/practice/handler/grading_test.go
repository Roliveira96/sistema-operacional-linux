package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeGrading struct {
	err    error
	who    contentservice.Actor
	status string
	input  domain.GradeInput
	row    service.AnswerRow
}

func (f *fakeGrading) List(_ context.Context, who contentservice.Actor, _ uuid.UUID, status string) ([]service.AnswerRow, error) {
	f.who, f.status = who, status
	return []service.AnswerRow{f.row}, f.err
}

func (f *fakeGrading) Get(_ context.Context, who contentservice.Actor, _ uuid.UUID) (service.AnswerRow, error) {
	f.who = who
	return f.row, f.err
}

func (f *fakeGrading) Confirm(_ context.Context, who contentservice.Actor, _ uuid.UUID, in domain.GradeInput) (service.AnswerRow, error) {
	f.who, f.input = who, in
	return f.row, f.err
}

type teacherValidator struct{ role string }

func (v teacherValidator) Authenticate(context.Context, string) (authn.Principal, error) {
	return authn.Principal{UserID: uuid.New(), Role: v.role}, nil
}

func gradingCall(t *testing.T, f *fakeGrading, role, method, path, body string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, NewGrading(f, teacherValidator{role: role}))
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func gradedRow() service.AnswerRow {
	at := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	suggested, score, reason, note, private, source := 75, 100, "partial", "Almost.", "kind", domain.SourceTeacher
	return service.AnswerRow{
		Progress: domain.Progress{ID: uuid.New(), Response: json.RawMessage(`{"html":"<p>rwx</p>"}`), CompletedAt: &at}, ModuleID: uuid.New(),
		QuestionID: uuid.New(), QuestionTitle: "chmod", Statement: "<p>Explain.</p>", ExpectedAnswer: "<p>rwx r-x ---</p>", StudentName: "Bia",
		Grade: domain.AnswerGrade{ID: uuid.New(), SuggestedScore: &suggested, SuggestionReason: &reason, SuggestedStudentNote: &note, SuggestedAt: &at,
			Score: &score, Source: &source, StudentNote: &note, PrivateNote: &private, GradedAt: &at},
	}
}

// Covers SPEC-039 5 (correction routes), CA-05 and CA-06 at the HTTP level.
func TestGradingRoutes(t *testing.T) {
	f := &fakeGrading{row: gradedRow()}
	code, body := gradingCall(t, f, "TEACHER", http.MethodGet, "/teacher/modules/"+uuid.NewString()+"/answers?status=GRADED", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "GRADED", f.status)
	items := body["items"].([]any)
	require.Len(t, items, 1)
	first := items[0].(map[string]any)
	assert.Equal(t, "Bia", first["studentName"])
	assert.Equal(t, "GRADED", first["status"])
	assert.Equal(t, "<p>rwx</p>", first["response"])
	assert.Equal(t, map[string]any{"score": float64(75), "reason": "partial", "studentNote": "Almost.", "at": "2026-10-12T12:00:00Z"}, first["suggestion"])
	grade := first["grade"].(map[string]any)
	assert.Equal(t, float64(100), grade["score"])
	assert.Equal(t, "kind", grade["privateNote"])

	code, body = gradingCall(t, f, "TEACHER", http.MethodGet, "/teacher/answers/"+uuid.NewString(), "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "<p>rwx r-x ---</p>", body["expectedAnswer"])

	code, _ = gradingCall(t, f, "TEACHER", http.MethodPut, "/teacher/answers/"+uuid.NewString()+"/grade", `{"score":50,"studentNote":"ok","privateNote":"p","reason":"r"}`)
	require.Equal(t, http.StatusOK, code)
	require.NotNil(t, f.input.Score)
	assert.Equal(t, domain.GradeInput{Score: f.input.Score, StudentNote: "ok", PrivateNote: "p", Reason: "r"}, f.input)
	code, _ = gradingCall(t, f, "TEACHER", http.MethodPut, "/teacher/answers/"+uuid.NewString()+"/grade", `{"useSuggestion":true}`)
	require.Equal(t, http.StatusOK, code)
	assert.True(t, f.input.UseSuggestion)

	code, _ = gradingCall(t, f, "STUDENT", http.MethodGet, "/teacher/answers/"+uuid.NewString(), "")
	assert.Equal(t, http.StatusForbidden, code)

	pending := &fakeGrading{row: service.AnswerRow{Progress: domain.Progress{ID: uuid.New()}}}
	_, body = gradingCall(t, pending, "ADMIN", http.MethodGet, "/teacher/answers/"+uuid.NewString(), "")
	assert.Equal(t, "PENDING", body["status"])
	assert.NotContains(t, body, "suggestion")
	assert.NotContains(t, body, "grade")
}

// Covers SPEC-039 5 (errors) at the HTTP level.
func TestGradingErrors(t *testing.T) {
	cases := map[error]struct {
		code int
		typ  string
	}{
		service.ErrAnswerNotFound:        {http.StatusNotFound, "answer-not-found"},
		contentservice.ErrModuleNotFound: {http.StatusNotFound, "module-not-found"},
		contentservice.ErrForbidden:      {http.StatusForbidden, "forbidden"},
		domain.ErrInvalidScore:           {http.StatusBadRequest, "validation-error"},
		domain.ErrNoSuggestion:           {http.StatusBadRequest, "validation-error"},
		domain.ErrReasonRequired:         {http.StatusBadRequest, "validation-error"},
		service.ErrInvalidAnswerStatus:   {http.StatusBadRequest, "validation-error"},
		errors.New("db down"):            {http.StatusInternalServerError, ""},
	}
	for err, want := range cases {
		code, body := gradingCall(t, &fakeGrading{err: err}, "TEACHER", http.MethodPut, "/teacher/answers/"+uuid.NewString()+"/grade", `{"score":50}`)
		assert.Equal(t, want.code, code, err.Error())
		if want.typ != "" {
			assert.Equal(t, want.typ, body["type"], err.Error())
		}
	}
	code, _ := gradingCall(t, &fakeGrading{}, "TEACHER", http.MethodGet, "/teacher/answers/nope", "")
	assert.Equal(t, http.StatusNotFound, code)
	code, _ = gradingCall(t, &fakeGrading{}, "TEACHER", http.MethodGet, "/teacher/modules/nope/answers", "")
	assert.Equal(t, http.StatusNotFound, code)
	code, _ = gradingCall(t, &fakeGrading{}, "TEACHER", http.MethodPut, "/teacher/answers/"+uuid.NewString()+"/grade", `not json`)
	assert.Equal(t, http.StatusBadRequest, code)
}
