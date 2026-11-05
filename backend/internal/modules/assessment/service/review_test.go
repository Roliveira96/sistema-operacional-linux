package service_test

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// deliveredExam is the exam of five kinds with Ana's attempt answered, with a command in the practical question and a request for help, delivered,
// and the exam finished by the teacher at 10:00 (SPEC-097).
func (f *fixture) deliveredExam(t *testing.T) (service.Summary, service.StudentAttempt) {
	t.Helper()
	a := f.fiveKinds(t)
	ana := f.enter(t, f.ana, a)
	me := f.as(f.ana)
	f.now = at(21, 9, 20)
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 5, json.RawMessage(`{"html":"<p>Dono lê</p>"}`)))
	_, err := f.svc.RecordCommand(ctx, a.ID, f.ana.ID, service.CommandInput{Position: 4, Command: "mkdir /a", Output: ""})
	require.NoError(t, err)
	_, err = f.svc.RaiseHand(ctx, a.ID, f.ana.ID, ptr(2), "Posso usar o man?")
	require.NoError(t, err)
	_, err = f.svc.SubmitAttempt(ctx, me, f.class.ID, a.ID)
	require.NoError(t, err)
	f.now = at(21, 10, 0)
	_, err = f.svc.Finish(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	return a, ana
}

// Covers SPEC-097 CA-02 (RN-01, RN-02): after the end, the teacher reads the delivered attempt for the correction: the questions with the answer,
// the key of the objective ones, the expected answer of the written one, the automatic points, the commands of each practical question, the
// requests for help, the notes and the situation of the review.
func TestReviewOf_GivesEverythingAfterTheEnd(t *testing.T) {
	f := newFixture(t)
	a, ana := f.deliveredExam(t)

	got, err := f.svc.ReviewOf(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	require.NoError(t, err)
	assert.Equal(t, ana.ID, got.AttemptID)
	assert.Equal(t, "Ana", got.StudentName)
	assert.Equal(t, "1000001", got.AcademicID)
	assert.Equal(t, domain.AttemptSubmitted, got.Status)
	assert.False(t, got.Reviewed)
	assert.Empty(t, got.TeacherNote)
	assert.Empty(t, got.StudentNote)
	require.Len(t, got.Items, 5)

	single := got.Items[0]
	assert.JSONEq(t, `{"choice":"a"}`, string(single.Answer))
	assert.JSONEq(t, `{"choice":"a"}`, string(single.AnswerKey))
	require.NotNil(t, single.Points)
	assert.Equal(t, domain.Points(2), *single.Points)
	assert.Nil(t, single.AdjustedPoints)

	practical := got.Items[3]
	require.Len(t, practical.Commands, 1)
	assert.Equal(t, "mkdir /a", practical.Commands[0].Command)
	assert.Empty(t, got.Items[0].Commands)

	written := got.Items[4]
	assert.Equal(t, "Resposta esperada", written.ExpectedAnswer)
	assert.Nil(t, written.Points, "the written one waits for the teacher")

	require.NotNil(t, got.PreliminaryScore)
	assert.Equal(t, *got.PreliminaryScore, got.Score, "with no adjustment the score is the automatic one")
	require.Len(t, got.Helps, 1)
	assert.Equal(t, "Posso usar o man?", got.Helps[0].Question)

	_, err = f.svc.ReviewOf(ctx, f.admin, f.class.ID, a.ID, ana.ID)
	assert.NoError(t, err, "the administrator reads it too")
}

// Covers SPEC-097 CA-02 (RN-01, D-06): before the end there is no correction; an attempt still in progress is refused; only the teacher who owns
// the class or the administrator reads it.
func TestReviewOf_RefusesBeforeTheEndAndOthers(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	ana := f.enter(t, f.ana, a)
	f.now = at(21, 9, 30)
	_, err := f.svc.ReviewOf(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotEnded)

	f.now = at(21, 11, 0) // the period is over, but nobody closed the attempt yet
	_, err = f.svc.ReviewOf(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrAttemptInProgress)

	_, err = f.svc.ReviewOf(ctx, f.as(f.ana), f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.ReviewOf(ctx, f.other, f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.ReviewOf(ctx, f.teacher, f.class.ID, a.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)
}
