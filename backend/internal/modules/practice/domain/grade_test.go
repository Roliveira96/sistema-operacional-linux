package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ptrInt(v int) *int { return &v }

// Covers SPEC-039 RN-04 to RN-06 and D-06, D-07: the suggestion, the confirmation (from the AI or from the teacher) and the revision.
func TestAnswerGradeLifecycle(t *testing.T) {
	at := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	ai, teacher := uuid.New(), uuid.New()
	var g AnswerGrade
	assert.Equal(t, StatusPending, g.Status())

	ev, err := g.Suggest(75, "covers the owner and the group", "Good, but you missed the others.", ai, at)
	require.NoError(t, err)
	assert.Equal(t, StatusSuggested, g.Status())
	assert.Equal(t, GradeSuggested, ev.Kind)
	_, err = g.Suggest(60, "x", "", ai, at)
	assert.ErrorIs(t, err, ErrInvalidScore)

	ev, err = g.Confirm(GradeInput{UseSuggestion: true, StudentNote: "Good, but you missed the others.", PrivateNote: "check again"}, teacher, at)
	require.NoError(t, err)
	assert.Equal(t, StatusGraded, g.Status())
	assert.Equal(t, 75, *g.Score)
	assert.Equal(t, SourceAIAccepted, *g.Source)
	assert.Equal(t, GradeConfirmed, ev.Kind)
	assert.Nil(t, ev.PreviousScore)

	_, err = g.Confirm(GradeInput{Score: ptrInt(100)}, teacher, at)
	assert.ErrorIs(t, err, ErrReasonRequired, "a revision needs a reason")
	ev, err = g.Confirm(GradeInput{Score: ptrInt(100), Reason: "she did mention others", StudentNote: "Complete."}, teacher, at.Add(time.Hour))
	require.NoError(t, err)
	assert.Equal(t, GradeRevised, ev.Kind)
	assert.Equal(t, 75, *ev.PreviousScore)
	assert.Equal(t, 100, *g.Score)
	assert.Equal(t, SourceTeacher, *g.Source)
	assert.Equal(t, "Complete.", *g.StudentNote)
}

func TestAnswerGradeRefusals(t *testing.T) {
	var g AnswerGrade
	at := time.Now()
	_, err := g.Confirm(GradeInput{UseSuggestion: true}, uuid.New(), at)
	assert.ErrorIs(t, err, ErrNoSuggestion)
	_, err = g.Confirm(GradeInput{}, uuid.New(), at)
	assert.ErrorIs(t, err, ErrInvalidScore)
	_, err = g.Confirm(GradeInput{Score: ptrInt(30)}, uuid.New(), at)
	assert.ErrorIs(t, err, ErrInvalidScore)
	ev, err := g.Confirm(GradeInput{Score: ptrInt(0)}, uuid.New(), at)
	require.NoError(t, err)
	assert.Equal(t, SourceTeacher, *g.Source)
	assert.Equal(t, 0, *ev.Score)
}
