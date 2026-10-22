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

// withScenario gives a question of the bank the machine it starts from.
func (f *fixture) withScenario(id uuid.UUID, snapshot string) {
	q := f.questions.bank[id]
	q.Scenario = json.RawMessage(snapshot)
	f.questions.bank[id] = q
}

// Covers SPEC-084 CA-14 (RN-01): the teacher reads the machine of a question chosen for the assessment, and one without a scenario gives none; the
// question of the bank that was not chosen, and one that does not exist, are not found. Reading writes nothing.
func TestQuestionScenario_ReadsTheMachineOfAChosenQuestion(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.withScenario(f.easy[0], `{"machine":"escolhida"}`)
	writes := f.repo.writes

	got, err := f.svc.QuestionScenario(ctx, f.teacher, f.class.ID, a.ID, f.easy[0])
	require.NoError(t, err)
	assert.JSONEq(t, `{"machine":"escolhida"}`, string(got))

	none, err := f.svc.QuestionScenario(ctx, f.teacher, f.class.ID, a.ID, f.easy[1])
	require.NoError(t, err)
	assert.Nil(t, none, "no scenario of its own: the default machine")

	f.withScenario(f.easy[4], `{"machine":"fora"}`)
	_, err = f.svc.QuestionScenario(ctx, f.teacher, f.class.ID, a.ID, f.easy[4])
	assert.ErrorIs(t, err, domain.ErrQuestionNotFound, "eligible in the module, but not chosen for this assessment")
	_, err = f.svc.QuestionScenario(ctx, f.teacher, f.class.ID, a.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrQuestionNotFound)
	assert.Equal(t, writes, f.repo.writes)
}

// Covers SPEC-084 CA-14 (RN-01): in a draw, which keeps no questions, the question only has to be eligible in the module of the assessment.
func TestQuestionScenario_InADrawTheQuestionOnlyHasToBeEligibleInTheModule(t *testing.T) {
	f := newFixture(t)
	drawn := f.create(t, func(in *service.CreateInput) {
		in.Composition, in.Items, in.Draw = domain.CompositionDraw, nil, f.draw(3, 3, 4, 1, 1, 1)
	})
	f.withScenario(f.easy[0], `{"machine":"sorteada"}`)

	got, err := f.svc.QuestionScenario(ctx, f.teacher, f.class.ID, drawn.ID, f.easy[0])
	require.NoError(t, err)
	assert.JSONEq(t, `{"machine":"sorteada"}`, string(got))

	for _, reason := range []string{"other module", "unpublished", "not in the assessment", "deleted"} {
		_, err := f.svc.QuestionScenario(ctx, f.teacher, f.class.ID, drawn.ID, f.notEligible(reason))
		assert.ErrorIs(t, err, domain.ErrQuestionNotFound, reason)
	}
}

// Covers SPEC-084 CA-14: only the teacher of the class and the administrator read it; the assessment and the class must exist.
func TestQuestionScenario_OnlyTheOwnerTeacherAndTheAdministrator(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.withScenario(f.easy[0], `{"machine":"x"}`)
	for name, actor := range map[string]service.Actor{"a student": f.as(f.ana), "another teacher": f.other} {
		_, err := f.svc.QuestionScenario(ctx, actor, f.class.ID, a.ID, f.easy[0])
		assert.ErrorIs(t, err, domain.ErrForbidden, name)
	}
	_, err := f.svc.QuestionScenario(ctx, f.admin, f.class.ID, a.ID, f.easy[0])
	assert.NoError(t, err)
	_, err = f.svc.QuestionScenario(ctx, f.teacher, f.class.ID, uuid.New(), f.easy[0])
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound)
	_, err = f.svc.QuestionScenario(ctx, f.teacher, uuid.New(), a.ID, f.easy[0])
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
}
