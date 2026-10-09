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

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
)

type fakeAccess struct {
	owner     uuid.UUID
	sourceKey *string
	err       error
	seen      cmservice.UserAccessContext
}

func (f *fakeAccess) GetModuleByID(_ context.Context, _ uuid.UUID, u cmservice.UserAccessContext) (cmrepository.ModuleDetails, error) {
	f.seen = u
	if f.err != nil {
		return cmrepository.ModuleDetails{}, f.err
	}
	return cmrepository.ModuleDetails{Module: cmdomain.CourseModule{TeacherID: f.owner, SourceKey: f.sourceKey}}, nil
}

type fakeReadStore struct {
	questions     []domain.Question
	includeDrafts bool
	usage         string
	question      *domain.Question
	scenario      *domain.Scenario
	findErr       error
	keys          map[string]domain.Scenario
	keyErr        error
	askedKey      string
	blocks        []domain.ContentBlock
	setup         json.RawMessage
}

func (f *fakeReadStore) FindScenarioBySourceKey(_ context.Context, key string) (domain.Scenario, error) {
	f.askedKey = key
	if f.keyErr != nil {
		return domain.Scenario{}, f.keyErr
	}
	s, ok := f.keys[key]
	if !ok {
		return domain.Scenario{}, ErrNotFound
	}
	return s, nil
}

func (f *fakeReadStore) FindQuestion(context.Context, uuid.UUID) (domain.Question, error) {
	if f.findErr != nil {
		return domain.Question{}, f.findErr
	}
	if f.question == nil {
		return domain.Question{}, ErrNotFound
	}
	return *f.question, nil
}

func (f *fakeReadStore) FindScenario(context.Context, uuid.UUID) (domain.Scenario, error) {
	if f.scenario == nil {
		return domain.Scenario{}, ErrNotFound
	}
	return *f.scenario, nil
}

func (f *fakeReadStore) ModuleSetup(context.Context, uuid.UUID) (json.RawMessage, error) {
	return f.setup, nil
}

func (f *fakeReadStore) ListBlocks(context.Context, uuid.UUID) ([]domain.ContentBlock, error) {
	if f.blocks != nil {
		return f.blocks, nil
	}
	return []domain.ContentBlock{{Position: 1, BlockType: domain.BlockText}}, nil
}

func (f *fakeReadStore) ListQuestions(_ context.Context, _ uuid.UUID, usage string, includeDrafts bool) ([]domain.Question, error) {
	f.includeDrafts, f.usage = includeDrafts, usage
	return f.questions, nil
}

func (f *fakeReadStore) ListActiveTemplates(context.Context) ([]TemplateSummary, error) {
	return []TemplateSummary{{Title: "Quiz", QuestionCount: 30}}, nil
}

func (f *fakeReadStore) SaveBlockProgress(_ context.Context, userID, blockID uuid.UUID, completed bool) (domain.BlockProgress, error) {
	return domain.BlockProgress{UserID: userID, BlockID: blockID}, nil
}

func (f *fakeReadStore) ListModuleBlockProgress(_ context.Context, _, _ uuid.UUID) ([]domain.BlockProgress, error) {
	return nil, nil
}

func secretQuestions() []domain.Question {
	return []domain.Question{
		{Kind: domain.KindPractical, Title: "P", Statement: "s", Status: domain.StatusPublished,
			ValidationConditions: json.RawMessage(`[{"type":"FILE_EXISTS","path":"/a"}]`), ReferenceSolution: json.RawMessage(`[]`)},
		{Kind: domain.KindTheoreticalSingle, Title: "T", Statement: "s", Status: domain.StatusDraft,
			Choices: json.RawMessage(`["a","b"]`), AnswerKey: json.RawMessage(`{"correct":1}`), Explanation: str("why")},
	}
}

func str(s string) *string { return &s }

// Covers SPEC-012 CA-04 and RN-02 (service side).
func TestQuestionsNeverExposeAnswers(t *testing.T) {
	store := &fakeReadStore{questions: secretQuestions()}
	r := NewReader(&fakeAccess{}, store)
	qs, err := r.Questions(context.Background(), uuid.New(), domain.UsageExercise, Viewer{})
	require.NoError(t, err)
	assert.False(t, store.includeDrafts, "CA-05: visitors never see drafts")
	assert.Equal(t, domain.UsageExercise, store.usage)

	raw, err := json.Marshal(qs)
	require.NoError(t, err)
	for _, secret := range []string{"FILE_EXISTS", "correct", "why", "referenceSolution", "validationConditions", "answerKey", "explanation"} {
		assert.NotContains(t, string(raw), secret)
	}
	assert.Nil(t, qs[0].Choices, "practical questions have no choices")
	assert.JSONEq(t, `["a","b"]`, string(qs[1].Choices))
}

// Covers SPEC-012 CA-06.
func TestTeacherQuestionsAreForOwnersAndAdmins(t *testing.T) {
	owner := uuid.New()
	store := &fakeReadStore{questions: secretQuestions()}
	r := NewReader(&fakeAccess{owner: owner}, store)

	qs, err := r.TeacherQuestions(context.Background(), uuid.New(), Viewer{UserID: &owner, Role: "TEACHER"})
	require.NoError(t, err)
	assert.True(t, store.includeDrafts)
	assert.Equal(t, domain.StatusDraft, qs[1].Status)
	assert.JSONEq(t, `{"correct":1}`, string(qs[1].AnswerKey))

	_, err = r.TeacherQuestions(context.Background(), uuid.New(), Viewer{UserID: ptr(uuid.New()), Role: "ADMIN"})
	require.NoError(t, err)
	_, err = r.TeacherQuestions(context.Background(), uuid.New(), Viewer{UserID: ptr(uuid.New()), Role: "TEACHER"})
	assert.ErrorIs(t, err, ErrForbidden)
}

func ptr(id uuid.UUID) *uuid.UUID { return &id }

// Covers SPEC-012 CA-03 and RN-01 (error mapping).
func TestVisibilityErrorsAreMapped(t *testing.T) {
	cases := []struct {
		err    error
		viewer Viewer
		want   error
	}{
		{cmdomain.ErrModuleNotFound, Viewer{}, ErrModuleNotFound},
		{cmdomain.ErrModuleInactive, Viewer{}, ErrModuleNotFound},
		{cmdomain.ErrModuleExpired, Viewer{}, ErrModuleNotFound},
		{cmdomain.ErrForbidden, Viewer{}, ErrAuthRequired},
		{cmdomain.ErrForbidden, Viewer{UserID: ptr(uuid.New()), Role: "STUDENT"}, ErrForbidden},
	}
	for _, tc := range cases {
		r := NewReader(&fakeAccess{err: tc.err}, &fakeReadStore{})
		_, err := r.Blocks(context.Background(), uuid.New(), tc.viewer)
		assert.ErrorIs(t, err, tc.want, tc.err.Error())
		_, err = r.Questions(context.Background(), uuid.New(), "", tc.viewer)
		assert.ErrorIs(t, err, tc.want)
		_, err = r.TeacherQuestions(context.Background(), uuid.New(), tc.viewer)
		assert.ErrorIs(t, err, tc.want)
	}
	other := errors.New("db down")
	_, err := NewReader(&fakeAccess{err: other}, &fakeReadStore{}).Blocks(context.Background(), uuid.New(), Viewer{})
	assert.ErrorIs(t, err, other)
}

func TestBlocksTemplatesAndRoles(t *testing.T) {
	access := &fakeAccess{}
	r := NewReader(access, &fakeReadStore{})
	blocks, err := r.Blocks(context.Background(), uuid.New(), Viewer{UserID: ptr(uuid.New()), Role: "STUDENT"})
	require.NoError(t, err)
	assert.Len(t, blocks, 1)
	assert.True(t, access.seen.IsStudent)

	ts, err := r.Templates(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 30, ts[0].QuestionCount)
}

func practical() domain.Question {
	scenario := uuid.New()
	return domain.Question{ID: uuid.New(), ModuleID: uuid.New(), Kind: domain.KindPractical, Usage: domain.UsageExercise,
		Status: domain.StatusPublished, ScenarioID: &scenario,
		ValidationConditions: json.RawMessage(`[{"type":"DIRECTORY_EXISTS","path":"/a"}]`)}
}

// Covers SPEC-014 RN-01 and RN-05 (content side).
func TestPracticeItem(t *testing.T) {
	q := practical()
	store := &fakeReadStore{question: &q, scenario: &domain.Scenario{Snapshot: json.RawMessage(`{"formato":"exame-so/maquina"}`)}}
	item, err := NewReader(&fakeAccess{}, store).PracticeItem(context.Background(), q.ID, Viewer{})
	require.NoError(t, err)
	assert.Equal(t, q.ModuleID, item.ModuleID)
	assert.JSONEq(t, `{"formato":"exame-so/maquina"}`, string(item.Snapshot))
	assert.Equal(t, domain.CondDirectoryExists, item.Conditions[0].Type)

	for name, mutate := range map[string]func(*domain.Question){
		"theoretical": func(q *domain.Question) { q.Kind = domain.KindTheoreticalSingle },
		"assessment":  func(q *domain.Question) { q.Usage = domain.UsageAssessment },
		"draft":       func(q *domain.Question) { q.Status = domain.StatusDraft },
		"no scenario": func(q *domain.Question) { q.ScenarioID = nil },
	} {
		bad := practical()
		mutate(&bad)
		_, err := NewReader(&fakeAccess{}, &fakeReadStore{question: &bad}).PracticeItem(context.Background(), bad.ID, Viewer{})
		assert.ErrorIs(t, err, ErrQuestionNotFound, name)
	}

	_, err = NewReader(&fakeAccess{}, &fakeReadStore{}).PracticeItem(context.Background(), uuid.New(), Viewer{})
	assert.ErrorIs(t, err, ErrQuestionNotFound)
	_, err = NewReader(&fakeAccess{err: cmdomain.ErrForbidden}, &fakeReadStore{question: &q}).PracticeItem(context.Background(), q.ID, Viewer{})
	assert.ErrorIs(t, err, ErrAuthRequired)
	_, err = NewReader(&fakeAccess{}, &fakeReadStore{findErr: errors.New("db down")}).PracticeItem(context.Background(), q.ID, Viewer{})
	assert.EqualError(t, err, "db down")
	_, err = NewReader(&fakeAccess{}, &fakeReadStore{question: &q}).PracticeItem(context.Background(), q.ID, Viewer{})
	assert.ErrorIs(t, err, ErrNotFound, "missing scenario surfaces as an error")
	broken := practical()
	broken.ValidationConditions = json.RawMessage(`{`)
	_, err = NewReader(&fakeAccess{}, &fakeReadStore{question: &broken, scenario: &domain.Scenario{}}).PracticeItem(context.Background(), broken.ID, Viewer{})
	assert.Error(t, err)
}

// Covers SPEC-016 P-02: training exercises carry their solution; assessments never.
func TestPracticalExercisesExposeTheirSolution(t *testing.T) {
	solution := json.RawMessage(`[{"command":"mkdir /a"}]`)
	store := &fakeReadStore{questions: []domain.Question{
		{Kind: domain.KindPractical, Usage: domain.UsageExercise, Status: domain.StatusPublished, ReferenceSolution: solution},
		{Kind: domain.KindPractical, Usage: domain.UsageAssessment, Status: domain.StatusPublished, ReferenceSolution: solution},
	}}
	qs, err := NewReader(&fakeAccess{}, store).Questions(context.Background(), uuid.New(), "", Viewer{})
	require.NoError(t, err)
	assert.JSONEq(t, string(solution), string(qs[0].Solution))
	assert.Nil(t, qs[1].Solution)
}

// Covers SPEC-016 5.1 and CA-02 (service side).
func TestTopicScenario(t *testing.T) {
	ctx := context.Background()
	key := "diretorios"
	machine := json.RawMessage(`{"formato":"exame-so/maquina"}`)
	store := &fakeReadStore{keys: map[string]domain.Scenario{"scenario/topic/diretorios": {Snapshot: machine}}}

	got, err := NewReader(&fakeAccess{sourceKey: &key}, store).TopicScenario(ctx, uuid.New(), Viewer{})
	require.NoError(t, err)
	assert.JSONEq(t, string(machine), string(got))
	assert.Equal(t, "scenario/topic/diretorios", store.askedKey)

	other := "sem-cenario"
	got, err = NewReader(&fakeAccess{sourceKey: &other}, store).TopicScenario(ctx, uuid.New(), Viewer{})
	require.NoError(t, err)
	assert.Nil(t, got, "a module without a topic machine uses the default one")

	got, err = NewReader(&fakeAccess{}, store).TopicScenario(ctx, uuid.New(), Viewer{})
	require.NoError(t, err)
	assert.Nil(t, got, "modules created by the teacher have no source key")

	boom := errors.New("db down")
	_, err = NewReader(&fakeAccess{sourceKey: &key}, &fakeReadStore{keyErr: boom}).TopicScenario(ctx, uuid.New(), Viewer{})
	assert.ErrorIs(t, err, boom)

	_, err = NewReader(&fakeAccess{err: cmdomain.ErrForbidden}, store).TopicScenario(ctx, uuid.New(), Viewer{})
	assert.ErrorIs(t, err, ErrAuthRequired)
}

// Covers SPEC-016 5.2 (service side): only published practical exercises are graded.
func TestModulePracticeItems(t *testing.T) {
	ctx := context.Background()
	practical := domain.Question{ID: uuid.New(), Kind: domain.KindPractical, Usage: domain.UsageExercise, Status: domain.StatusPublished,
		ValidationConditions: json.RawMessage(`[{"type":"FILE_EXISTS","path":"/a"}]`)}
	store := &fakeReadStore{questions: []domain.Question{
		practical,
		{Kind: domain.KindTheoreticalSingle, Usage: domain.UsageExercise, Status: domain.StatusPublished},
		{Kind: domain.KindPractical, Usage: domain.UsageExercise, Status: domain.StatusDraft},
	}}
	items, err := NewReader(&fakeAccess{}, store).ModulePracticeItems(ctx, uuid.New(), Viewer{})
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, practical.ID, items[0].QuestionID)
	assert.Len(t, items[0].Conditions, 1)
	assert.Equal(t, domain.UsageExercise, store.usage)
	assert.False(t, store.includeDrafts)

	broken := &fakeReadStore{questions: []domain.Question{{Kind: domain.KindPractical, Status: domain.StatusPublished, ValidationConditions: json.RawMessage(`{`)}}}
	_, err = NewReader(&fakeAccess{}, broken).ModulePracticeItems(ctx, uuid.New(), Viewer{})
	assert.Error(t, err)

	_, err = NewReader(&fakeAccess{err: cmdomain.ErrModuleNotFound}, store).ModulePracticeItems(ctx, uuid.New(), Viewer{})
	assert.ErrorIs(t, err, ErrModuleNotFound)
}

// Covers SPEC-019 RN-12: students never get inactive blocks.
func TestReader_BlocksSkipsInactive(t *testing.T) {
	now := time.Now()
	store := &fakeReadStore{blocks: []domain.ContentBlock{
		{ID: uuid.New(), Position: 1},
		{ID: uuid.New(), Position: 2, InactiveAt: &now},
		{ID: uuid.New(), Position: 3},
	}}
	r := NewReader(&fakeAccess{}, store)
	got, err := r.Blocks(context.Background(), uuid.New(), Viewer{})
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, []int{1, 3}, []int{got[0].Position, got[1].Position})
}
