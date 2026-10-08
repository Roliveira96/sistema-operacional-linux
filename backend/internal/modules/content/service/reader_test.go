package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
)

type fakeAccess struct {
	owner uuid.UUID
	err   error
	seen  cmservice.UserAccessContext
}

func (f *fakeAccess) GetModuleByID(_ context.Context, _ uuid.UUID, u cmservice.UserAccessContext) (cmrepository.ModuleDetails, error) {
	f.seen = u
	if f.err != nil {
		return cmrepository.ModuleDetails{}, f.err
	}
	return cmrepository.ModuleDetails{Module: cmdomain.CourseModule{TeacherID: f.owner}}, nil
}

type fakeReadStore struct {
	questions     []domain.Question
	includeDrafts bool
	usage         string
}

func (f *fakeReadStore) ListBlocks(context.Context, uuid.UUID) ([]domain.ContentBlock, error) {
	return []domain.ContentBlock{{Position: 1, BlockType: domain.BlockText}}, nil
}

func (f *fakeReadStore) ListQuestions(_ context.Context, _ uuid.UUID, usage string, includeDrafts bool) ([]domain.Question, error) {
	f.includeDrafts, f.usage = includeDrafts, usage
	return f.questions, nil
}

func (f *fakeReadStore) ListActiveTemplates(context.Context) ([]TemplateSummary, error) {
	return []TemplateSummary{{Title: "Quiz", QuestionCount: 30}}, nil
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
