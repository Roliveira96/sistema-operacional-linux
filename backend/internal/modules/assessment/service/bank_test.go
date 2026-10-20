package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// Covers SPEC-075 CA-20 (RN-18): what the bank of questions asks the assessments, in the words of the bank: which questions a SCHEDULED manual
// assessment lists, and the biggest quantity of each level a SCHEDULED draw of the module asks for.
func TestBank_AnswersWhatItAsks(t *testing.T) {
	f := newFixture(t)
	f.create(t) // a manual assessment with the first three easy questions
	drawn := f.create(t, func(in *service.CreateInput) {
		in.Composition, in.Items, in.Draw = domain.CompositionDraw, nil, f.draw(3, 3, 4, 1, 1, 1)
	})

	held, err := f.svc.InScheduledAssessment(ctx, f.easy[0])
	require.NoError(t, err)
	assert.True(t, held, "a question of a scheduled manual assessment")
	held, err = f.svc.InScheduledAssessment(ctx, f.hard[0])
	require.NoError(t, err)
	assert.False(t, held, "a question that no assessment lists")

	demand, err := f.svc.DrawDemand(ctx, f.module.ID)
	require.NoError(t, err)
	assert.Equal(t, map[string]int{"EASY": 3, "MEDIUM": 3, "HARD": 4}, demand, "the levels in the words of the bank")

	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, drawn.ID, "Greve")
	require.NoError(t, err)
	demand, err = f.svc.DrawDemand(ctx, f.module.ID)
	require.NoError(t, err)
	assert.Empty(t, demand, "a canceled draw asks for nothing")
}
