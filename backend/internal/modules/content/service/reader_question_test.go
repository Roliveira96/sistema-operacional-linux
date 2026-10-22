package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// Covers SPEC-075 RN-16: another module reads a question by its id, with the answer key, whatever its usage, and with no one to authorize; that
// module checks the module of the question and decides who may see it.
func TestReader_QuestionReadsAnyQuestionByIdForAnotherModule(t *testing.T) {
	q := domain.Question{ID: uuid.New(), ModuleID: uuid.New(), Kind: domain.KindPractical, Usage: domain.UsageAssessment, Status: domain.StatusDraft, Title: "Criar a pasta"}
	store := &fakeReadStore{question: &q}
	r := NewReader(&fakeAccess{}, store)

	got, err := r.Question(context.Background(), q.ID)
	require.NoError(t, err)
	assert.Equal(t, q, got, "even a draft and one that is only for the assessment")

	store.question = nil
	_, err = r.Question(context.Background(), q.ID)
	assert.ErrorIs(t, err, ErrQuestionNotFound)
}

// Covers SPEC-084 RN-01, RN-02: another module reads the machine a question starts from, whatever its usage, with no one to authorize; a question
// without a scenario of its own gives none, and one that does not exist is not found.
func TestReader_QuestionScenarioGivesTheMachineOfAnyQuestion(t *testing.T) {
	scenarioID := uuid.New()
	q := domain.Question{ID: uuid.New(), ModuleID: uuid.New(), Kind: domain.KindPractical, Usage: domain.UsageAssessment, Status: domain.StatusDraft, ScenarioID: &scenarioID}
	store := &fakeReadStore{question: &q, scenario: &domain.Scenario{ID: scenarioID, Snapshot: json.RawMessage(`{"machine":"x"}`)}}
	r := NewReader(&fakeAccess{}, store)

	got, err := r.QuestionScenario(context.Background(), q.ID)
	require.NoError(t, err)
	assert.JSONEq(t, `{"machine":"x"}`, string(got), "even a draft and one that is only for the assessment")

	q.ScenarioID = nil
	got, err = r.QuestionScenario(context.Background(), q.ID)
	require.NoError(t, err)
	assert.Nil(t, got, "no scenario of its own: the default machine applies")

	store.question = nil
	_, err = r.QuestionScenario(context.Background(), q.ID)
	assert.ErrorIs(t, err, ErrQuestionNotFound)
}
