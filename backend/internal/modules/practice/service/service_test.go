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

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
)

const emptyMachine = `{"formato":"exame-so/maquina","versao":1,"hostname":"h","contas":{"usuarios":[],"grupos":[]},` +
	`"raiz":{"nome":"","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","filhos":[]}}`

const solvedMachine = `{"formato":"exame-so/maquina","versao":1,"hostname":"h","contas":{"usuarios":[],"grupos":[]},` +
	`"raiz":{"nome":"","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","filhos":[` +
	`{"nome":"a","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","filhos":[]}]}}`

type fakeContent struct {
	err      error
	topic    json.RawMessage
	items    []contentservice.PracticeItem
	itemsErr error
}

func (f fakeContent) TopicScenario(context.Context, uuid.UUID, contentservice.Viewer) (json.RawMessage, error) {
	return f.topic, f.err
}

func (f fakeContent) ModulePracticeItems(context.Context, uuid.UUID, contentservice.Viewer) ([]contentservice.PracticeItem, error) {
	return f.items, f.itemsErr
}

func (f fakeContent) PracticeItem(_ context.Context, id uuid.UUID, _ contentservice.Viewer) (contentservice.PracticeItem, error) {
	if f.err != nil {
		return contentservice.PracticeItem{}, f.err
	}
	return contentservice.PracticeItem{
		QuestionID: id, Snapshot: json.RawMessage(emptyMachine),
		Conditions: []contentdomain.Condition{{Type: contentdomain.CondDirectoryExists, Path: "/a"}},
	}, nil
}

type fakeStore struct {
	rows    map[[2]uuid.UUID]domain.Progress
	findErr error
	saveErr error
	listErr error
	saves   int
}

func (f *fakeStore) FindProgress(_ context.Context, user, question uuid.UUID) (domain.Progress, error) {
	if f.findErr != nil {
		return domain.Progress{}, f.findErr
	}
	p, ok := f.rows[[2]uuid.UUID{user, question}]
	if !ok {
		return domain.Progress{}, ErrNotFound
	}
	return p, nil
}

func (f *fakeStore) SaveProgress(_ context.Context, p *domain.Progress) error {
	if f.saveErr != nil {
		return f.saveErr
	}
	f.saves++
	f.rows[[2]uuid.UUID{p.UserID, p.QuestionID}] = *p
	return nil
}

func (f *fakeStore) ListModuleProgress(_ context.Context, user, _ uuid.UUID) ([]domain.Progress, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	var out []domain.Progress
	for k, v := range f.rows {
		if k[0] == user {
			out = append(out, v)
		}
	}
	return out, nil
}

func newService(content Content) (*Service, *fakeStore) {
	store := &fakeStore{rows: map[[2]uuid.UUID]domain.Progress{}}
	svc := New(content, store)
	svc.now = func() time.Time { return time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC) }
	return svc, store
}

func student() contentservice.Viewer {
	id := uuid.New()
	return contentservice.Viewer{UserID: &id, Role: "STUDENT"}
}

// Covers SPEC-014 CA-02 (service side).
func TestScenarioReturnsOnlyTheSnapshot(t *testing.T) {
	svc, _ := newService(fakeContent{})
	snap, err := svc.Scenario(context.Background(), uuid.New(), contentservice.Viewer{})
	require.NoError(t, err)
	assert.JSONEq(t, emptyMachine, string(snap))
	assert.NotContains(t, string(snap), "DIRECTORY_EXISTS")

	svc, _ = newService(fakeContent{err: contentservice.ErrQuestionNotFound})
	_, err = svc.Scenario(context.Background(), uuid.New(), contentservice.Viewer{})
	assert.ErrorIs(t, err, contentservice.ErrQuestionNotFound)
}

// Covers SPEC-014 CA-03 and CA-04 (service side).
func TestCheckGradesAndRecordsProgress(t *testing.T) {
	svc, store := newService(fakeContent{})
	v := student()
	q := uuid.New()

	r, err := svc.Check(context.Background(), q, v, json.RawMessage(emptyMachine))
	require.NoError(t, err)
	assert.False(t, r.Passed)
	assert.Nil(t, r.CompletedAt)

	r, err = svc.Check(context.Background(), q, v, json.RawMessage(solvedMachine))
	require.NoError(t, err)
	assert.True(t, r.Passed)
	require.NotNil(t, r.CompletedAt)

	r, err = svc.Check(context.Background(), q, v, json.RawMessage(emptyMachine))
	require.NoError(t, err)
	assert.False(t, r.Passed)
	assert.NotNil(t, r.CompletedAt, "a later failure keeps the completion")
	assert.Equal(t, 3, store.rows[[2]uuid.UUID{*v.UserID, q}].Attempts)

	rows, err := svc.ModuleProgress(context.Background(), *v.UserID, uuid.New())
	require.NoError(t, err)
	assert.Len(t, rows, 1)
}

// Covers SPEC-014 CA-05 and CA-07 (service side).
func TestCheckRejectsInvalidInput(t *testing.T) {
	svc, store := newService(fakeContent{})
	_, err := svc.Check(context.Background(), uuid.New(), contentservice.Viewer{}, json.RawMessage(solvedMachine))
	assert.ErrorIs(t, err, contentservice.ErrAuthRequired)

	for _, bad := range []string{`{}`, `[1]`, `{"formato":"exame-so/maquina","versao":2}`, `not json`} {
		_, err := svc.Check(context.Background(), uuid.New(), student(), json.RawMessage(bad))
		assert.ErrorIs(t, err, ErrInvalidSnapshot, bad)
	}

	svc, _ = newService(fakeContent{err: contentservice.ErrForbidden})
	_, err = svc.Check(context.Background(), uuid.New(), student(), json.RawMessage(solvedMachine))
	assert.ErrorIs(t, err, contentservice.ErrForbidden)

	svc, store = newService(fakeContent{})
	store.findErr = errors.New("db down")
	_, err = svc.Check(context.Background(), uuid.New(), student(), json.RawMessage(solvedMachine))
	assert.EqualError(t, err, "db down")
	store.findErr, store.saveErr = nil, errors.New("disk full")
	_, err = svc.Check(context.Background(), uuid.New(), student(), json.RawMessage(solvedMachine))
	assert.ErrorContains(t, err, "disk full")
}

type invalidContent struct{ fakeContent }

func (invalidContent) PracticeItem(_ context.Context, id uuid.UUID, _ contentservice.Viewer) (contentservice.PracticeItem, error) {
	return contentservice.PracticeItem{QuestionID: id}, nil
}

func TestCheckWithoutConditionsIsAnError(t *testing.T) {
	svc, _ := newService(invalidContent{})
	_, err := svc.Check(context.Background(), uuid.New(), student(), json.RawMessage(solvedMachine))
	assert.ErrorIs(t, err, contentdomain.ErrInvalidConditions)
}

// Covers SPEC-016 5.1 (service side).
func TestTopicScenarioIsPassedThrough(t *testing.T) {
	svc, _ := newService(fakeContent{topic: json.RawMessage(emptyMachine)})
	got, err := svc.TopicScenario(context.Background(), uuid.New(), contentservice.Viewer{})
	require.NoError(t, err)
	assert.JSONEq(t, emptyMachine, string(got))
}

func moduleItems() (uuid.UUID, uuid.UUID, fakeContent) {
	solvable, unsolved := uuid.New(), uuid.New()
	return solvable, unsolved, fakeContent{items: []contentservice.PracticeItem{
		{QuestionID: solvable, Conditions: []contentdomain.Condition{{Type: contentdomain.CondDirectoryExists, Path: "/a"}}},
		{QuestionID: unsolved, Conditions: []contentdomain.Condition{{Type: contentdomain.CondDirectoryExists, Path: "/b"}}},
	}}
}

// Covers SPEC-016 CA-04 and RN-01 (service side).
func TestCheckModuleRecordsApprovalsWithoutAttempts(t *testing.T) {
	ctx := context.Background()
	solvable, unsolved, content := moduleItems()
	svc, store := newService(content)
	v := student()

	result, err := svc.CheckModule(ctx, uuid.New(), v, json.RawMessage(solvedMachine))
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{solvable}, result.Passed)
	require.Len(t, result.Progress, 1)
	saved := store.rows[[2]uuid.UUID{*v.UserID, solvable}]
	assert.Equal(t, 0, saved.Attempts, "the automatic check never counts attempts")
	require.NotNil(t, saved.CompletedAt)
	_, recorded := store.rows[[2]uuid.UUID{*v.UserID, unsolved}]
	assert.False(t, recorded, "failures are not recorded")

	// A later check keeps the first approval and writes nothing.
	svc.now = func() time.Time { return time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC) }
	_, err = svc.CheckModule(ctx, uuid.New(), v, json.RawMessage(solvedMachine))
	require.NoError(t, err)
	assert.Equal(t, 1, store.saves)
	assert.Equal(t, saved.CompletedAt, store.rows[[2]uuid.UUID{*v.UserID, solvable}].CompletedAt)

	result, err = svc.CheckModule(ctx, uuid.New(), v, json.RawMessage(emptyMachine))
	require.NoError(t, err)
	assert.Empty(t, result.Passed)
}

func TestCheckModuleRejectsInvalidInput(t *testing.T) {
	ctx := context.Background()
	_, _, content := moduleItems()
	boom := errors.New("boom")

	svc, _ := newService(content)
	_, err := svc.CheckModule(ctx, uuid.New(), contentservice.Viewer{}, json.RawMessage(solvedMachine))
	assert.ErrorIs(t, err, contentservice.ErrAuthRequired)

	_, err = svc.CheckModule(ctx, uuid.New(), student(), json.RawMessage(`{"formato":"x"}`))
	assert.ErrorIs(t, err, ErrInvalidSnapshot)

	svc, _ = newService(fakeContent{itemsErr: contentservice.ErrForbidden})
	_, err = svc.CheckModule(ctx, uuid.New(), student(), json.RawMessage(solvedMachine))
	assert.ErrorIs(t, err, contentservice.ErrForbidden)

	svc, _ = newService(fakeContent{items: []contentservice.PracticeItem{{QuestionID: uuid.New()}}})
	_, err = svc.CheckModule(ctx, uuid.New(), student(), json.RawMessage(solvedMachine))
	assert.ErrorIs(t, err, contentdomain.ErrInvalidConditions)

	for _, broken := range []func(*fakeStore){
		func(s *fakeStore) { s.findErr = boom },
		func(s *fakeStore) { s.saveErr = boom },
		func(s *fakeStore) { s.listErr = boom },
	} {
		svc, store := newService(content)
		broken(store)
		_, err = svc.CheckModule(ctx, uuid.New(), student(), json.RawMessage(solvedMachine))
		assert.ErrorIs(t, err, boom)
	}
}
