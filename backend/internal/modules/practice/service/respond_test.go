package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
)

func trueFalse(id uuid.UUID, correct bool) contentdomain.Question {
	key, _ := json.Marshal(map[string]bool{"correct": correct})
	why := "<p>Because.</p>"
	return contentdomain.Question{
		ID: id, Kind: contentdomain.KindTheoreticalBoolean, Usage: contentdomain.UsageExercise, Status: contentdomain.StatusPublished,
		Statement: "<p>rm -r removes non-empty directories.</p>", AnswerKey: key, Explanation: &why,
	}
}

func practical(id uuid.UUID) contentdomain.Question {
	return contentdomain.Question{ID: id, Kind: contentdomain.KindPractical, Usage: contentdomain.UsageExercise, Status: contentdomain.StatusPublished}
}

func answer(value bool) Submission {
	raw, _ := json.Marshal(map[string]bool{"value": value})
	return Submission{Response: raw}
}

// Covers SPEC-035 CA-09 and CA-10 (service side): graded on the server, with the correct answer and the justification, and the
// question counts as done when answered (D-13).
func TestSubmitTrueFalseGradesAndRecordsTheSingleAnswer(t *testing.T) {
	q := uuid.New()
	svc, store := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: trueFalse(q, true)}})
	v := student()

	r, err := svc.Submit(context.Background(), q, v, answer(false))
	require.NoError(t, err)
	assert.False(t, r.Passed)
	assert.JSONEq(t, "true", string(r.Correct))
	require.NotNil(t, r.Explanation)
	assert.Equal(t, "<p>Because.</p>", *r.Explanation)
	require.NotNil(t, r.CompletedAt, "a wrong answer also completes the question (D-13)")

	saved := store.rows[[2]uuid.UUID{*v.UserID, q}]
	assert.Equal(t, 1, saved.Attempts)
	assert.False(t, saved.LastPassed)
	assert.JSONEq(t, `{"value":false}`, string(saved.Response))
}

// Covers SPEC-035 CA-17 (service side): a second answer is refused and the first one stays.
func TestSubmitTrueFalseRefusesASecondAnswer(t *testing.T) {
	q := uuid.New()
	svc, store := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: trueFalse(q, true)}})
	v := student()

	r, err := svc.Submit(context.Background(), q, v, answer(true))
	require.NoError(t, err)
	assert.True(t, r.Passed)

	_, err = svc.Submit(context.Background(), q, v, answer(false))
	assert.ErrorIs(t, err, ErrAlreadyAnswered)
	saved := store.rows[[2]uuid.UUID{*v.UserID, q}]
	assert.True(t, saved.LastPassed)
	assert.JSONEq(t, `{"value":true}`, string(saved.Response))
	assert.Equal(t, 1, store.saves)
}

// Covers SPEC-035 5.2: the body must be the one of the kind of the question.
func TestSubmitNeedsTheBodyOfTheKind(t *testing.T) {
	tf, pr := uuid.New(), uuid.New()
	content := fakeContent{questions: map[uuid.UUID]contentdomain.Question{tf: trueFalse(tf, true), pr: practical(pr)}}
	svc, _ := newService(content)
	v := student()

	_, err := svc.Submit(context.Background(), tf, v, Submission{Snapshot: json.RawMessage(emptyMachine)})
	assert.ErrorIs(t, err, ErrResponseRequired)
	_, err = svc.Submit(context.Background(), tf, v, Submission{Response: json.RawMessage(`{"value":"yes"}`)})
	assert.ErrorIs(t, err, contentdomain.ErrInvalidResponse)
	_, err = svc.Submit(context.Background(), pr, v, answer(true))
	assert.ErrorIs(t, err, ErrSnapshotRequired)

	r, err := svc.Submit(context.Background(), pr, v, Submission{Snapshot: json.RawMessage(solvedMachine)})
	require.NoError(t, err)
	assert.True(t, r.Passed, "a practical exercise is still graded by its machine")
	assert.Nil(t, r.Correct)
}

// Covers SPEC-035 CA-12 and CA-15 (service side).
func TestSubmitRefusesVisitorsAndQuestionsOutOfThePractice(t *testing.T) {
	q := uuid.New()
	svc, _ := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: trueFalse(q, true)}})

	_, err := svc.Submit(context.Background(), q, contentservice.Viewer{}, answer(true))
	assert.ErrorIs(t, err, contentservice.ErrAuthRequired)
	_, err = svc.Submit(context.Background(), uuid.New(), student(), answer(true))
	assert.ErrorIs(t, err, contentservice.ErrQuestionNotFound)
}

func TestSubmitPropagatesStoreErrors(t *testing.T) {
	q := uuid.New()
	svc, store := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: trueFalse(q, true)}})
	boom := errors.New("boom")

	store.findErr = boom
	_, err := svc.Submit(context.Background(), q, student(), answer(true))
	assert.ErrorIs(t, err, boom)

	store.findErr, store.saveErr = nil, boom
	_, err = svc.Submit(context.Background(), q, student(), answer(true))
	assert.ErrorIs(t, err, boom)

	broken := trueFalse(q, true)
	broken.AnswerKey = nil
	svc, _ = newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: broken}})
	_, err = svc.Submit(context.Background(), q, student(), answer(true))
	assert.Error(t, err)
}

// Covers SPEC-035 CA-10 (progress side): the progress of an answered question brings the answer key and the justification.
func TestModuleProgressRevealsTheAnswerOfAnsweredQuestions(t *testing.T) {
	tf, gone := uuid.New(), uuid.New()
	content := fakeContent{questions: map[uuid.UUID]contentdomain.Question{tf: trueFalse(tf, false)}}
	svc, _ := newService(content)
	v := student()
	_, err := svc.Submit(context.Background(), tf, v, answer(false))
	require.NoError(t, err)

	// A question that left the practice keeps its progress, without the answer.
	content.questions[gone] = trueFalse(gone, true)
	_, err = svc.Submit(context.Background(), gone, v, answer(true))
	require.NoError(t, err)
	delete(content.questions, gone)

	rows, err := svc.ModuleProgress(context.Background(), uuid.New(), v)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	for _, row := range rows {
		switch row.QuestionID {
		case tf:
			assert.JSONEq(t, "false", string(row.Correct))
			require.NotNil(t, row.Explanation)
		case gone:
			assert.Nil(t, row.Correct)
		}
	}

	svc, _ = newService(fakeContent{questionErr: errors.New("boom")})
	store := svc.store.(*fakeStore)
	store.rows[[2]uuid.UUID{*v.UserID, tf}] = rowsWithResponse(*v.UserID, tf)
	_, err = svc.ModuleProgress(context.Background(), uuid.New(), v)
	assert.Error(t, err)
}

func rowsWithResponse(user, question uuid.UUID) domain.Progress {
	return domain.Progress{ID: uuid.New(), UserID: user, QuestionID: question, Attempts: 1, Response: json.RawMessage(`{"value":true}`)}
}

func singleChoice(id uuid.UUID) contentdomain.Question {
	why := "<p>chmod changes the mode.</p>"
	return contentdomain.Question{
		ID: id, Kind: contentdomain.KindTheoreticalSingle, Usage: contentdomain.UsageExercise, Status: contentdomain.StatusPublished,
		Choices: json.RawMessage(`[{"id":"a","html":"chmod"},{"id":"b","html":"chown"}]`), AnswerKey: json.RawMessage(`{"correct":"a"}`), Explanation: &why,
	}
}

// Covers SPEC-036 RN-05, RN-06 and CA-07, CA-08 (service side): graded by id, revealed as correctChoice, and answered once.
func TestSubmitSingleChoice(t *testing.T) {
	q := uuid.New()
	svc, store := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: singleChoice(q)}})
	v := student()

	_, err := svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"choice":"zz"}`)})
	assert.ErrorIs(t, err, contentdomain.ErrInvalidResponse, "an id that is not of a choice")

	r, err := svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"choice":"b"}`)})
	require.NoError(t, err)
	assert.False(t, r.Passed)
	assert.Equal(t, "correctChoice", r.CorrectField)
	assert.JSONEq(t, `"a"`, string(r.Correct))
	require.NotNil(t, r.CompletedAt)
	assert.JSONEq(t, `{"choice":"b"}`, string(store.rows[[2]uuid.UUID{*v.UserID, q}].Response))

	_, err = svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"choice":"a"}`)})
	assert.ErrorIs(t, err, ErrAlreadyAnswered)

	rows, err := svc.ModuleProgress(context.Background(), uuid.New(), v)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "correctChoice", rows[0].CorrectField)
	assert.JSONEq(t, `"a"`, string(rows[0].Correct))
}

func matching(id uuid.UUID) contentdomain.Question {
	return contentdomain.Question{
		ID: id, Kind: contentdomain.KindTheoreticalMatching, Usage: contentdomain.UsageExercise, Status: contentdomain.StatusPublished,
		Choices:   json.RawMessage(`{"left":[{"id":"l1","text":"chmod"},{"id":"l2","text":"chown"}],"right":[{"id":"r1","text":"owner"},{"id":"r2","text":"mode"}]}`),
		AnswerKey: json.RawMessage(`{"pairs":[{"left":"l1","right":"r2"},{"left":"l2","right":"r1"}]}`),
	}
}

// Covers SPEC-037 RN-06, RN-07 and CA-08, CA-09 (service side): each link graded, the pairs revealed, answered once, and the result of
// each link kept in the progress.
func TestSubmitMatching(t *testing.T) {
	q := uuid.New()
	svc, _ := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: matching(q)}})
	v := student()

	_, err := svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"links":[{"left":"l1","right":"r2"}]}`)})
	assert.ErrorIs(t, err, contentdomain.ErrInvalidResponse, "every item must be linked")

	r, err := svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"links":[{"left":"l1","right":"r2"},{"left":"l2","right":"r2x"}]}`)})
	assert.ErrorIs(t, err, contentdomain.ErrInvalidResponse)
	r, err = svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"links":[{"left":"l1","right":"r2"},{"left":"l2","right":"r1"}]}`)})
	require.NoError(t, err)
	assert.True(t, r.Passed)
	assert.Equal(t, "pairs", r.CorrectField)
	assert.JSONEq(t, `[{"left":"l1","right":"r2","correct":true},{"left":"l2","right":"r1","correct":true}]`, string(r.Details))

	_, err = svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"links":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"}]}`)})
	assert.ErrorIs(t, err, ErrAlreadyAnswered)

	rows, err := svc.ModuleProgress(context.Background(), uuid.New(), v)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "pairs", rows[0].CorrectField)
	assert.JSONEq(t, `[{"left":"l1","right":"r2","correct":true},{"left":"l2","right":"r1","correct":true}]`, string(rows[0].Details))
}

func discursive(id uuid.UUID) contentdomain.Question {
	return contentdomain.Question{
		ID: id, Kind: contentdomain.KindDiscursive, Usage: contentdomain.UsageExercise, Status: contentdomain.StatusPublished,
		Statement: "<p>Explain chmod 750.</p>", AnswerKey: json.RawMessage(`{"expectedAnswer":"<p>rwx r-x ---</p>","maxLength":500}`),
	}
}

// Covers SPEC-039 RN-03, RN-09 and CA-02, CA-03 (service side): the answer is kept clean, once, waiting for the teacher, and the
// correct answer comes after it.
func TestSubmitDiscursive(t *testing.T) {
	q := uuid.New()
	svc, store := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: discursive(q)}})
	v := student()

	r, err := svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"html":"<p>Owner <b>rwx</b>: <code>chmod 750 f</code></p>"}`)})
	require.NoError(t, err)
	assert.True(t, r.Pending)
	assert.False(t, r.Passed)
	assert.Equal(t, "expectedAnswer", r.CorrectField)
	assert.JSONEq(t, `"<p>rwx r-x ---</p>"`, string(r.Correct))
	require.NotNil(t, r.CompletedAt, "answered counts as done (SPEC-035 D-13)")
	assert.JSONEq(t, `{"html":"<p>Owner rwx: <code>chmod 750 f</code></p>"}`, string(store.rows[[2]uuid.UUID{*v.UserID, q}].Response))

	_, err = svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"html":"<p>again</p>"}`)})
	assert.ErrorIs(t, err, ErrAlreadyAnswered)
	_, err = svc.Submit(context.Background(), q, student(), Submission{Response: json.RawMessage(`{"html":"<p></p>"}`)})
	assert.ErrorIs(t, err, contentdomain.ErrInvalidResponse)
}

// Covers SPEC-039 RN-07, D-04 and D-06 (service side): the progress shows the confirmed grade and the note to the student, never the
// suggestion nor the private note, and "pending" before the teacher confirms.
func TestModuleProgressOfDiscursive(t *testing.T) {
	q := uuid.New()
	svc, store := newService(fakeContent{questions: map[uuid.UUID]contentdomain.Question{q: discursive(q)}})
	v := student()
	_, err := svc.Submit(context.Background(), q, v, Submission{Response: json.RawMessage(`{"html":"<p>rwx</p>"}`)})
	require.NoError(t, err)

	rows, err := svc.ModuleProgress(context.Background(), uuid.New(), v)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, domain.StatusPending, rows[0].AnswerStatus)
	assert.Nil(t, rows[0].Score)
	assert.Equal(t, "expectedAnswer", rows[0].CorrectField)

	score, note, private := 75, "Almost.", "secret"
	suggested := 100
	progressID := store.rows[[2]uuid.UUID{*v.UserID, q}].ID
	store.grades = map[uuid.UUID]domain.AnswerGrade{progressID: {ProgressID: progressID, Score: &score, StudentNote: &note, PrivateNote: &private, SuggestedScore: &suggested}}
	rows, err = svc.ModuleProgress(context.Background(), uuid.New(), v)
	require.NoError(t, err)
	assert.Equal(t, domain.StatusGraded, rows[0].AnswerStatus)
	assert.Equal(t, 75, *rows[0].Score)
	assert.Equal(t, "Almost.", *rows[0].StudentNote)

	store.gradesErr = errors.New("db down")
	_, err = svc.ModuleProgress(context.Background(), uuid.New(), v)
	assert.Error(t, err)
}
