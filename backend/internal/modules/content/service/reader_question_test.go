package service

import (
	"context"
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
