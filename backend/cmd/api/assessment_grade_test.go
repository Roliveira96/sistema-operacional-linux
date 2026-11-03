package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	assessmentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

func keyOf(t *testing.T, q contentdomain.Question) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(q)
	require.NoError(t, err)
	return raw
}

// Covers SPEC-090 CA-04, CA-06 (RN-04, RN-08, D-01): the grading of an attempt with the grading of the bank: the single choice and the true or false
// all or nothing, the matching by the share of right pairs and accepting fewer links while the answer is made, the written one pending and cleaned,
// and an answer that does not fit refused.
func TestAssessmentQuestions_GradeAnAttempt(t *testing.T) {
	q := assessmentQuestions{}
	grade := func(kind string, question contentdomain.Question, answer string) (float64, bool, error) {
		question.Kind = kind
		got, err := q.Grade(context.Background(), kind, keyOf(t, question), json.RawMessage(answer))
		return got.Fraction, got.Pending, err
	}

	single := contentdomain.Question{Choices: json.RawMessage(`[{"id":"a","html":"chmod"},{"id":"b","html":"chown"}]`), AnswerKey: json.RawMessage(`{"correct":"a"}`)}
	f, _, err := grade(contentdomain.KindTheoreticalSingle, single, `{"choice":"a"}`)
	require.NoError(t, err)
	assert.Equal(t, 1.0, f)
	f, _, _ = grade(contentdomain.KindTheoreticalSingle, single, `{"choice":"b"}`)
	assert.Equal(t, 0.0, f)
	_, _, err = grade(contentdomain.KindTheoreticalSingle, single, `{"choice":"z"}`)
	assert.ErrorIs(t, err, assessmentdomain.ErrInvalidAnswer)

	boolean := contentdomain.Question{AnswerKey: json.RawMessage(`{"correct":true}`)}
	f, _, _ = grade(contentdomain.KindTheoreticalBoolean, boolean, `{"value":true}`)
	assert.Equal(t, 1.0, f)
	_, _, err = grade(contentdomain.KindTheoreticalBoolean, boolean, `{"value":"sim"}`)
	assert.ErrorIs(t, err, assessmentdomain.ErrInvalidAnswer)

	matching := contentdomain.Question{
		Choices:   json.RawMessage(`{"left":[{"id":"l1","text":"cd"},{"id":"l2","text":"ls"},{"id":"l3","text":"cp"},{"id":"l4","text":"mv"}],"right":[{"id":"r1","text":"entra"},{"id":"r2","text":"lista"},{"id":"r3","text":"copia"},{"id":"r4","text":"move"}]}`),
		AnswerKey: json.RawMessage(`{"pairs":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r3"},{"left":"l4","right":"r4"}]}`),
	}
	f, _, err = grade(contentdomain.KindTheoreticalMatching, matching, `{"links":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r4"},{"left":"l4","right":"r3"}]}`)
	require.NoError(t, err)
	assert.Equal(t, 0.5, f, "2 of 4 pairs")
	f, _, err = grade(contentdomain.KindTheoreticalMatching, matching, `{"links":[{"left":"l1","right":"r1"}]}`)
	require.NoError(t, err, "an answer still being made")
	assert.Equal(t, 0.25, f)
	_, _, err = grade(contentdomain.KindTheoreticalMatching, matching, `{"links":[{"left":"l1","right":"r1"},{"left":"l2","right":"r1"}]}`)
	assert.ErrorIs(t, err, assessmentdomain.ErrInvalidAnswer, "a right item used twice")
	_, _, err = grade(contentdomain.KindTheoreticalMatching, matching, `{"links":[{"left":"x","right":"r1"}]}`)
	assert.ErrorIs(t, err, assessmentdomain.ErrInvalidAnswer, "an item that does not exist")

	written := contentdomain.Question{AnswerKey: json.RawMessage(`{"expected":"rwx","maxLength":500}`)}
	got, err := q.Grade(context.Background(), contentdomain.KindDiscursive, keyOf(t, written), json.RawMessage(`{"html":"<p>dono lê</p><script>x</script>"}`))
	require.NoError(t, err)
	assert.True(t, got.Pending)
	assert.NotContains(t, string(got.Stored), "script", "the answer is cleaned")

	_, _, err = grade(contentdomain.KindPractical, contentdomain.Question{ValidationConditions: json.RawMessage(`[]`)}, `{"not":"a machine"}`)
	assert.ErrorIs(t, err, assessmentdomain.ErrInvalidAnswer, "the practical answer is a machine")
}
