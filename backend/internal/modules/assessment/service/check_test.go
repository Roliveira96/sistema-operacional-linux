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

const machine = `{"formato":"exame-so/maquina","versao":1}`

// passes says whether the machine of a question meets its conditions.
func (f *fixture) passes(id uuid.UUID, ok bool) {
	q := f.questions.bank[id]
	q.Passes = ok
	f.questions.bank[id] = q
}

// Covers SPEC-085 CA-01, CA-04 (RN-01, RN-03): the teacher gets whether the machine of a chosen question meets its conditions, the machine goes to the
// correction as it came, and nothing is written.
func TestCheckQuestion_TellsWhetherTheMachineMeetsTheConditions(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.passes(f.easy[0], true)
	writes, events := f.repo.writes, len(f.repo.events[a.ID])

	passed, err := f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, a.ID, f.easy[0], json.RawMessage(machine))
	require.NoError(t, err)
	assert.True(t, passed)
	require.Len(t, f.questions.checked, 1)
	assert.JSONEq(t, machine, string(f.questions.checked[0]))

	passed, err = f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, a.ID, f.easy[1], json.RawMessage(machine))
	require.NoError(t, err)
	assert.False(t, passed, "this question was not met")

	assert.Equal(t, writes, f.repo.writes, "checking writes nothing")
	assert.Len(t, f.repo.events[a.ID], events, "and leaves no event in the history")
	assert.Empty(t, f.repo.clearances[a.ID])
}

// Covers SPEC-085 CA-03 (RN-01): the question has to be of the assessment, as for the scenario: chosen in a manual one and eligible in the module in a
// draw; and a question that does not use the terminal is not valid. Nothing reaches the correction for the one that is not found.
func TestCheckQuestion_OnlyAQuestionOfTheAssessmentThatUsesTheTerminal(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	drawn := f.create(t, func(in *service.CreateInput) {
		in.Composition, in.Items, in.Draw = domain.CompositionDraw, nil, f.draw(3, 3, 4, 1, 1, 1)
	})

	_, err := f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, a.ID, f.easy[4], json.RawMessage(machine))
	assert.ErrorIs(t, err, domain.ErrQuestionNotFound, "eligible in the module, but not chosen")
	_, err = f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, a.ID, uuid.New(), json.RawMessage(machine))
	assert.ErrorIs(t, err, domain.ErrQuestionNotFound)
	_, err = f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, drawn.ID, f.notEligible("other module"), json.RawMessage(machine))
	assert.ErrorIs(t, err, domain.ErrQuestionNotFound)
	assert.Empty(t, f.questions.checked)

	f.passes(f.easy[0], true)
	passed, err := f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, drawn.ID, f.easy[0], json.RawMessage(machine))
	require.NoError(t, err)
	assert.True(t, passed, "in a draw it only has to be eligible in the module")

	q := f.questions.bank[f.easy[1]]
	q.NoTerminal = true
	f.questions.bank[f.easy[1]] = q
	_, err = f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, a.ID, f.easy[1], json.RawMessage(machine))
	assert.ErrorIs(t, err, domain.ErrInvalidQuestion)
}

// Covers SPEC-085 CA-02 (RN-02): a machine that is missing is refused before the correction, and what the correction says about the state goes up.
func TestCheckQuestion_RefusesAMissingMachine(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	for _, snapshot := range []json.RawMessage{nil, json.RawMessage(""), json.RawMessage("null")} {
		_, err := f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, a.ID, f.easy[0], snapshot)
		assert.ErrorIs(t, err, domain.ErrSnapshotRequired)
	}
	assert.Empty(t, f.questions.checked, "nothing was asked of the correction")
}

// Covers SPEC-085 CA-03 (RN-06): only the teacher of the class and the administrator check; the assessment and the class must exist.
func TestCheckQuestion_OnlyTheOwnerTeacherAndTheAdministrator(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	for name, actor := range map[string]service.Actor{"a student": f.as(f.ana), "another teacher": f.other} {
		_, err := f.svc.CheckQuestion(ctx, actor, f.class.ID, a.ID, f.easy[0], json.RawMessage(machine))
		assert.ErrorIs(t, err, domain.ErrForbidden, name)
	}
	_, err := f.svc.CheckQuestion(ctx, f.admin, f.class.ID, a.ID, f.easy[0], json.RawMessage(machine))
	assert.NoError(t, err)
	_, err = f.svc.CheckQuestion(ctx, f.teacher, f.class.ID, uuid.New(), f.easy[0], json.RawMessage(machine))
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound)
	_, err = f.svc.CheckQuestion(ctx, f.teacher, uuid.New(), a.ID, f.easy[0], json.RawMessage(machine))
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
}
