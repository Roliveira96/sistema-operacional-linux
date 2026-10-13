package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/mcptest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/service"
)

func gradingSetup(t *testing.T) (*env, *mcptest.Grading) {
	t.Helper()
	e := setup(t, false)
	g := mcptest.NewGrading(e.f)
	e.svc.WithGrading(g)
	return e, g
}

func intPtr(v int) *int { return &v }

// Covers SPEC-039 RN-04 and D-08: the agent lists the answers waiting for correction, without the name of the student.
func TestListPendingAnswers(t *testing.T) {
	e, g := gradingSetup(t)
	ctx := context.Background()
	pending := g.AddAnswer(e.module, "Permissions", "<p>rwx for the owner</p>", "Ana Souza")
	suggested := g.AddAnswer(e.module, "Permissions", "<p>nothing</p>", "Bruno Lima")
	_, terr := e.svc.SuggestGrade(ctx, e.teacher, service.SuggestGradeInput{AnswerID: suggested.String(), Score: intPtr(0), Reason: "empty"})
	require.Nil(t, terr)

	res, terr := e.svc.ListPendingAnswers(ctx, e.teacher, service.ListPendingAnswersInput{ModuleID: e.mid()})
	require.Nil(t, terr)
	require.Len(t, res.Items, 1, "PENDING is the default")
	assert.Equal(t, pending, res.Items[0].AnswerID)
	assert.Equal(t, "Permissions", res.Items[0].QuestionTitle)
	assert.Equal(t, "PENDING", res.Items[0].Status)

	res, terr = e.svc.ListPendingAnswers(ctx, e.teacher, service.ListPendingAnswersInput{ModuleID: e.mid(), Status: "SUGGESTED"})
	require.Nil(t, terr)
	require.Len(t, res.Items, 1)
	assert.Equal(t, suggested, res.Items[0].AnswerID)

	out, _ := json.Marshal(res)
	assert.NotContains(t, string(out), "Bruno", "the agent never sees the name (D-08)")

	_, terr = e.svc.ListPendingAnswers(ctx, e.teacher, service.ListPendingAnswersInput{ModuleID: e.mid(), Status: "DONE"})
	assert.Equal(t, "status", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = e.svc.ListPendingAnswers(ctx, e.teacher, service.ListPendingAnswersInput{ModuleID: "x"})
	requireErr(t, terr, domain.TypeValidation)

	// CA-05: a teacher who does not own the module sees it as missing; ADMIN sees it.
	_, terr = e.svc.ListPendingAnswers(ctx, e.other, service.ListPendingAnswersInput{ModuleID: e.mid()})
	requireErr(t, terr, domain.TypeModuleNotFound)
	_, terr = e.svc.ListPendingAnswers(ctx, e.admin, service.ListPendingAnswersInput{ModuleID: e.mid()})
	assert.Nil(t, terr)

	e.f.Fail["Grading.List"] = errors.New("boom")
	_, terr = e.svc.ListPendingAnswers(ctx, e.teacher, service.ListPendingAnswersInput{ModuleID: e.mid()})
	requireErr(t, terr, domain.TypeInternal)
}

// Covers SPEC-039 RN-04 and D-08: the agent reads the question, the correct answer and the answer of the student as data, with an
// anonymous id.
func TestGetAnswer(t *testing.T) {
	e, g := gradingSetup(t)
	ctx := context.Background()
	id := g.AddAnswer(e.module, "Permissions", "<p>rwx for the owner</p>", "Ana Souza")

	res, terr := e.svc.GetAnswer(ctx, e.teacher, service.GetAnswerInput{AnswerID: id.String()})
	require.Nil(t, terr)
	assert.Equal(t, id, res.AnswerID)
	assert.Equal(t, e.module, res.ModuleID)
	assert.Equal(t, "Permissions", res.Question.Title)
	assert.Equal(t, "<p>Explain chmod 750.</p>", res.Question.Statement)
	assert.Equal(t, "<p>Owner rwx, group r-x.</p>", res.Question.ExpectedAnswer)
	assert.Equal(t, "<p>rwx for the owner</p>", res.StudentAnswer.HTML)
	assert.Contains(t, res.StudentAnswer.Note, "data", "the answer is marked as content of the student")
	assert.Equal(t, "PENDING", res.Status)
	assert.Nil(t, res.Suggestion)
	out, _ := json.Marshal(res)
	assert.NotContains(t, string(out), "Ana", "no name, e-mail nor id of the student (D-08)")

	_, terr = e.svc.SuggestGrade(ctx, e.teacher, service.SuggestGradeInput{AnswerID: id.String(), Score: intPtr(75), Reason: "misses others", StudentNote: "Look at the others."})
	require.Nil(t, terr)
	res, terr = e.svc.GetAnswer(ctx, e.teacher, service.GetAnswerInput{AnswerID: id.String()})
	require.Nil(t, terr)
	assert.Equal(t, "SUGGESTED", res.Status)
	require.NotNil(t, res.Suggestion)
	assert.Equal(t, 75, res.Suggestion.Score)
	assert.Equal(t, "misses others", res.Suggestion.Reason)
	assert.Equal(t, "Look at the others.", res.Suggestion.StudentNote)

	// A teacher of another module, a progress that is not a descriptive answer and a bad id.
	_, terr = e.svc.GetAnswer(ctx, e.other, service.GetAnswerInput{AnswerID: id.String()})
	requireErr(t, terr, domain.TypeAnswerNotFound)
	_, terr = e.svc.GetAnswer(ctx, e.teacher, service.GetAnswerInput{AnswerID: uuid.NewString()})
	requireErr(t, terr, domain.TypeAnswerNotFound)
	_, terr = e.svc.GetAnswer(ctx, e.teacher, service.GetAnswerInput{AnswerID: "x"})
	assert.Equal(t, "answerId", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
}

// Covers SPEC-039 CA-04, CA-05 and CA-09: the suggestion is one of the five bands, kept without being a grade, and only for who
// can correct the module.
func TestSuggestGrade(t *testing.T) {
	e, g := gradingSetup(t)
	ctx := context.Background()
	id := g.AddAnswer(e.module, "Permissions", "<p>rwx</p>", "Ana Souza")

	for _, bad := range []*int{nil, intPtr(60), intPtr(-25), intPtr(125)} {
		_, terr := e.svc.SuggestGrade(ctx, e.teacher, service.SuggestGradeInput{AnswerID: id.String(), Score: bad, Reason: "x"})
		assert.Equal(t, "score", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	}
	assert.Equal(t, "PENDING", g.Answers[id].Grade.Status(), "nothing was kept")

	res, terr := e.svc.SuggestGrade(ctx, e.teacher, service.SuggestGradeInput{AnswerID: id.String(), Score: intPtr(50), Reason: "half of it", StudentNote: "Review the group."})
	require.Nil(t, terr)
	assert.Equal(t, id, res.AnswerID)
	assert.Equal(t, "SUGGESTED", res.Status)
	grade := g.Answers[id].Grade
	assert.Nil(t, grade.Score, "a suggestion is never a grade (RN-04)")
	assert.Equal(t, 50, *grade.SuggestedScore)
	assert.Equal(t, e.teacher.UserID, *grade.SuggestedBy)

	// The write is audited with the tool and the user, never the content.
	entries := e.logs.FilterMessage("mcp write").All()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1].ContextMap()
	assert.Equal(t, domain.ToolSuggestGrade, last["tool"])
	assert.Equal(t, e.module.String(), last["moduleId"])
	assert.NotContains(t, last, "reason")

	_, terr = e.svc.SuggestGrade(ctx, e.other, service.SuggestGradeInput{AnswerID: id.String(), Score: intPtr(100), Reason: "x"})
	requireErr(t, terr, domain.TypeAnswerNotFound)
	_, terr = e.svc.SuggestGrade(ctx, e.admin, service.SuggestGradeInput{AnswerID: id.String(), Score: intPtr(100), Reason: "x"})
	assert.Nil(t, terr, "ADMIN corrects any module")

	e.f.Deny = true
	_, terr = e.svc.SuggestGrade(ctx, e.teacher, service.SuggestGradeInput{AnswerID: id.String(), Score: intPtr(100), Reason: "x"})
	assert.Nil(t, terr, "the limiter is off in this setup")
}

// Covers SPEC-024 RN-10 for the correction: suggest_grade is a write and is rate limited.
func TestSuggestGradeRateLimited(t *testing.T) {
	e := setup(t, true)
	g := mcptest.NewGrading(e.f)
	e.svc.WithGrading(g)
	id := g.AddAnswer(e.module, "Permissions", "<p>rwx</p>", "Ana")
	e.f.Deny = true
	_, terr := e.svc.SuggestGrade(context.Background(), e.teacher, service.SuggestGradeInput{AnswerID: id.String(), Score: intPtr(100), Reason: "x"})
	requireErr(t, terr, domain.TypeRateLimited)
	assert.True(t, domain.IsWrite(domain.ToolSuggestGrade))
	assert.False(t, domain.IsWrite(domain.ToolGetAnswer))
	assert.False(t, domain.IsWrite(domain.ToolListPendingAnswers))
}

// Without the correction wired, the tools answer with an internal error instead of failing.
func TestGradingToolsWithoutService(t *testing.T) {
	e := setup(t, false)
	_, terr := e.svc.GetAnswer(context.Background(), e.teacher, service.GetAnswerInput{AnswerID: uuid.NewString()})
	requireErr(t, terr, domain.TypeInternal)
}

// Covers SPEC-039 RN-01: the bank tools create and edit descriptive questions with the validations of the screen.
func TestDiscursiveQuestionsThroughTheTools(t *testing.T) {
	e := setup(t, false)
	ctx := context.Background()
	mid := e.mid()
	created, terr := e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{
		ModuleID: mid, Kind: "DISCURSIVE", Title: "permissions", Difficulty: "MEDIUM", Statement: "<p>Explain chmod 750.</p>",
		ExpectedAnswer: "<p>rwx</p>", MaxLength: intPtr(5000),
	})
	require.Nil(t, terr)
	assert.Equal(t, "DISCURSIVE", created.Exercise.Kind)
	require.NotNil(t, created.Exercise.ExpectedAnswer)
	assert.Equal(t, "<p>rwx</p>", *created.Exercise.ExpectedAnswer)
	assert.Equal(t, 5000, *created.Exercise.MaxLength)

	id := created.Exercise.ID.String()
	title := "permissions again"
	up, terr := e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", Title: &title})
	require.Nil(t, terr)
	assert.Equal(t, "<p>rwx</p>", *up.Exercise.ExpectedAnswer, "what is not given is kept")
	assert.Equal(t, 5000, *up.Exercise.MaxLength)

	empty := ""
	up, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", ExpectedAnswer: &empty, MaxLength: intPtr(500)})
	require.Nil(t, terr)
	assert.Equal(t, "", *up.Exercise.ExpectedAnswer)
	assert.Equal(t, 500, *up.Exercise.MaxLength)

	_, terr = e.svc.UpdateModuleExercise(ctx, e.teacher, service.UpdateModuleExerciseInput{ModuleID: mid, ExerciseID: id, Operation: "UPDATE", MaxLength: intPtr(1234)})
	assert.Equal(t, "maxLength", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
	_, terr = e.svc.CreateModuleExercise(ctx, e.teacher, service.CreateModuleExerciseInput{ModuleID: mid, Kind: "THEORETICAL_BOOLEAN", Title: "x", Difficulty: "EASY", ExpectedAnswer: "<p>x</p>"})
	assert.Equal(t, "expectedAnswer", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)
}
