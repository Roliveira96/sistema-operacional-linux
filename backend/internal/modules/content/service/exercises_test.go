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
	usage     string
	status    string
	setups    [2]json.RawMessage
	saveCalls int
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
func (f *fakeExerciseStore) SetAvailability(_ context.Context, _, _ uuid.UUID, usage, status string, _ time.Time) (ExerciseRecord, error) {
	f.usage, f.status = usage, status
	return f.record, nil
}
func (f *fakeExerciseStore) DeleteExercise(context.Context, uuid.UUID, uuid.UUID, time.Time) error { return nil }
func (f *fakeExerciseStore) ReorderExercises(context.Context, uuid.UUID, []OrderItem, time.Time) error {
	return nil
}
func (f *fakeExerciseStore) ExerciseSetups(context.Context, uuid.UUID) (json.RawMessage, json.RawMessage, error) {
	return f.setups[0], f.setups[1], nil
}
func (f *fakeExerciseStore) SaveExerciseSetups(_ context.Context, _ uuid.UUID, exercises, assessment json.RawMessage) error {
	f.saveCalls++
	f.setups = [2]json.RawMessage{exercises, assessment}
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
	_, err = svc.Create(ctx, Actor{UserID: uuid.New(), Role: "STUDENT"}, module, goodInput())
	assert.ErrorIs(t, err, ErrForbidden)
	store.missing = true
	_, err = svc.List(ctx, owner, module)
	assert.ErrorIs(t, err, ErrModuleNotFound)
}

// Covers SPEC-023 RN-03, RN-05: a new exercise is a draft reserved for assessment, with its author, and the conditions in both forms.
func TestExercises_Create(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	_, err := svc.Create(context.Background(), owner, module, goodInput())
	require.NoError(t, err)
	q := store.created
	require.NotNil(t, q)
	assert.Equal(t, domain.KindPractical, q.Kind)
	assert.Equal(t, domain.UsageAssessment, q.Usage)
	assert.Equal(t, domain.StatusDraft, q.Status)
	assert.Equal(t, owner.UserID, *q.CreatedBy)
	assert.JSONEq(t, `[{"type":"DIRECTORY_EXISTS","path":"/a"}]`, string(q.ValidationConditions))
	assert.JSONEq(t, `[{"kind":"DIR_EXISTS","path":"/a"}]`, string(q.EndConditions))
	assert.Nil(t, q.ScenarioID, "its machine is made of the layers of the module")
	assert.False(t, q.ContinuesPrevious)

	in := goodInput()
	in.ContinuesPrevious = true
	_, err = svc.Create(context.Background(), owner, module, in)
	require.NoError(t, err)
	assert.True(t, store.created.ContinuesPrevious, "RN-11")

	_, err = svc.Create(context.Background(), owner, module, domain.ExerciseInput{Title: "", Difficulty: "EASY"})
	var perr *domain.PayloadError
	assert.True(t, errors.As(err, &perr))
}

// Covers SPEC-023 CA-08: the guard is the instant the editor knew, unless the teacher chose to write over.
func TestExercises_UpdateGuard(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	known := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	_, err := svc.Update(context.Background(), owner, module, uuid.New(), goodInput(), known, false)
	require.NoError(t, err)
	require.NotNil(t, store.expected)
	assert.True(t, store.expected.Equal(known))
	assert.Equal(t, owner.UserID, store.updated.By)

	_, err = svc.Update(context.Background(), owner, module, uuid.New(), goodInput(), known, true)
	require.NoError(t, err)
	assert.Nil(t, store.expected, "force writes over")
}

// Covers SPEC-023 RN-04: an exercise that nobody could finish cannot be published.
func TestExercises_Availability(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID, record: ExerciseRecord{Question: domain.Question{ValidationConditions: json.RawMessage(`[]`)}}}
	svc := exerciseService(store)
	ctx := context.Background()

	_, err := svc.SetAvailability(ctx, owner, module, uuid.New(), domain.UsageExercise, domain.StatusPublished)
	assert.ErrorIs(t, err, ErrExerciseIncomplete)
	_, err = svc.SetAvailability(ctx, owner, module, uuid.New(), domain.UsageExercise, domain.StatusDraft)
	require.NoError(t, err, "a draft may be available while it is written")
	assert.Equal(t, domain.UsageExercise, store.usage)

	store.record.ValidationConditions = json.RawMessage(`[{"type":"FILE_EXISTS","path":"/a"}]`)
	_, err = svc.SetAvailability(ctx, owner, module, uuid.New(), domain.UsageAssessment, domain.StatusPublished)
	require.NoError(t, err)
	assert.Equal(t, domain.StatusPublished, store.status)

	_, err = svc.SetAvailability(ctx, owner, module, uuid.New(), "OTHER", domain.StatusDraft)
	assert.ErrorIs(t, err, ErrInvalidAvailability)
	_, err = svc.SetAvailability(ctx, owner, module, uuid.New(), domain.UsageExercise, "ARCHIVED")
	assert.ErrorIs(t, err, ErrInvalidAvailability)
}

// Covers SPEC-023 RN-06: each set has its snapshot, checked with the rules of the snapshots, and the errors name the set.
func TestExercises_Setups(t *testing.T) {
	store := &fakeExerciseStore{owner: owner.UserID}
	svc := exerciseService(store)
	ctx := context.Background()

	exercises, assessment, err := svc.SetSetups(ctx, owner, module, json.RawMessage(`{"steps":[{"command":" mkdir /a "}]}`), nil)
	require.NoError(t, err)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /a"}]}`, string(exercises))
	assert.Nil(t, assessment, "a missing snapshot is removed")

	_, _, err = svc.SetSetups(ctx, owner, module, nil, json.RawMessage(`{"steps":[{"command":""}]}`))
	var perr *domain.PayloadError
	require.True(t, errors.As(err, &perr))
	assert.Equal(t, "assessmentSetup.steps[0].command", perr.Fields[0].Field)
	assert.Equal(t, 1, store.saveCalls, "nothing was written for the invalid one")
}
