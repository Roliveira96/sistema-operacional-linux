package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// fakeAssessmentUse is what the assessments tell the bank (SPEC-075 RN-18): which questions are in a SCHEDULED manual assessment, and the biggest
// quantity of each level a SCHEDULED draw of the module asks for.
type fakeAssessmentUse struct {
	inManual map[uuid.UUID]bool
	demand   map[string]int
}

func (f *fakeAssessmentUse) InScheduledAssessment(_ context.Context, questionID uuid.UUID) (bool, error) {
	return f.inManual[questionID], nil
}

func (f *fakeAssessmentUse) DrawDemand(context.Context, uuid.UUID) (map[string]int, error) {
	return f.demand, nil
}

// bankStore is a store with a whole bank of questions, and that remembers what was deleted and linked.
type bankStore struct {
	*fakeExerciseStore
	bank    []ExerciseRecord
	deleted []uuid.UUID
}

func (b *bankStore) ListExercises(context.Context, uuid.UUID) ([]ExerciseRecord, error) {
	return b.bank, nil
}

func (b *bankStore) FindExercise(_ context.Context, _, id uuid.UUID) (ExerciseRecord, error) {
	for _, r := range b.bank {
		if r.ID == id {
			return r, nil
		}
	}
	return ExerciseRecord{}, ErrExerciseNotFound
}

func (b *bankStore) DeleteExercise(_ context.Context, _, id uuid.UUID, _ time.Time) error {
	b.deleted = append(b.deleted, id)
	return nil
}

// question is a question of the bank: practical, with conditions, so that it can be published.
func question(level, status string, inAssessment bool) ExerciseRecord {
	return ExerciseRecord{Question: domain.Question{
		ID: uuid.New(), ModuleID: module, Kind: domain.KindPractical, Difficulty: level, Status: status, InAssessment: inAssessment,
		Usage: domain.UsageAssessment, ValidationConditions: json.RawMessage(`[{"type":"FILE_EXISTS","path":"/a"}]`), EndConditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`),
	}}
}

func newBank(t *testing.T, records ...ExerciseRecord) (*bankStore, *fakeAssessmentUse, *Exercises) {
	t.Helper()
	store := &bankStore{fakeExerciseStore: &fakeExerciseStore{owner: owner.UserID}, bank: records}
	use := &fakeAssessmentUse{inManual: map[uuid.UUID]bool{}, demand: map[string]int{}}
	return store, use, NewExercises(store, zap.NewNop()).WithAssessmentUse(use)
}

var (
	published = ExerciseLinks{Assessment: true}
	unlinked2 = ExerciseLinks{}
)

// Covers SPEC-075 CA-20 (RN-18): a question that is in a SCHEDULED manual assessment cannot be deleted, unpublished or taken out of the assessment
// bank; editing its text is still allowed, and a question that is in no assessment is free.
func TestExercises_RefusesDeleteUnpublishAndUnlinkWhenInAScheduledAssessment(t *testing.T) {
	ctx := context.Background()
	used := question("EASY", domain.StatusPublished, true)
	free := question("EASY", domain.StatusPublished, true)
	store, use, svc := newBank(t, used, free)
	use.inManual[used.ID] = true

	err := svc.Delete(ctx, owner, module, used.ID)
	assert.ErrorIs(t, err, ErrQuestionInUse, "delete")
	assert.Empty(t, store.deleted, "and nothing was deleted")

	_, err = svc.SetLinks(ctx, owner, module, used.ID, unlinked2, domain.StatusPublished)
	assert.ErrorIs(t, err, ErrQuestionInUse, "taken out of the assessment bank")
	_, err = svc.SetLinks(ctx, owner, module, used.ID, published, domain.StatusDraft)
	assert.ErrorIs(t, err, ErrQuestionInUse, "unpublished")
	assert.Equal(t, ExerciseLinks{}, store.links, "the links were not touched")
	assert.Empty(t, store.status)

	_, err = svc.SetLinks(ctx, owner, module, used.ID, published, domain.StatusPublished)
	assert.NoError(t, err, "a change that keeps it eligible is not a removal")
	_, err = svc.SetLinks(ctx, owner, module, used.ID, ExerciseLinks{Practice: true, Assessment: true}, domain.StatusPublished)
	assert.NoError(t, err, "linking it to the practice too keeps it in the assessment bank")

	_, err = svc.Update(ctx, owner, module, used.ID, goodInput(), nil, time.Time{}, true)
	assert.NoError(t, err, "its text may be edited")

	assert.NoError(t, svc.Delete(ctx, owner, module, free.ID), "a question that is in no assessment is free")
	assert.Equal(t, []uuid.UUID{free.ID}, store.deleted)
	_, err = svc.SetLinks(ctx, owner, module, free.ID, unlinked2, domain.StatusDraft)
	assert.NoError(t, err)
}

// Covers SPEC-075 CA-20 (RN-18): a change that leaves a level with fewer eligible questions than a SCHEDULED draw asks for is refused; a change in a
// level nobody asks for, or one that was not eligible anyway, is not.
func TestExercises_RefusesAChangeThatDropsTheStockBelowTheDraw(t *testing.T) {
	ctx := context.Background()
	hard := []ExerciseRecord{
		question("HARD", domain.StatusPublished, true), question("HARD", domain.StatusPublished, true),
		question("HARD", domain.StatusPublished, true), question("HARD", domain.StatusPublished, true),
	}
	notEligible := []ExerciseRecord{
		question("HARD", domain.StatusDraft, true),      // unpublished
		question("HARD", domain.StatusPublished, false), // outside the assessment bank
	}
	easy := question("EASY", domain.StatusPublished, true)
	store, use, svc := newBank(t, append(append(append([]ExerciseRecord{}, hard...), notEligible...), easy)...)

	use.demand = map[string]int{"HARD": 4}
	err := svc.Delete(ctx, owner, module, hard[0].ID)
	assert.ErrorIs(t, err, ErrQuestionInUse, "4 hard are eligible and the draw asks for 4: taking one leaves 3")
	_, err = svc.SetLinks(ctx, owner, module, hard[1].ID, unlinked2, domain.StatusPublished)
	assert.ErrorIs(t, err, ErrQuestionInUse)
	_, err = svc.SetLinks(ctx, owner, module, hard[2].ID, published, domain.StatusDraft)
	assert.ErrorIs(t, err, ErrQuestionInUse)
	assert.Empty(t, store.deleted)

	assert.NoError(t, svc.Delete(ctx, owner, module, notEligible[0].ID), "an unpublished question was not in the stock")
	assert.NoError(t, svc.Delete(ctx, owner, module, notEligible[1].ID), "nor one outside the assessment bank")
	assert.NoError(t, svc.Delete(ctx, owner, module, easy.ID), "nobody asks for easy questions")

	use.demand = map[string]int{"HARD": 3}
	assert.NoError(t, svc.Delete(ctx, owner, module, hard[3].ID), "4 are eligible and the draw asks for 3: one can go")

	use.demand = map[string]int{}
	_, err = svc.SetLinks(ctx, owner, module, hard[0].ID, unlinked2, domain.StatusPublished)
	assert.NoError(t, err, "with no draw in the module, nothing holds the stock")
}
