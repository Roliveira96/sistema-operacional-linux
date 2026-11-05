package service_test

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-095 CA-01 (RN-01, RN-02, D-02): the teacher reads the attempt of one student with the questions in its order, what the student sees,
// the saved answer, whether the practical one was checked as solved and the key of the objective ones; never the points nor the machine.
func TestAttemptForTeacher_GivesTheAnswersAndTheKeyNeverThePoints(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	got := f.enter(t, f.ana, a)
	me := f.as(f.ana)
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 4, json.RawMessage(`{"machine":"big"}`)))

	read, err := f.svc.AttemptForTeacher(ctx, f.teacher, f.class.ID, a.ID, got.ID)
	require.NoError(t, err)
	assert.Equal(t, got.ID, read.ID)
	assert.Equal(t, f.ana.ID, read.StudentID)
	assert.Equal(t, "Ana", read.StudentName)
	assert.Equal(t, domain.AttemptInProgress, read.Status)
	require.Len(t, read.Items, 5)
	for i, it := range read.Items {
		assert.Equal(t, i+1, it.Position)
	}
	single := read.Items[0]
	assert.Equal(t, "Questão "+kindSingle, single.Title)
	assert.JSONEq(t, `{"choice":"a"}`, string(single.Answer))
	assert.JSONEq(t, `{"choice":"a"}`, string(single.AnswerKey), "the fake bank keeps the key as it is")
	assert.Empty(t, read.Items[1].Answer, "no answer yet")
	practical := read.Items[3]
	assert.Empty(t, practical.Answer, "the machine never goes to the teacher here: the terminal is in the tab Aluno")
	require.NotNil(t, practical.CheckedSolved)
	assert.False(t, *practical.CheckedSolved)
	assert.Empty(t, practical.AnswerKey)
	assert.Empty(t, read.Items[4].AnswerKey, "no key for the written one")

	_, err = f.svc.AttemptForTeacher(ctx, f.admin, f.class.ID, a.ID, got.ID)
	assert.NoError(t, err, "the administrator reads it too")
}

// Covers SPEC-095 CA-02: the student and another teacher cannot read it; an attempt of another assessment is not found.
func TestAttemptForTeacher_ForbiddenToStudentsAndOtherTeachers(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	ana := f.enter(t, f.ana, a)
	_, err := f.svc.AttemptForTeacher(ctx, f.as(f.ana), f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.AttemptForTeacher(ctx, f.other, f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestAttemptForTeacher_NotOfThisAssessment(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	_, err := f.svc.AttemptForTeacher(ctx, f.teacher, f.class.ID, a.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)
}
