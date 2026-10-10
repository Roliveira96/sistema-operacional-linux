package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

type fakeBank struct {
	err      error
	who      service.Actor
	in       domain.ExerciseInput
	expected time.Time
	force    bool
	usage    string
	status   string
	order    []service.OrderItem
	setups   [2]json.RawMessage
	record   service.ExerciseRecord
}

func newFakeBank() *fakeBank {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	q := domain.Question{ID: uuid.New(), Title: "Criar", Difficulty: "EASY", Usage: domain.UsageExercise, Status: domain.StatusPublished, UpdatedAt: now, CreatedAt: now,
		CreatedByName: "Ana", UpdatedByName: "Ana", Hints: json.RawMessage(`[{"text":"dica"}]`),
		EndConditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`), ReferenceSolution: json.RawMessage(`{"steps":[{"command":"mkdir /a"}]}`)}
	return &fakeBank{record: service.ExerciseRecord{Question: q, Position: 1, Mandatory: true}}
}

func (f *fakeBank) List(_ context.Context, who service.Actor, _ uuid.UUID) (service.ExerciseBank, error) {
	f.who = who
	legacy := service.ExerciseRecord{Question: domain.Question{ID: uuid.New(), Title: "Antigo", ReferenceSolution: json.RawMessage(`[{"command":"ls"}]`), Usage: domain.UsageExercise}}
	return service.ExerciseBank{Items: []service.ExerciseRecord{f.record, legacy}, ExercisesSetup: json.RawMessage(`{"steps":[]}`)}, f.err
}

func (f *fakeBank) Get(_ context.Context, who service.Actor, _, _ uuid.UUID) (service.ExerciseRecord, error) {
	f.who = who
	return f.record, f.err
}

func (f *fakeBank) Create(_ context.Context, who service.Actor, _ uuid.UUID, in domain.ExerciseInput) (service.ExerciseRecord, error) {
	f.who, f.in = who, in
	return f.record, f.err
}

func (f *fakeBank) Update(_ context.Context, who service.Actor, _, _ uuid.UUID, in domain.ExerciseInput, expected time.Time, force bool) (service.ExerciseRecord, error) {
	f.who, f.in, f.expected, f.force = who, in, expected, force
	return f.record, f.err
}

func (f *fakeBank) SetAvailability(_ context.Context, _ service.Actor, _, _ uuid.UUID, usage, status string) (service.ExerciseRecord, error) {
	f.usage, f.status = usage, status
	return f.record, f.err
}

func (f *fakeBank) Delete(context.Context, service.Actor, uuid.UUID, uuid.UUID) error { return f.err }

func (f *fakeBank) Reorder(_ context.Context, _ service.Actor, _ uuid.UUID, items []service.OrderItem) error {
	f.order = items
	return f.err
}

func (f *fakeBank) SetSetups(_ context.Context, _ service.Actor, _ uuid.UUID, exercises, assessment json.RawMessage) (json.RawMessage, json.RawMessage, error) {
	f.setups = [2]json.RawMessage{exercises, assessment}
	return exercises, assessment, f.err
}

func bankCall(t *testing.T, f *fakeBank, v validator, limit int, method, path, body string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, NewExercises(f, v, ratelimit.New(limit, time.Minute)))
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func exercisesPath(rest string) string { return "/teacher/modules/" + uuid.NewString() + "/exercises" + rest }

// Covers SPEC-023 CA-01, CA-09, P-05: the list tells the set, the place in the trail, the author, and what came from the initial load.
func TestExerciseHandler_List(t *testing.T) {
	f := newFakeBank()
	code, body := bankCall(t, f, teacher, 100, http.MethodGet, exercisesPath(""), "")
	require.Equal(t, http.StatusOK, code)
	items := body["items"].([]any)
	require.Len(t, items, 2)
	first := items[0].(map[string]any)
	assert.Equal(t, "EXERCISE", first["usage"])
	assert.EqualValues(t, 1, first["position"])
	assert.Equal(t, true, first["mandatory"])
	assert.Equal(t, "Ana", first["createdBy"])
	assert.Equal(t, false, first["legacy"])
	assert.NotNil(t, first["solution"])
	// What came from the initial load has its solution in another format: it is not offered as the teacher's.
	old := items[1].(map[string]any)
	assert.Equal(t, true, old["legacy"])
	assert.Nil(t, old["solution"])
	assert.Equal(t, []any{}, old["conditions"])
	assert.NotNil(t, body["exercisesSetup"])
	assert.Equal(t, teacher.p.UserID, f.who.UserID)
}

// Covers SPEC-023 CA-02, CA-08: an exercise is created and saved with its fields, and a save carries the instant the editor knew.
func TestExerciseHandler_CreateAndUpdate(t *testing.T) {
	f := newFakeBank()
	code, body := bankCall(t, f, teacher, 100, http.MethodPost, exercisesPath(""),
		`{"title":"Criar","difficulty":"EASY","statement":"<p>x</p>","hints":[{"text":"d"}],"conditions":[{"kind":"DIR_EXISTS","path":"/a"}]}`)
	assert.Equal(t, http.StatusCreated, code)
	assert.Equal(t, "Criar", body["title"])
	assert.Equal(t, "Criar", f.in.Title)
	assert.JSONEq(t, `[{"text":"d"}]`, string(f.in.Hints))

	path := exercisesPath("/" + uuid.NewString())
	code, body = bankCall(t, f, teacher, 100, http.MethodPut, path, `{"title":"Criar","difficulty":"EASY"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, body["type"], "validation-error")

	code, _ = bankCall(t, f, teacher, 100, http.MethodPut, path, `{"title":"Criar","difficulty":"EASY","updatedAt":"2026-10-10T12:00:00Z"}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC), f.expected)
	assert.False(t, f.force)
	code, _ = bankCall(t, f, teacher, 100, http.MethodPut, path, `{"title":"Criar","difficulty":"EASY","force":true}`)
	assert.Equal(t, http.StatusOK, code)
	assert.True(t, f.force)

	code, _ = bankCall(t, f, teacher, 100, http.MethodGet, exercisesPath("/not-a-uuid"), "")
	assert.Equal(t, http.StatusNotFound, code)
}

// Covers SPEC-023 CA-03: the availability, the order of the trail, the removal and the snapshots of the two sets.
func TestExerciseHandler_AvailabilityOrderDeleteAndSetups(t *testing.T) {
	f := newFakeBank()
	code, _ := bankCall(t, f, teacher, 100, http.MethodPut, exercisesPath("/"+uuid.NewString()+"/availability"), `{"usage":"ASSESSMENT","status":"PUBLISHED"}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "ASSESSMENT", f.usage)
	assert.Equal(t, "PUBLISHED", f.status)

	id := uuid.New()
	code, _ = bankCall(t, f, teacher, 100, http.MethodPut, exercisesPath("/order"), `{"items":[{"exerciseId":"`+id.String()+`","mandatory":false}]}`)
	assert.Equal(t, http.StatusNoContent, code)
	assert.Equal(t, []service.OrderItem{{ExerciseID: id, Mandatory: false}}, f.order)

	code, _ = bankCall(t, f, teacher, 100, http.MethodDelete, exercisesPath("/"+uuid.NewString()), "")
	assert.Equal(t, http.StatusNoContent, code)

	code, body := bankCall(t, f, teacher, 100, http.MethodPut, "/teacher/modules/"+uuid.NewString()+"/exercise-setups",
		`{"exercisesSetup":{"steps":[{"command":"mkdir /a"}]},"assessmentSetup":null}`)
	assert.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /a"}]}`, string(f.setups[0]))
	assert.Nil(t, body["assessmentSetup"])
}

// Covers SPEC-023 5: the error table of the exercise routes, and who may use them.
func TestExerciseHandler_Errors(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		kind   string
	}{
		{"invalid exercise", &domain.PayloadError{Fields: []domain.FieldError{{Field: "title", Reason: "required"}}}, 400, "validation-error"},
		{"not found", service.ErrExerciseNotFound, 404, "exercise-not-found"},
		{"conflict", service.ErrExerciseConflict, 409, "block-conflict"},
		{"invalid order", service.ErrInvalidExerciseOrder, 400, "validation-error"},
		{"incomplete", service.ErrExerciseIncomplete, 400, "validation-error"},
		{"invalid availability", service.ErrInvalidAvailability, 400, "validation-error"},
		{"forbidden", service.ErrForbidden, 403, "forbidden"},
		{"module not found", service.ErrModuleNotFound, 404, "module-not-found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeBank()
			f.err = tc.err
			code, body := bankCall(t, f, teacher, 100, http.MethodGet, exercisesPath(""), "")
			assert.Equal(t, tc.status, code)
			assert.Contains(t, body["type"], tc.kind)
		})
	}

	t.Run("only teachers and administrators", func(t *testing.T) {
		f := newFakeBank()
		path := exercisesPath("")
		code, _ := bankCall(t, f, teacher, 100, http.MethodPost, path, `{"title":"a","difficulty":"EASY"}`)
		assert.Equal(t, http.StatusCreated, code)
		student := validator{p: authn.Principal{UserID: uuid.New(), Role: "STUDENT"}}
		code, _ = bankCall(t, f, student, 100, http.MethodGet, path, "")
		assert.Equal(t, http.StatusForbidden, code)
	})
}
