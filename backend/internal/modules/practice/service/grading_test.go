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

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
)

type fakeGradingStore struct {
	rows   map[uuid.UUID]AnswerRow
	events []domain.GradeEvent
	err    error
}

func (f *fakeGradingStore) ListAnswers(_ context.Context, moduleID uuid.UUID, status string) ([]AnswerRow, error) {
	if f.err != nil {
		return nil, f.err
	}
	var out []AnswerRow
	for _, r := range f.rows {
		if r.ModuleID == moduleID && (status == "" || r.Grade.Status() == status) {
			out = append(out, r)
		}
	}
	return out, nil
}

func (f *fakeGradingStore) FindAnswer(_ context.Context, progressID uuid.UUID) (AnswerRow, error) {
	r, ok := f.rows[progressID]
	if !ok {
		return AnswerRow{}, ErrAnswerNotFound
	}
	return r, f.err
}

func (f *fakeGradingStore) SaveGrade(_ context.Context, g *domain.AnswerGrade, ev domain.GradeEvent) error {
	if f.err != nil {
		return f.err
	}
	for id, r := range f.rows {
		if r.Progress.ID == g.ProgressID {
			r.Grade = *g
			f.rows[id] = r
		}
	}
	f.events = append(f.events, ev)
	return nil
}

type fakeOwners struct {
	owner uuid.UUID
	err   error
}

func (f fakeOwners) ModuleOwner(context.Context, uuid.UUID) (uuid.UUID, error) { return f.owner, f.err }

func gradingFixture() (*Grading, *fakeGradingStore, contentservice.Actor, uuid.UUID, uuid.UUID) {
	teacher := contentservice.Actor{UserID: uuid.New(), Role: "TEACHER"}
	module, progress := uuid.New(), uuid.New()
	store := &fakeGradingStore{rows: map[uuid.UUID]AnswerRow{progress: {
		Progress: domain.Progress{ID: progress, Response: json.RawMessage(`{"html":"<p>rwx</p>"}`)}, ModuleID: module, QuestionTitle: "chmod",
		ExpectedAnswer: "<p>rwx r-x ---</p>", StudentName: "Ana",
	}}}
	g := NewGrading(store, fakeOwners{owner: teacher.UserID})
	g.now = func() time.Time { return time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC) }
	return g, store, teacher, module, progress
}

// Covers SPEC-039 RN-04, CA-04 and CA-05 (service side): the AI suggests through the MCP with the access of the teacher, and the
// suggestion is not a grade.
func TestGradingSuggest(t *testing.T) {
	g, store, teacher, module, progress := gradingFixture()
	list, err := g.List(context.Background(), teacher, module, domain.StatusPending)
	require.NoError(t, err)
	require.Len(t, list, 1)

	require.NoError(t, g.Suggest(context.Background(), teacher, progress, 75, "partial", "Almost there."))
	row := store.rows[progress]
	assert.Equal(t, domain.StatusSuggested, row.Grade.Status())
	assert.Nil(t, row.Grade.Score, "a suggestion is not a grade")
	assert.Equal(t, domain.GradeSuggested, store.events[0].Kind)

	assert.ErrorIs(t, g.Suggest(context.Background(), teacher, progress, 70, "x", ""), domain.ErrInvalidScore)
	other := contentservice.Actor{UserID: uuid.New(), Role: "TEACHER"}
	assert.ErrorIs(t, g.Suggest(context.Background(), other, progress, 75, "x", ""), contentservice.ErrForbidden)
	assert.ErrorIs(t, g.Suggest(context.Background(), teacher, uuid.New(), 75, "x", ""), ErrAnswerNotFound)
	_, err = g.List(context.Background(), other, module, "")
	assert.ErrorIs(t, err, contentservice.ErrForbidden)
	_, err = g.List(context.Background(), contentservice.Actor{UserID: uuid.New(), Role: "ADMIN"}, module, "")
	require.NoError(t, err, "an admin corrects any module")
}

// Covers SPEC-039 RN-05, RN-06, CA-06, CA-07 and CA-11 (service side).
func TestGradingConfirmAndRevise(t *testing.T) {
	g, store, teacher, _, progress := gradingFixture()
	require.NoError(t, g.Suggest(context.Background(), teacher, progress, 50, "half", "Half of it."))
	row, err := g.Confirm(context.Background(), teacher, progress, domain.GradeInput{UseSuggestion: true, StudentNote: "Half of it.", PrivateNote: "talk to her"})
	require.NoError(t, err)
	assert.Equal(t, 50, *row.Grade.Score)
	assert.Equal(t, domain.SourceAIAccepted, *row.Grade.Source)

	_, err = g.Confirm(context.Background(), teacher, progress, domain.GradeInput{Score: ptr(75)})
	assert.ErrorIs(t, err, domain.ErrReasonRequired)
	row, err = g.Confirm(context.Background(), teacher, progress, domain.GradeInput{Score: ptr(75), Reason: "reread"})
	require.NoError(t, err)
	assert.Equal(t, 75, *row.Grade.Score)
	assert.Len(t, store.events, 3)
	assert.Equal(t, domain.GradeRevised, store.events[2].Kind)

	got, err := g.Get(context.Background(), teacher, progress)
	require.NoError(t, err)
	assert.Equal(t, "Ana", got.StudentName)

	store.err = errors.New("db down")
	_, err = g.Confirm(context.Background(), teacher, progress, domain.GradeInput{Score: ptr(100), Reason: "x"})
	assert.Error(t, err)
}

func ptr(v int) *int { return &v }

func TestGradingModuleErrors(t *testing.T) {
	store := &fakeGradingStore{rows: map[uuid.UUID]AnswerRow{}}
	g := NewGrading(store, fakeOwners{err: contentservice.ErrModuleNotFound})
	_, err := g.List(context.Background(), contentservice.Actor{UserID: uuid.New(), Role: "TEACHER"}, uuid.New(), "")
	assert.ErrorIs(t, err, contentservice.ErrModuleNotFound)
	_, err = g.List(context.Background(), contentservice.Actor{UserID: uuid.New(), Role: "TEACHER"}, uuid.New(), "WRONG")
	assert.ErrorIs(t, err, ErrInvalidAnswerStatus)
}
