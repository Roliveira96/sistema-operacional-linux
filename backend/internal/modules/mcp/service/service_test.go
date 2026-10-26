package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/mcptest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/service"
)

type env struct {
	f       *mcptest.Fake
	svc     *service.Service
	logs    *observer.ObservedLogs
	teacher service.Caller
	other   service.Caller
	admin   service.Caller
	module  uuid.UUID
}

func setup(t *testing.T, limited bool) *env {
	t.Helper()
	f := mcptest.New()
	core, logs := observer.New(zap.InfoLevel)
	var lim service.Limiter
	if limited {
		lim = f
	}
	e := &env{f: f, logs: logs,
		teacher: service.Caller{UserID: uuid.New(), Role: domain.RoleTeacher},
		other:   service.Caller{UserID: uuid.New(), Role: domain.RoleTeacher},
		admin:   service.Caller{UserID: uuid.New(), Role: domain.RoleAdmin},
	}
	e.svc = service.New(f, f, mcptest.Exercises{F: f}, mcptest.Versions{F: f}, lim, zap.New(core))
	e.module = f.AddModule(e.teacher.UserID, "Linux")
	return e
}

func (e *env) mid() string { return e.module.String() }

func raw(s string) json.RawMessage { return json.RawMessage(s) }

func block(typ, payload string) service.BlockInput {
	return service.BlockInput{Type: typ, Payload: raw(payload)}
}

const tipPayload = `{"title":"t","html":"<p>hello</p>"}`

func requireErr(t *testing.T, terr *domain.ToolError, errType string) *domain.ToolError {
	t.Helper()
	require.NotNil(t, terr)
	require.Equal(t, errType, terr.Type)
	return terr
}

func TestListModules(t *testing.T) {
	e := setup(t, false)
	e.f.AddModule(e.other.UserID, "Other")
	e.f.Changed[e.module] = true

	res, terr := e.svc.ListModules(context.Background(), e.teacher, service.ListModulesInput{})
	require.Nil(t, terr)
	require.Len(t, res.Items, 1)
	assert.Equal(t, "Linux", res.Items[0].Title)
	assert.True(t, res.Items[0].HasUnpublishedChanges)
	assert.Equal(t, 1, res.Page)
	assert.Equal(t, 20, res.Limit)

	res, terr = e.svc.ListModules(context.Background(), e.admin, service.ListModulesInput{Limit: 500})
	require.Nil(t, terr)
	assert.Len(t, res.Items, 2, "ADMIN sees every module (CA-05)")
	assert.Equal(t, 100, res.Limit)

	e.f.Fail["ListModules"] = errors.New("boom")
	_, terr = e.svc.ListModules(context.Background(), e.admin, service.ListModulesInput{})
	requireErr(t, terr, domain.TypeInternal)
	e.f.Fail["Versions.List"] = errors.New("boom")
	_, terr = e.svc.ListModules(context.Background(), e.admin, service.ListModulesInput{})
	requireErr(t, terr, domain.TypeInternal)
}

func TestGetModule(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	_, terr := e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", tipPayload)}})
	require.Nil(t, terr)
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: e.mid(), Title: "ex", Difficulty: "EASY", Links: service.LinksInput{Practice: true}})
	require.Nil(t, terr)

	res, terr := e.svc.GetModule(ctx, e.teacher, service.ModuleInput{ModuleID: e.mid()})
	require.Nil(t, terr)
	assert.Equal(t, "Linux", res.Module.Title)
	assert.Len(t, res.Blocks, 1)
	assert.Len(t, res.Exercises, 1)
	assert.JSONEq(t, "null", string(res.Setup))
	assert.JSONEq(t, "[]", string(res.Exercises[0].Conditions))
	assert.JSONEq(t, "null", string(res.Exercises[0].Solution)) // no solution recorded

	// CA-04: the module of another teacher reads as missing; CA-05: an admin reads any.
	_, terr = e.svc.GetModule(ctx, e.other, service.ModuleInput{ModuleID: e.mid()})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.GetModule(ctx, e.admin, service.ModuleInput{ModuleID: e.mid()})
	require.Nil(t, terr)
	_, terr = e.svc.GetModule(ctx, e.teacher, service.ModuleInput{ModuleID: "nope"})
	te := requireErr(t, terr, domain.TypeValidation)
	assert.Equal(t, "moduleId", te.Fields[0].Field)
	assert.Equal(t, "nope", te.Fields[0].Received)
	_, terr = e.svc.GetModule(ctx, e.teacher, service.ModuleInput{})
	assert.Equal(t, "(missing)", terr.Fields[0].Received)
	_, terr = e.svc.GetModule(ctx, e.teacher, service.ModuleInput{ModuleID: uuid.NewString()})
	requireErr(t, terr, domain.TypeModuleNotFound)

	for _, m := range []string{"Authoring.Setup", "Exercises.List", "Versions.List", "GetModuleByID"} {
		e.f.Fail[m] = errors.New("boom")
		_, terr = e.svc.GetModule(ctx, e.teacher, service.ModuleInput{ModuleID: e.mid()})
		requireErr(t, terr, domain.TypeInternal)
	}
}

func TestCreateModule(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	slug := "linux-basics"
	start := "2026-10-10T12:00:00Z"
	m, terr := e.svc.CreateModule(ctx, e.teacher, service.CreateModuleInput{Title: "New", Description: "d", Slug: &slug, Visibility: "PUBLIC", ActivationStart: &start, ClassIDs: []string{}})
	require.Nil(t, terr)
	assert.Equal(t, "New", m.Title)
	assert.Equal(t, "ACTIVE", m.Status)
	assert.Equal(t, e.teacher.UserID, e.f.Modules[m.ID].TeacherID, "the creator owns the module")
	require.NotNil(t, m.ActivationStart)

	entries := e.logs.FilterMessage("mcp write").All()
	require.Len(t, entries, 1)
	assert.Equal(t, m.ID.String(), entries[0].ContextMap()["moduleId"])
	assert.Equal(t, domain.ToolCreateModule, entries[0].ContextMap()["tool"])

	bad := "yesterday"
	_, terr = e.svc.CreateModule(ctx, e.teacher, service.CreateModuleInput{Title: "x", ActivationStart: &bad})
	te := requireErr(t, terr, "invalid-date-format")
	assert.Equal(t, "activationStart", te.Fields[0].Field)
	_, terr = e.svc.CreateModule(ctx, e.teacher, service.CreateModuleInput{Title: "x", ActivationEnd: &bad})
	requireErr(t, terr, "invalid-date-format")
	_, terr = e.svc.CreateModule(ctx, e.teacher, service.CreateModuleInput{Title: "x", ClassIDs: []string{"zzz"}})
	assert.Equal(t, "classIds[0]", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)

	for err, want := range map[error]string{
		cmservice.ErrTitleRequired:       "title-required",
		cmservice.ErrDescriptionRequired: "description-required",
		cmservice.ErrDescriptionTooLong:  "description-too-long",
		cmdomain.ErrInvalidVisibility:    "invalid-visibility",
		cmdomain.ErrInvalidStatus:        "invalid-status",
		cmdomain.ErrInvalidDateRange:     "invalid-date-range",
		cmdomain.ErrInvalidSlug:          "invalid-slug",
		cmdomain.ErrSlugTaken:            "slug-taken",
		cmdomain.ErrPrivateRequiresClass: "private-requires-class",
		cmdomain.ErrForbidden:            domain.TypeModuleNotFound,
	} {
		e.f.Fail["CreateModule"] = err
		_, terr = e.svc.CreateModule(ctx, e.teacher, service.CreateModuleInput{Title: "x"})
		got := requireErr(t, terr, want)
		assert.NotEmpty(t, got.Title)
	}
	assert.Equal(t, false, e.logs.FilterMessage("mcp write").All()[1].ContextMap()["ok"], "failed writes are logged too")
}

func TestUpdateModuleMetadataAndArchive(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	title, status := "Renamed", "INACTIVE"
	m, terr := e.svc.UpdateModuleMetadata(ctx, e.teacher, service.UpdateModuleMetadataInput{
		ModuleID: e.mid(), Title: &title, Status: &status, Slug: raw(`"new-slug"`), ActivationStart: raw(`"2026-01-01T00:00:00Z"`)})
	require.Nil(t, terr)
	assert.Equal(t, "Renamed", m.Title)
	assert.Equal(t, "INACTIVE", m.Status)
	require.NotNil(t, m.Slug)
	require.NotNil(t, m.ActivationStart)

	vis := "PRIVATE"
	m, terr = e.svc.UpdateModuleMetadata(ctx, e.admin, service.UpdateModuleMetadataInput{ModuleID: e.mid(), Visibility: &vis, Slug: raw(`null`), ActivationStart: raw(`""`), ClassIDs: []string{uuid.NewString()}})
	require.Nil(t, terr)
	assert.Nil(t, m.Slug, "null clears the slug")
	assert.Nil(t, m.ActivationStart)
	assert.Equal(t, "PRIVATE", m.Visibility)

	_, terr = e.svc.UpdateModuleMetadata(ctx, e.other, service.UpdateModuleMetadataInput{ModuleID: e.mid(), Title: &title})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.UpdateModuleMetadata(ctx, e.teacher, service.UpdateModuleMetadataInput{ModuleID: e.mid(), Slug: raw(`5`)})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleMetadata(ctx, e.teacher, service.UpdateModuleMetadataInput{ModuleID: e.mid(), ActivationEnd: raw(`"soon"`)})
	requireErr(t, terr, "invalid-date-format")
	_, terr = e.svc.UpdateModuleMetadata(ctx, e.teacher, service.UpdateModuleMetadataInput{ModuleID: e.mid(), ClassIDs: []string{"x"}})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleMetadata(ctx, e.teacher, service.UpdateModuleMetadataInput{ModuleID: e.mid(), ActivationStart: raw(`7`)})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleMetadata(ctx, e.teacher, service.UpdateModuleMetadataInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)

	m, terr = e.svc.ArchiveModule(ctx, e.teacher, service.ModuleInput{ModuleID: e.mid()})
	require.Nil(t, terr)
	assert.Equal(t, "ARCHIVED", m.Status, "CA-14")
	_, terr = e.svc.ArchiveModule(ctx, e.other, service.ModuleInput{ModuleID: e.mid()})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.ArchiveModule(ctx, e.teacher, service.ModuleInput{ModuleID: uuid.NewString()})
	requireErr(t, terr, domain.TypeModuleNotFound)
}

func TestAppendContentBlocks(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	res, terr := e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{
		block("TIP", tipPayload), block("STEP_BY_STEP", `{"steps":["a","b"]}`)}})
	require.Nil(t, terr)
	require.Len(t, res.Blocks, 2)
	assert.Equal(t, "STEP_BY_STEP", res.Blocks[1].Type)

	// After a given block.
	after := res.Blocks[0].ID.String()
	res, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), AfterBlockID: &after, Blocks: []service.BlockInput{block("CURIOSITY", `{"html":"<p>x</p>"}`)}})
	require.Nil(t, terr)
	assert.Len(t, res.Blocks, 3)

	// CA-10: an invalid block names the field, the value received and the value expected, and nothing is written.
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{
		block("TIP", tipPayload), block("COMMAND", `{"steps":[{"command":"ls"},{"command":""}]}`), block("NOPE", `{}`)}})
	te := requireErr(t, terr, domain.TypeValidation)
	require.Len(t, te.Fields, 2)
	assert.Equal(t, domain.FieldProblem{Field: "blocks[1].payload.steps[1].command", Received: `""`, Expected: "required"}, te.Fields[0])
	assert.Equal(t, "blocks[2].type", te.Fields[1].Field)
	assert.Equal(t, "unknown block type", te.Fields[1].Expected)
	assert.Len(t, e.f.Blocks[e.module], 3, "nothing from the failed call was stored")

	bad := "zzz"
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), AfterBlockID: &bad, Blocks: []service.BlockInput{block("TIP", tipPayload)}})
	assert.Equal(t, "afterBlockId", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	missingBlock := uuid.NewString()
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), AfterBlockID: &missingBlock, Blocks: []service.BlockInput{block("TIP", tipPayload)}})
	requireErr(t, terr, domain.TypeBlockNotFound)
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid()})
	assert.Equal(t, "blocks", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = e.svc.AppendContentBlocks(ctx, e.other, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", tipPayload)}})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)

	e.f.Fail["Authoring.SaveCard"] = contentservice.ErrInvalidCard
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", tipPayload)}})
	requireErr(t, terr, domain.TypeValidation)
}

func TestReplaceContentBlocks(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	_, terr := e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", tipPayload), block("TIP", tipPayload)}})
	require.Nil(t, terr)
	old := e.f.Blocks[e.module]

	res, terr := e.svc.ReplaceContentBlocks(ctx, e.teacher, service.ReplaceContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("CARDS", `{"cards":[{"title":"a","text":"b"}]}`)}})
	require.Nil(t, terr)
	require.Len(t, res.Blocks, 1)
	assert.Equal(t, "CARDS", res.Blocks[0].Type)
	assert.NotEqual(t, old[0].ID, res.Blocks[0].ID)

	// CA-11: a failure keeps the draft as it was.
	before := e.f.Blocks[e.module]
	_, terr = e.svc.ReplaceContentBlocks(ctx, e.teacher, service.ReplaceContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", tipPayload), block("WIDGET", `{"component":"X"}`)}})
	te := requireErr(t, terr, domain.TypeValidation)
	assert.Equal(t, "blocks[1].payload.component", te.Fields[0].Field)
	assert.Equal(t, `"X"`, te.Fields[0].Received)
	assert.Equal(t, before, e.f.Blocks[e.module])

	res, terr = e.svc.ReplaceContentBlocks(ctx, e.teacher, service.ReplaceContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{}})
	require.Nil(t, terr)
	assert.Empty(t, res.Blocks)

	_, terr = e.svc.ReplaceContentBlocks(ctx, e.teacher, service.ReplaceContentBlocksInput{ModuleID: e.mid()})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.ReplaceContentBlocks(ctx, e.other, service.ReplaceContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{}})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.ReplaceContentBlocks(ctx, e.teacher, service.ReplaceContentBlocksInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)
}

func TestUpdateContentBlock(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	res, terr := e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", tipPayload), block("TIP", tipPayload)}})
	require.Nil(t, terr)
	b0, b1 := res.Blocks[0], res.Blocks[1]
	call := func(c service.Caller, in service.UpdateContentBlockInput) (service.UpdateContentBlockResult, *domain.ToolError) {
		in.ModuleID = e.mid()
		return e.svc.UpdateContentBlock(ctx, c, in)
	}

	// Forced update (no expectedUpdatedAt) and guarded update with the instant read.
	up, terr := call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "UPDATE", Payload: raw(`{"html":"<p>new</p>"}`)})
	require.Nil(t, terr)
	assert.Contains(t, string(up.Block.Payload), "new")
	stamp := b1.UpdatedAt.Format("2006-01-02T15:04:05.999999999Z07:00")
	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b1.ID.String(), Operation: "UPDATE", Payload: raw(`{"html":"<p>g</p>"}`), ExpectedUpdatedAt: &stamp})
	require.Nil(t, terr)
	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b1.ID.String(), Operation: "UPDATE", Payload: raw(`{"html":"<p>g</p>"}`), ExpectedUpdatedAt: &stamp})
	te := requireErr(t, terr, domain.TypeBlockConflict)
	assert.Equal(t, 409, te.Status)

	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "UPDATE", Payload: raw(`{"html":""}`)})
	assert.Equal(t, "payload.html", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "UPDATE", Payload: raw(`"text"`)})
	assert.Equal(t, "payload", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "UPDATE"})
	requireErr(t, terr, domain.TypeValidation)
	badStamp := "x"
	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "UPDATE", Payload: raw(`{}`), ExpectedUpdatedAt: &badStamp})
	requireErr(t, terr, "invalid-date-format")

	off, terr := call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "DEACTIVATE"})
	require.Nil(t, terr)
	assert.False(t, off.Block.Active)
	on, terr := call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "ACTIVATE"})
	require.Nil(t, terr)
	assert.True(t, on.Block.Active)

	_, terr = call(e.other, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "DELETE"})
	requireErr(t, terr, domain.TypeModuleNotFound)
	del, terr := call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "DELETE"})
	require.Nil(t, terr)
	assert.True(t, del.Deleted)
	assert.Nil(t, del.Block)
	assert.Len(t, e.f.Blocks[e.module], 1)

	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "DELETE"})
	requireErr(t, terr, domain.TypeBlockNotFound)
	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: b0.ID.String(), Operation: "PUBLISH"})
	assert.Equal(t, "operation", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = call(e.teacher, service.UpdateContentBlockInput{BlockID: "x", Operation: "DELETE"})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateContentBlock(ctx, e.teacher, service.UpdateContentBlockInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)
}

func TestSetModuleSetup(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	res, terr := e.svc.SetModuleSetup(ctx, e.teacher, service.SetModuleSetupInput{ModuleID: e.mid(), Setup: raw(`{"steps":[{"command":"mkdir /a"}],"files":[{"path":"/a/f","content":"x"}]}`)})
	require.Nil(t, terr)
	assert.Contains(t, string(res.Setup), "mkdir /a")
	assert.NotEmpty(t, e.f.Setups[e.module])

	_, terr = e.svc.SetModuleSetup(ctx, e.teacher, service.SetModuleSetupInput{ModuleID: e.mid(), Setup: raw(`{"steps":[{"command":""}],"files":[{"path":"rel","content":""}]}`)})
	te := requireErr(t, terr, domain.TypeValidation)
	require.Len(t, te.Fields, 2)
	assert.Equal(t, domain.FieldProblem{Field: "setup.steps[0].command", Received: `""`, Expected: "required"}, te.Fields[0])
	assert.Equal(t, "setup.files[0].path", te.Fields[1].Field)

	_, terr = e.svc.SetModuleSetup(ctx, e.teacher, service.SetModuleSetupInput{ModuleID: e.mid()})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.SetModuleSetup(ctx, e.other, service.SetModuleSetupInput{ModuleID: e.mid(), Setup: raw(`{"steps":[]}`)})
	requireErr(t, terr, domain.TypeModuleNotFound)
}

func TestModuleExerciseLifecycle(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	mid := e.mid()
	first, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{
		ModuleID: mid, Title: "Make dir", Difficulty: "EASY", Statement: "<p>do it</p>",
		Hints:      raw(`[{"text":"use mkdir"}]`),
		Solution:   raw(`{"steps":[{"command":"mkdir /d"}]}`),
		Conditions: raw(`[{"kind":"DIR_EXISTS","path":"/d"}]`),
		Links:      service.LinksInput{Practice: true},
	})
	require.Nil(t, terr)
	assert.Equal(t, "DRAFT", first.Exercise.Status, "created exercises stay in draft")
	assert.True(t, first.Exercise.Practice)
	assert.Contains(t, string(first.Exercise.Solution), "mkdir /d")

	dep := first.Exercise.ID.String()
	second, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{
		ModuleID: mid, Title: "Make file", Difficulty: "MEDIUM", DependsOn: &dep, Conditions: raw(`[{"kind":"FILE_EXISTS","path":"/d/f"}]`), Links: service.LinksInput{Assessment: true}})
	require.Nil(t, terr)
	require.NotNil(t, second.Exercise.DependsOn)
	assert.True(t, second.Exercise.Assessment)

	// CA-10 for exercises: field path, received and expected; nothing stored.
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: mid, Title: "x", Difficulty: "EXTREME", Conditions: raw(`[{"kind":"FILE_EXISTS","path":"rel"}]`)})
	te := requireErr(t, terr, domain.TypeValidation)
	require.Len(t, te.Fields, 2)
	assert.Equal(t, domain.FieldProblem{Field: "difficulty", Received: `"EXTREME"`, Expected: "must be EASY, MEDIUM or HARD"}, te.Fields[0])
	assert.Equal(t, "conditions[0].path", te.Fields[1].Field)
	assert.Len(t, e.f.Exercises[e.module], 2)
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: mid, Title: "x", Difficulty: "EASY", Links: service.LinksInput{Exclusive: true, Practice: true}})
	requireErr(t, terr, domain.TypeValidation)
	badDep := "x"
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: mid, Title: "x", Difficulty: "EASY", DependsOn: &badDep})
	assert.Equal(t, "dependsOn", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = e.svc.CreateModuleExercise(ctx, e.other, service.CreateModuleExerciseInput{ModuleID: mid, Title: "x", Difficulty: "EASY"})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)

	// UPDATE keeps what is not given.
	newTitle := "Make the dir"
	up, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: dep, Operation: "UPDATE", Title: &newTitle})
	require.Nil(t, terr)
	assert.Equal(t, newTitle, up.Exercise.Title)
	assert.Equal(t, "EASY", up.Exercise.Difficulty)
	assert.Contains(t, string(up.Exercise.Conditions), "DIR_EXISTS")
	assert.Contains(t, string(up.Exercise.Solution), "mkdir /d")

	// dependsOn null clears it; a value sets it; a guarded update conflicts after a change.
	sec := second.Exercise.ID.String()
	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", DependsOn: raw(`null`)})
	require.Nil(t, terr)
	assert.Nil(t, up.Exercise.DependsOn)
	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", DependsOn: raw(`"` + dep + `"`)})
	require.Nil(t, terr)
	require.NotNil(t, up.Exercise.DependsOn)
	stale := up.Exercise.UpdatedAt.Add(-1).Format("2006-01-02T15:04:05.999999999Z07:00")
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", UpdatedAt: &stale})
	assert.Equal(t, domain.TypeBlockConflict, requireErr(t, terr, domain.TypeBlockConflict).Type)
	fresh := up.Exercise.UpdatedAt.Format("2006-01-02T15:04:05.999999999Z07:00")
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", UpdatedAt: &fresh})
	require.Nil(t, terr)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", DependsOn: raw(`5`)})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", DependsOn: raw(`"zz"`)})
	requireErr(t, terr, domain.TypeValidation)
	badStamp := "zz"
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", UpdatedAt: &badStamp})
	requireErr(t, terr, "invalid-date-format")
	diff := "EXTREME"
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", Difficulty: &diff})
	requireErr(t, terr, domain.TypeValidation)
	stmt := "<p>s</p>"
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "UPDATE", Statement: &stmt, Hints: raw(`[]`), Solution: raw(`null`), Conditions: raw(`[{"kind":"FILE_EXISTS","path":"/d/g"}]`)})
	require.Nil(t, terr)

	// SET_LINKS keeps the status (it never publishes).
	rl, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "SET_LINKS", Links: &service.LinksInput{Practice: true, Assessment: true}})
	require.Nil(t, terr)
	assert.Equal(t, "DRAFT", rl.Exercise.Status)
	assert.True(t, rl.Exercise.Practice)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "SET_LINKS"})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "SET_LINKS", Links: &service.LinksInput{Exclusive: true, Practice: true}})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: uuid.NewString(), Operation: "SET_LINKS", Links: &service.LinksInput{}})
	requireErr(t, terr, domain.TypeExerciseNotFound)

	// REORDER and DELETE.
	ro, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, Operation: "REORDER", Order: []service.OrderEntry{{ExerciseID: sec, Mandatory: true}, {ExerciseID: dep}}})
	require.Nil(t, terr)
	assert.True(t, ro.Reordered)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, Operation: "REORDER", Order: []service.OrderEntry{{ExerciseID: uuid.NewString()}}})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, Operation: "REORDER", Order: []service.OrderEntry{{ExerciseID: "x"}}})
	requireErr(t, terr, domain.TypeValidation)
	del, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "DELETE"})
	require.Nil(t, terr)
	assert.True(t, del.Deleted)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: sec, Operation: "DELETE"})
	requireErr(t, terr, domain.TypeExerciseNotFound)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.other, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: dep, Operation: "DELETE"})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: dep, Operation: "PUBLISH"})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: "x", Operation: "DELETE"})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)
}

func TestExerciseServiceErrorsMapToTypes(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	for err, want := range map[error]string{
		contentservice.ErrExerciseConflict:     domain.TypeBlockConflict,
		contentservice.ErrExerciseIncomplete:   domain.TypeValidation,
		contentservice.ErrInvalidStatus:        domain.TypeValidation,
		contentservice.ErrInvalidDependency:    domain.TypeValidation,
		contentservice.ErrInvalidExerciseOrder: domain.TypeValidation,
		contentservice.ErrExerciseNotFound:     domain.TypeExerciseNotFound,
		contentservice.ErrForbidden:            domain.TypeModuleNotFound,
		contentservice.ErrQuestionInUse:        domain.TypeQuestionInUse, // SPEC-075 RN-18
	} {
		e.f.Fail["Exercises.Create"] = err
		_, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: e.mid(), Title: "x", Difficulty: "EASY"})
		requireErr(t, terr, want)
	}
	// An unexpected failure is an internal error that keeps the cause out of the message.
	e.f.Fail["Exercises.Create"] = errors.New("secret sql detail")
	_, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: e.mid(), Title: "x", Difficulty: "EASY"})
	te := requireErr(t, terr, domain.TypeInternal)
	assert.NotContains(t, te.Detail, "secret")
	assert.EqualError(t, te.Cause, "secret sql detail")
	assert.Equal(t, 500, te.Status)
	assert.Contains(t, te.Error(), domain.TypeInternal)
}

func TestSetExerciseSetup(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	mid := e.mid()
	ex, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: mid, Title: "a", Difficulty: "EASY", Conditions: raw(`[{"kind":"DIR_EXISTS","path":"/a"}]`), Links: service.LinksInput{Practice: true}})
	require.Nil(t, terr)
	other, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: mid, Title: "b", Difficulty: "EASY", Conditions: raw(`[{"kind":"DIR_EXISTS","path":"/b"}]`), Links: service.LinksInput{Practice: true}})
	require.Nil(t, terr)

	// Recipe and inheritance of one exercise.
	res, terr := e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid, ExerciseID: other.Exercise.ID.String(),
		Solution: raw(`{"steps":[{"command":"mkdir /b"}]}`), DependsOn: raw(`"` + ex.Exercise.ID.String() + `"`)})
	require.Nil(t, terr)
	assert.Contains(t, string(res.Exercise.Solution), "mkdir /b")
	require.NotNil(t, res.Exercise.DependsOn)
	assert.Equal(t, ex.Exercise.ID, *res.Exercise.DependsOn)
	assert.JSONEq(t, "null", string(res.BankSetup))

	_, terr = e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid, ExerciseID: ex.Exercise.ID.String(), Solution: raw(`{"steps":[{"command":""}]}`)})
	assert.Equal(t, "solution.steps[0].command", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid, ExerciseID: ex.Exercise.ID.String()})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid, ExerciseID: "x", Solution: raw(`{}`)})
	requireErr(t, terr, domain.TypeValidation)

	// Snapshot shared by the exercises.
	bank, terr := e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid, BankSetup: raw(`{"steps":[{"command":"mkdir /shared"}]}`)})
	require.Nil(t, terr)
	assert.Contains(t, string(bank.BankSetup), "/shared")
	_, terr = e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid, BankSetup: raw(`{"steps":[{"command":""}]}`)})
	assert.Equal(t, "bankSetup.steps[0].command", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	cleared, terr := e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid, BankSetup: raw(`null`)})
	require.Nil(t, terr)
	assert.JSONEq(t, "null", string(cleared.BankSetup))
	_, terr = e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: mid})
	requireErr(t, terr, domain.TypeValidation)
	_, terr = e.svc.SetExerciseSetup(ctx, e.other, service.SetExerciseSetupInput{ModuleID: mid, BankSetup: raw(`null`)})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.SetExerciseSetup(ctx, e.teacher, service.SetExerciseSetupInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)
}

func TestValidateModule(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	mid := e.mid()
	_, terr := e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: mid, Blocks: []service.BlockInput{block("TIP", tipPayload)}})
	require.Nil(t, terr)
	ok, terr := e.svc.ValidateModule(ctx, e.teacher, service.ModuleInput{ModuleID: mid})
	require.Nil(t, terr)
	assert.True(t, ok.Valid)
	assert.Empty(t, ok.Problems)
	assert.Contains(t, ok.Next, "publish")

	// Break the stored draft behind the services' back: every problem is listed with its path (CA-13a).
	e.f.Blocks[e.module][0].Payload = raw(`{"html":"","variant":"LOUD"}`)
	e.f.Setups[e.module] = raw(`{"steps":[{"command":""}]}`)
	e.f.BankSetup[e.module] = raw(`{"steps":[{"command":""}]}`)
	missingDep := uuid.New()
	e.f.Exercises[e.module] = append(e.f.Exercises[e.module],
		exerciseRecord("bad", "EXTREME", `[]`, &missingDep),
		exerciseRecord("legacy", "EASY", ``, nil),
	)
	res, terr := e.svc.ValidateModule(ctx, e.admin, service.ModuleInput{ModuleID: mid})
	require.Nil(t, terr)
	assert.False(t, res.Valid)
	fields := map[string]domain.FieldProblem{}
	for _, p := range res.Problems {
		fields[p.Field] = p
	}
	assert.Contains(t, fields, "blocks[0].payload.html")
	assert.Equal(t, `"LOUD"`, fields["blocks[0].payload.variant"].Received)
	assert.NotEmpty(t, fields["blocks[0].payload.html"].Ref)
	assert.Contains(t, fields, "setup.steps[0].command")
	assert.Contains(t, fields, "bankSetup.steps[0].command")
	assert.Contains(t, fields, "exercises[0].difficulty")
	assert.Equal(t, "[]", fields["exercises[0].conditions"].Received)
	assert.Contains(t, fields, "exercises[0].dependsOn")
	for f := range fields {
		assert.NotContains(t, f, "exercises[1]", "an exercise of the initial load is left alone")
	}

	_, terr = e.svc.ValidateModule(ctx, e.other, service.ModuleInput{ModuleID: mid})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.ValidateModule(ctx, e.teacher, service.ModuleInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)
	for _, m := range []string{"Authoring.Setup", "Exercises.List"} {
		e.f.Fail[m] = errors.New("boom")
		_, terr = e.svc.ValidateModule(ctx, e.teacher, service.ModuleInput{ModuleID: mid})
		requireErr(t, terr, domain.TypeInternal)
	}
	e.f.Fail["Authoring.List"] = errors.New("boom")
	_, terr = e.svc.ValidateModule(ctx, e.teacher, service.ModuleInput{ModuleID: mid})
	requireErr(t, terr, domain.TypeInternal)
}

func TestValidateModuleReportsABrokenPayloadShape(t *testing.T) {
	e := setup(t, false)
	e.f.Blocks[e.module] = append(e.f.Blocks[e.module], blockOf("TIP", `[1,2]`))
	res, terr := e.svc.ValidateModule(context.Background(), e.teacher, service.ModuleInput{ModuleID: e.mid()})
	require.Nil(t, terr)
	require.Len(t, res.Problems, 1)
	assert.Equal(t, "blocks[0].payload.payload", res.Problems[0].Field)
}

func TestListModuleVersions(t *testing.T) {
	e := setup(t, false)
	e.f.Versions_[e.module] = []contentservice.VersionSummary{{Number: 2, Current: true}, {Number: 1}}
	e.f.Changed[e.module] = true
	res, terr := e.svc.ListModuleVersions(context.Background(), e.teacher, service.ModuleInput{ModuleID: e.mid()})
	require.Nil(t, terr)
	assert.Len(t, res.Versions, 2)
	assert.True(t, res.HasUnpublishedChanges)
	_, terr = e.svc.ListModuleVersions(context.Background(), e.other, service.ModuleInput{ModuleID: e.mid()})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.ListModuleVersions(context.Background(), e.other, service.ModuleInput{})
	requireErr(t, terr, domain.TypeValidation)
}

// RN-10: the rate limit applies to every write and the service is not called when it refuses.
func TestWritesAreRateLimited(t *testing.T) {
	e := setup(t, true)
	e.f.Deny = true
	ctx := context.Background()
	_, terr := e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", tipPayload)}})
	te := requireErr(t, terr, domain.TypeRateLimited)
	assert.Equal(t, 429, te.Status)
	assert.Contains(t, te.Detail, "7 seconds")
	_, terr = e.svc.CreateModule(ctx, e.teacher, service.CreateModuleInput{Title: "x"})
	requireErr(t, terr, domain.TypeRateLimited)
	assert.False(t, e.f.Called("Authoring.SaveCard"))
	assert.False(t, e.f.Called("CreateModule"))

	// Reads are not limited.
	_, terr = e.svc.GetModule(ctx, e.teacher, service.ModuleInput{ModuleID: e.mid()})
	require.Nil(t, terr)
}

// RN-11, CA-15: a write is logged with user, tool and module, and never with the content.
func TestWritesAreLoggedWithoutContent(t *testing.T) {
	e := setup(t, false)
	secret := "very-secret-lesson-text"
	_, terr := e.svc.AppendContentBlocks(context.Background(), e.teacher, service.AppendContentBlocksInput{ModuleID: e.mid(), Blocks: []service.BlockInput{block("TIP", `{"html":"<p>`+secret+`</p>"}`)}})
	require.Nil(t, terr)
	entries := e.logs.FilterMessage("mcp write").All()
	require.Len(t, entries, 1)
	fields := entries[0].ContextMap()
	assert.Equal(t, e.teacher.UserID.String(), fields["userId"])
	assert.Equal(t, domain.ToolAppendContentBlocks, fields["tool"])
	assert.Equal(t, e.mid(), fields["moduleId"])
	assert.Equal(t, true, fields["ok"])
	for _, entry := range e.logs.All() {
		assert.NotContains(t, entry.Message, secret)
		for _, v := range entry.ContextMap() {
			assert.NotContains(t, fmt.Sprint(v), secret)
		}
	}

	// A read does not write to the log.
	_, _ = e.svc.GetModule(context.Background(), e.teacher, service.ModuleInput{ModuleID: e.mid()})
	assert.Len(t, e.logs.FilterMessage("mcp write").All(), 1)
}

// Covers SPEC-035 RN-15 and CA-21: the tools create and edit true or false questions with the validations of the screen, and the
// errors name the field.
func TestTrueFalseQuestionsThroughTheTools(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	mid := e.mid()
	yes := true
	created, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{
		ModuleID: mid, Kind: "THEORETICAL_BOOLEAN", Title: "rm -r", Difficulty: "EASY", Statement: "<p>rm -r removes non-empty directories.</p>",
		Hints: raw(`[{"text":"Think of -r"}]`), CorrectAnswer: &yes, Explanation: "<p>It is recursive.</p>", Links: service.LinksInput{Practice: true},
	})
	require.Nil(t, terr)
	assert.Equal(t, "THEORETICAL_BOOLEAN", created.Exercise.Kind)
	require.NotNil(t, created.Exercise.CorrectAnswer)
	assert.True(t, *created.Exercise.CorrectAnswer)
	require.NotNil(t, created.Exercise.Explanation)
	assert.Equal(t, "DRAFT", created.Exercise.Status)

	// UPDATE keeps the kind, the answer and the justification that are not given; null clears the answer.
	id := created.Exercise.ID.String()
	title := "rm -r again"
	up, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", Title: &title})
	require.Nil(t, terr)
	assert.Equal(t, "THEORETICAL_BOOLEAN", up.Exercise.Kind)
	require.NotNil(t, up.Exercise.CorrectAnswer)
	assert.True(t, *up.Exercise.CorrectAnswer)
	assert.Equal(t, "<p>It is recursive.</p>", *up.Exercise.Explanation)

	why := "<p>Changed.</p>"
	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", CorrectAnswer: raw(`false`), Explanation: &why})
	require.Nil(t, terr)
	assert.False(t, *up.Exercise.CorrectAnswer)
	assert.Equal(t, why, *up.Exercise.Explanation)
	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", CorrectAnswer: raw(`null`)})
	require.Nil(t, terr)
	assert.Nil(t, up.Exercise.CorrectAnswer)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", CorrectAnswer: raw(`"yes"`)})
	assert.Equal(t, "correctAnswer", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)

	// What belongs to the terminal is refused, with the field.
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{
		ModuleID: mid, Kind: "THEORETICAL_BOOLEAN", Title: "x", Difficulty: "EASY", Conditions: raw(`[{"kind":"DIR_EXISTS","path":"/a"}]`),
	})
	assert.Equal(t, "conditions", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: mid, Kind: "THEORETICAL_MULTIPLE", Title: "x", Difficulty: "EASY"})
	assert.Equal(t, "kind", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)

	// A card gets a true or false exercise through the block tools.
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: mid, Blocks: []service.BlockInput{
		block("TEXT", `{"title":"Card","html":"<p>x</p>"}`),
		block("EXERCISES", `{"items":[{"kind":"THEORETICAL_BOOLEAN","title":"tf","difficulty":"EASY","correctAnswer":true,"explanation":"<p>why</p>"}]}`),
	}})
	require.Nil(t, terr)
	_, terr = e.svc.AppendContentBlocks(ctx, e.teacher, service.AppendContentBlocksInput{ModuleID: mid, Blocks: []service.BlockInput{
		block("EXERCISES", `{"items":[{"kind":"THEORETICAL_BOOLEAN","title":"tf","difficulty":"EASY"}]}`),
	}})
	te := requireErr(t, terr, domain.TypeValidation)
	assert.Contains(t, te.Fields[0].Field, "items[0].correctAnswer")
}

// Covers SPEC-036 RN-10 and CA-12: the tools create and edit single choice questions with the validations of the screen.
func TestSingleChoiceQuestionsThroughTheTools(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	mid := e.mid()
	correct, keep := "a", false
	created, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{
		ModuleID: mid, Kind: "THEORETICAL_SINGLE", Title: "chmod", Difficulty: "EASY", Statement: "<p>Which one?</p>",
		Choices: raw(`[{"id":"a","html":"chmod"},{"id":"b","html":"chown"}]`), CorrectChoice: &correct, ShuffleChoices: &keep,
	})
	require.Nil(t, terr)
	assert.Equal(t, "THEORETICAL_SINGLE", created.Exercise.Kind)
	require.Len(t, created.Exercise.Choices, 2)
	assert.Equal(t, "a", *created.Exercise.CorrectChoice)
	assert.False(t, *created.Exercise.ShuffleChoices)

	id := created.Exercise.ID.String()
	title := "chmod again"
	up, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", Title: &title})
	require.Nil(t, terr)
	assert.Equal(t, "a", *up.Exercise.CorrectChoice, "what is not given is kept")
	assert.Len(t, up.Exercise.Choices, 2)
	assert.False(t, *up.Exercise.ShuffleChoices)

	shuffle := true
	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE",
		Choices: raw(`[{"id":"a","html":"chmod"},{"id":"b","html":"chown"},{"id":"c","html":"ls"}]`), CorrectChoice: raw(`"c"`), ShuffleChoices: &shuffle})
	require.Nil(t, terr)
	assert.Equal(t, "c", *up.Exercise.CorrectChoice)
	assert.Len(t, up.Exercise.Choices, 3)
	assert.True(t, *up.Exercise.ShuffleChoices)
	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", CorrectChoice: raw(`null`)})
	require.Nil(t, terr)
	assert.Nil(t, up.Exercise.CorrectChoice)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", CorrectChoice: raw(`5`)})
	assert.Equal(t, "correctChoice", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", CorrectChoice: raw(`"zz"`)})
	assert.Equal(t, "correctChoice", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
}

// Covers SPEC-037 RN-10 and CA-13: the tools create and edit matching questions with the validations of the screen.
func TestMatchingQuestionsThroughTheTools(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	mid := e.mid()
	created, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{
		ModuleID: mid, Kind: "THEORETICAL_MATCHING", Title: "commands", Difficulty: "EASY", Statement: "<p>Link them.</p>",
		Left:  raw(`[{"id":"l1","text":"chmod"},{"id":"l2","text":"chown"}]`),
		Right: raw(`[{"id":"r1","text":"owner"},{"id":"r2","text":"mode"}]`),
		Pairs: raw(`[{"left":"l1","right":"r2"},{"left":"l2","right":"r1"}]`),
	})
	require.Nil(t, terr)
	assert.Equal(t, "THEORETICAL_MATCHING", created.Exercise.Kind)
	assert.Len(t, created.Exercise.Left, 2)
	assert.Len(t, created.Exercise.Right, 2)
	assert.Len(t, created.Exercise.Pairs, 2)
	assert.True(t, *created.Exercise.ShuffleChoices)

	id := created.Exercise.ID.String()
	title := "commands again"
	up, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", Title: &title})
	require.Nil(t, terr)
	assert.Len(t, up.Exercise.Pairs, 2, "what is not given is kept")

	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE",
		Pairs: raw(`[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"}]`)})
	require.Nil(t, terr)
	assert.Equal(t, "r1", up.Exercise.Pairs[0].Right)

	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE",
		Pairs: raw(`[{"left":"l1","right":"r1"},{"left":"l2","right":"r1"}]`)})
	assert.Equal(t, "pairs[1].right", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
}

// Covers SPEC-088 CA-05 (RN-04): an exercise created without links is born in the practice and in the assessment, as a draft; links given are
// used as they come, and an empty links object is no link at all.
func TestCreateModuleExerciseWithoutLinksGoesToPracticeAndAssessment(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	created, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: e.mid(), Title: "Sem vínculo dado", Difficulty: "EASY"})
	require.Nil(t, terr)
	assert.True(t, created.Exercise.Practice, "without links the exercise is in the practice")
	assert.True(t, created.Exercise.Assessment, "and in the assessment")
	assert.False(t, created.Exercise.Exclusive)
	assert.Equal(t, "DRAFT", created.Exercise.Status)

	var explicit service.CreateModuleExerciseInput
	require.NoError(t, json.Unmarshal([]byte(`{"moduleId":"`+e.mid()+`","title":"Sem vínculo","difficulty":"EASY","links":{}}`), &explicit))
	none, terr := e.svc.CreateModuleExercise(ctx, e.teacher, explicit)
	require.Nil(t, terr)
	assert.False(t, none.Exercise.Practice, "links given, even all false, are used as they come")
	assert.False(t, none.Exercise.Assessment)
}
