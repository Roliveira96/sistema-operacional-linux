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
	err       error
	who       service.Actor
	in        domain.ExerciseInput
	dependsOn *uuid.UUID
	links     service.ExerciseLinks
	expected  time.Time
	force     bool
	status    string
	order     []service.OrderItem
	setup     json.RawMessage
	record    service.ExerciseRecord
}

func newFakeBank() *fakeBank {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	q := domain.Question{ID: uuid.New(), Title: "Criar", Difficulty: "EASY", Usage: domain.UsageExercise, InAssessment: true, Status: domain.StatusPublished, UpdatedAt: now, CreatedAt: now,
		CreatedByName: "Ana", UpdatedByName: "Ana", Hints: json.RawMessage(`[{"text":"dica"}]`),
		EndConditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`), ReferenceSolution: json.RawMessage(`{"steps":[{"command":"mkdir /a"}]}`)}
	return &fakeBank{record: service.ExerciseRecord{Question: q, Position: 1, Mandatory: true}}
}

func (f *fakeBank) List(_ context.Context, who service.Actor, _ uuid.UUID) (service.ExerciseBank, error) {
	f.who = who
	legacy := service.ExerciseRecord{Question: domain.Question{ID: uuid.New(), Title: "Antigo", ReferenceSolution: json.RawMessage(`[{"command":"ls"}]`), Usage: domain.UsageAssessment}}
	return service.ExerciseBank{Items: []service.ExerciseRecord{f.record, legacy}, BankSetup: json.RawMessage(`{"steps":[]}`)}, f.err
}

func (f *fakeBank) Get(_ context.Context, who service.Actor, _, _ uuid.UUID) (service.ExerciseRecord, error) {
	f.who = who
	return f.record, f.err
}

func (f *fakeBank) Create(_ context.Context, who service.Actor, _ uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, links service.ExerciseLinks) (service.ExerciseRecord, error) {
	f.who, f.in, f.dependsOn, f.links = who, in, dependsOn, links
	return f.record, f.err
}

func (f *fakeBank) Update(_ context.Context, who service.Actor, _, _ uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, expected time.Time, force bool) (service.ExerciseRecord, error) {
	f.who, f.in, f.dependsOn, f.expected, f.force = who, in, dependsOn, expected, force
	return f.record, f.err
}

func (f *fakeBank) SetLinks(_ context.Context, _ service.Actor, _, _ uuid.UUID, links service.ExerciseLinks, status string) (service.ExerciseRecord, error) {
	f.links, f.status = links, status
	return f.record, f.err
}

func (f *fakeBank) Delete(context.Context, service.Actor, uuid.UUID, uuid.UUID) error { return f.err }

func (f *fakeBank) Reorder(_ context.Context, _ service.Actor, _ uuid.UUID, items []service.OrderItem) error {
	f.order = items
	return f.err
}

func (f *fakeBank) SetBankSetup(_ context.Context, _ service.Actor, _ uuid.UUID, setup json.RawMessage) (json.RawMessage, error) {
	f.setup = setup
	return setup, f.err
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

// Covers SPEC-023 CA-01, CA-09, D-08: the bank lists every exercise with its links, its place in the trail, its author and what came
// from the initial load.
func TestExerciseHandler_List(t *testing.T) {
	f := newFakeBank()
	dep := uuid.New()
	f.record.DependsOn = &dep
	code, body := bankCall(t, f, teacher, 100, http.MethodGet, exercisesPath(""), "")
	require.Equal(t, http.StatusOK, code)
	items := body["items"].([]any)
	require.Len(t, items, 2)
	first := items[0].(map[string]any)
	assert.Equal(t, true, first["practice"])
	assert.Equal(t, true, first["assessment"])
	assert.Equal(t, false, first["exclusive"])
	assert.Equal(t, dep.String(), first["dependsOn"])
	assert.EqualValues(t, 1, first["position"])
	assert.Equal(t, true, first["mandatory"])
	assert.Equal(t, "Ana", first["createdBy"])
	assert.Equal(t, false, first["legacy"])
	assert.NotNil(t, first["solution"])
	// What came from the initial load has its solution in another format: it is not offered as the teacher's, and it is not linked.
	old := items[1].(map[string]any)
	assert.Equal(t, true, old["legacy"])
	assert.Equal(t, false, old["practice"])
	assert.Nil(t, old["solution"])
	assert.Nil(t, old["dependsOn"])
	assert.Equal(t, []any{}, old["conditions"])
	assert.NotNil(t, body["bankSetup"])
	assert.Equal(t, teacher.p.UserID, f.who.UserID)
}

// Covers SPEC-023 11.1, CA-02, CA-08: an exercise is created in the bank, already linked when it comes from a block, and a save carries the
// instant the editor knew.
func TestExerciseHandler_CreateAndUpdate(t *testing.T) {
	f := newFakeBank()
	dep := uuid.New()
	code, body := bankCall(t, f, teacher, 100, http.MethodPost, exercisesPath(""),
		`{"title":"Criar","difficulty":"EASY","statement":"<p>x</p>","hints":[{"text":"d"}],"conditions":[{"kind":"DIR_EXISTS","path":"/a"}],"dependsOn":"`+dep.String()+`","links":{"practice":true,"assessment":true}}`)
	assert.Equal(t, http.StatusCreated, code)
	assert.Equal(t, "Criar", body["title"])
	assert.Equal(t, "Criar", f.in.Title)
	assert.JSONEq(t, `[{"text":"d"}]`, string(f.in.Hints))
	assert.Equal(t, dep, *f.dependsOn)
	assert.Equal(t, service.ExerciseLinks{Practice: true, Assessment: true}, f.links)

	path := exercisesPath("/" + uuid.NewString())
	code, body = bankCall(t, f, teacher, 100, http.MethodPut, path, `{"title":"Criar","difficulty":"EASY"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, body["type"], "validation-error")

	code, _ = bankCall(t, f, teacher, 100, http.MethodPut, path, `{"title":"Criar","difficulty":"EASY","updatedAt":"2026-10-10T12:00:00Z"}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC), f.expected)
	assert.False(t, f.force)
	assert.Nil(t, f.dependsOn)
	code, _ = bankCall(t, f, teacher, 100, http.MethodPut, path, `{"title":"Criar","difficulty":"EASY","force":true}`)
	assert.Equal(t, http.StatusOK, code)
	assert.True(t, f.force)

	code, _ = bankCall(t, f, teacher, 100, http.MethodGet, exercisesPath("/not-a-uuid"), "")
	assert.Equal(t, http.StatusNotFound, code)
}

// Covers SPEC-023 CA-03: the links, the order of the trail, the removal and the snapshot of the bank.
func TestExerciseHandler_LinksOrderDeleteAndSetup(t *testing.T) {
	f := newFakeBank()
	code, _ := bankCall(t, f, teacher, 100, http.MethodPut, exercisesPath("/"+uuid.NewString()+"/links"), `{"practice":false,"assessment":true,"exclusive":true,"status":"PUBLISHED"}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, service.ExerciseLinks{Assessment: true, Exclusive: true}, f.links)
	assert.Equal(t, "PUBLISHED", f.status)

	id := uuid.New()
	code, _ = bankCall(t, f, teacher, 100, http.MethodPut, exercisesPath("/order"), `{"items":[{"exerciseId":"`+id.String()+`","mandatory":false}]}`)
	assert.Equal(t, http.StatusNoContent, code)
	assert.Equal(t, []service.OrderItem{{ExerciseID: id, Mandatory: false}}, f.order)

	code, _ = bankCall(t, f, teacher, 100, http.MethodDelete, exercisesPath("/"+uuid.NewString()), "")
	assert.Equal(t, http.StatusNoContent, code)

	code, body := bankCall(t, f, teacher, 100, http.MethodPut, "/teacher/modules/"+uuid.NewString()+"/exercise-setup", `{"bankSetup":{"steps":[{"command":"mkdir /a"}]}}`)
	assert.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /a"}]}`, string(f.setup))
	assert.NotNil(t, body["bankSetup"])
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
		{"invalid links", service.ErrInvalidLinks, 400, "validation-error"},
		{"invalid status", service.ErrInvalidStatus, 400, "validation-error"},
		{"invalid dependency", service.ErrInvalidDependency, 400, "validation-error"},
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
