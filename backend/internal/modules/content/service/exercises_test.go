package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

type fakeExerciseStore struct {
	owner     uuid.UUID
	missing   bool
	record    ExerciseRecord
	created   *domain.Question
	updated   ExerciseUpdate
	expected  *time.Time
	links     ExerciseLinks
	status    string
	setup     json.RawMessage
	saveCalls int
	// validDependency is what the store answers about a dependency; dependencyAsked is what it was asked.
	validDependency bool
	dependencyAsked *uuid.UUID
}

func (f *fakeExerciseStore) ModuleTeacher(context.Context, uuid.UUID) (uuid.UUID, error) {
	if f.missing {
		return uuid.Nil, ErrNotFound
	}
	return f.owner, nil
}
func (f *fakeExerciseStore) ListExercises(context.Context, uuid.UUID) ([]ExerciseRecord, error) {
	return []ExerciseRecord{f.record}, nil
}
func (f *fakeExerciseStore) FindExercise(context.Context, uuid.UUID, uuid.UUID) (ExerciseRecord, error) {
	if f.created != nil {
		return ExerciseRecord{Question: *f.created}, nil
	}
	return f.record, nil
}
func (f *fakeExerciseStore) CreateExercise(_ context.Context, q *domain.Question) error {
	f.created = q
	return nil
}
func (f *fakeExerciseStore) UpdateExercise(_ context.Context, _, _ uuid.UUID, upd ExerciseUpdate, expected *time.Time) (ExerciseRecord, error) {
	f.updated, f.expected = upd, expected
	return f.record, nil
}
func (f *fakeExerciseStore) SetLinks(_ context.Context, _, _ uuid.UUID, links ExerciseLinks, status string, _ time.Time) (ExerciseRecord, error) {
	f.links, f.status = links, status
	return f.record, nil
}
func (f *fakeExerciseStore) DeleteExercise(context.Context, uuid.UUID, uuid.UUID, time.Time) error { return nil }
func (f *fakeExerciseStore) ReorderExercises(context.Context, uuid.UUID, []OrderItem, time.Time) error {
	return nil
}
func (f *fakeExerciseStore) ValidDependency(_ context.Context, _ uuid.UUID, _ *uuid.UUID, dependsOn uuid.UUID) (bool, error) {
	f.dependencyAsked = &dependsOn
	return f.validDependency, nil
}
func (f *fakeExerciseStore) BankSetup(context.Context, uuid.UUID) (json.RawMessage, error) {
	return f.setup, nil
}
func (f *fakeExerciseStore) SaveBankSetup(_ context.Context, _ uuid.UUID, setup json.RawMessage) error {
	f.saveCalls++
	f.setup = setup
	return nil
}

func exerciseService(store *fakeExerciseStore) *Exercises {
	return NewExercises(store, zap.NewNop())
}

var (
	owner  = Actor{UserID: uuid.New(), Role: "TEACHER"}
	module = uuid.New()
)

func goodInput() domain.ExerciseInput {
	return domain.ExerciseInput{Title: "Criar", Difficulty: "EASY", Conditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`)}
}

// Covers SPEC-023 RN-02: only the teacher who owns the module, or an administrator, touches its exercises.
func TestExercises_Authorization(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	ctx := context.Background()

	_, err := svc.List(ctx, Actor{UserID: uuid.New(), Role: "TEACHER"}, module)
	assert.ErrorIs(t, err, ErrForbidden)
	_, err = svc.List(ctx, Actor{UserID: uuid.New(), Role: "ADMIN"}, module)
	assert.NoError(t, err)
	_, err = svc.Create(ctx, Actor{UserID: uuid.New(), Role: "STUDENT"}, module, goodInput(), nil, ExerciseLinks{})
	assert.ErrorIs(t, err, ErrForbidden)
	store.missing = true
	_, err = svc.List(ctx, owner, module)
	assert.ErrorIs(t, err, ErrModuleNotFound)
}

// Covers SPEC-023 11.1: a new exercise is a draft in the bank, with the links it came with and its author, and the conditions in both forms.
func TestExercises_Create(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	_, err := svc.Create(context.Background(), owner, module, goodInput(), nil, ExerciseLinks{})
	require.NoError(t, err)
	q := store.created
	require.NotNil(t, q)
	assert.Equal(t, domain.KindPractical, q.Kind)
	assert.Equal(t, domain.UsageAssessment, q.Usage, "not in the practice")
	assert.False(t, q.InAssessment, "not linked to anything")
	assert.Equal(t, domain.StatusDraft, q.Status)
	assert.Equal(t, owner.UserID, *q.CreatedBy)
	assert.JSONEq(t, `[{"type":"DIRECTORY_EXISTS","path":"/a"}]`, string(q.ValidationConditions))
	assert.JSONEq(t, `[{"kind":"DIR_EXISTS","path":"/a"}]`, string(q.EndConditions))
	assert.Nil(t, q.ScenarioID, "its machine is made of the layers of the module")

	// Created from a block of the screen, it comes linked to it.
	_, err = svc.Create(context.Background(), owner, module, goodInput(), nil, ExerciseLinks{Practice: true, Assessment: true})
	require.NoError(t, err)
	assert.Equal(t, domain.UsageExercise, store.created.Usage)
	assert.True(t, store.created.InAssessment)

	_, err = svc.Create(context.Background(), owner, module, domain.ExerciseInput{Title: "", Difficulty: "EASY"}, nil, ExerciseLinks{})
	var perr *domain.PayloadError
	assert.True(t, errors.As(err, &perr))
	_, err = svc.Create(context.Background(), owner, module, goodInput(), nil, ExerciseLinks{Practice: true, Assessment: true, Exclusive: true})
	assert.ErrorIs(t, err, ErrInvalidLinks, "an exclusive exercise is not in the practice")
}

// Covers SPEC-023 D-16: the exercise it depends on must be one of the module and close no cycle.
func TestExercises_Dependency(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	ctx := context.Background()
	before := uuid.New()

	_, err := svc.Create(ctx, owner, module, goodInput(), &before, ExerciseLinks{})
	assert.ErrorIs(t, err, ErrInvalidDependency)
	assert.Nil(t, store.created, "nothing was written")
	_, err = svc.Update(ctx, owner, module, uuid.New(), goodInput(), &before, time.Now(), false)
	assert.ErrorIs(t, err, ErrInvalidDependency)

	store.validDependency = true
	_, err = svc.Create(ctx, owner, module, goodInput(), &before, ExerciseLinks{})
	require.NoError(t, err)
	assert.Equal(t, before, *store.created.DependsOn)
	_, err = svc.Update(ctx, owner, module, uuid.New(), goodInput(), &before, time.Now(), false)
	require.NoError(t, err)
	assert.Equal(t, &before, store.updated.DependsOn)

	// No dependency needs no question to the store.
	store.dependencyAsked = nil
	_, err = svc.Update(ctx, owner, module, uuid.New(), goodInput(), nil, time.Now(), false)
	require.NoError(t, err)
	assert.Nil(t, store.dependencyAsked)
}

// Covers SPEC-023 CA-08: the guard is the instant the editor knew, unless the teacher chose to write over.
func TestExercises_UpdateGuard(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	known := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	_, err := svc.Update(context.Background(), owner, module, uuid.New(), goodInput(), nil, known, false)
	require.NoError(t, err)
	require.NotNil(t, store.expected)
	assert.True(t, store.expected.Equal(known))
	assert.Equal(t, owner.UserID, store.updated.By)

	_, err = svc.Update(context.Background(), owner, module, uuid.New(), goodInput(), nil, known, true)
	require.NoError(t, err)
	assert.Nil(t, store.expected, "force writes over")
}

// Covers SPEC-023 RN-04, 11.1: links never remove an exercise from the bank, an exclusive one is in the assessment only, and an
// exercise that nobody could finish cannot be published.
func TestExercises_Links(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID, record: ExerciseRecord{Question: domain.Question{ValidationConditions: json.RawMessage(`[]`)}}}
	svc := exerciseService(store)
	ctx := context.Background()
	both := ExerciseLinks{Practice: true, Assessment: true}

	_, err := svc.SetLinks(ctx, owner, module, uuid.New(), both, domain.StatusPublished)
	assert.ErrorIs(t, err, ErrExerciseIncomplete)
	_, err = svc.SetLinks(ctx, owner, module, uuid.New(), both, domain.StatusDraft)
	require.NoError(t, err, "a draft may be linked while it is written")
	assert.Equal(t, both, store.links)

	store.record.ValidationConditions = json.RawMessage(`[{"type":"FILE_EXISTS","path":"/a"}]`)
	_, err = svc.SetLinks(ctx, owner, module, uuid.New(), ExerciseLinks{Assessment: true, Exclusive: true}, domain.StatusPublished)
	require.NoError(t, err)
	assert.Equal(t, domain.StatusPublished, store.status)
	_, err = svc.SetLinks(ctx, owner, module, uuid.New(), ExerciseLinks{}, domain.StatusDraft)
	require.NoError(t, err, "unlinked from everything, it stays in the bank")

	_, err = svc.SetLinks(ctx, owner, module, uuid.New(), ExerciseLinks{Practice: true, Exclusive: true}, domain.StatusDraft)
	assert.ErrorIs(t, err, ErrInvalidLinks)
	_, err = svc.SetLinks(ctx, owner, module, uuid.New(), ExerciseLinks{Assessment: true}, "ARCHIVED")
	assert.ErrorIs(t, err, ErrInvalidStatus)
}

// Covers SPEC-023 11.2: one snapshot for the whole bank, checked with the rules of the snapshots, and the errors name it.
func TestExercises_BankSetup(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	ctx := context.Background()

	setup, err := svc.SetBankSetup(ctx, owner, module, json.RawMessage(`{"steps":[{"command":" mkdir /a "}]}`))
	require.NoError(t, err)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /a"}]}`, string(setup))

	cleared, err := svc.SetBankSetup(ctx, owner, module, nil)
	require.NoError(t, err)
	assert.Nil(t, cleared, "a missing snapshot is removed")
	assert.Nil(t, store.setup)

	_, err = svc.SetBankSetup(ctx, owner, module, json.RawMessage(`{"steps":[{"command":""}]}`))
	var perr *domain.PayloadError
	require.True(t, errors.As(err, &perr))
	assert.Equal(t, "bankSetup.steps[0].command", perr.Fields[0].Field)
	assert.Equal(t, 2, store.saveCalls, "nothing was written for the invalid one")
}
