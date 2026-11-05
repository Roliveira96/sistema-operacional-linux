package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// reviewedExam is the delivered exam of SPEC-097 with Ana's review concluded (her written question graded).
func (f *fixture) reviewedExam(t *testing.T) (service.Summary, service.StudentAttempt) {
	t.Helper()
	a, ana := f.deliveredExam(t)
	_, err := f.svc.AdjustItem(ctx, f.teacher, f.class.ID, a.ID, ana.ID, 5, ptr(1.0), "")
	require.NoError(t, err)
	_, err = f.svc.FinishReview(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	require.NoError(t, err)
	return a, ana
}

// Covers SPEC-098 CA-01 (RN-01, RN-02, D-01, D-05): the grades are published only after the end and with every delivered attempt reviewed; the
// publication keeps who and when, publishing again changes nothing, and the student learns that the grades were published.
func TestPublishGrades_NeedsEveryReviewAndKeepsWhoAndWhen(t *testing.T) {
	f := newFixture(t)
	a, ana := f.deliveredExam(t)
	_, err := f.svc.PublishGrades(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrReviewsPending, "Ana is not reviewed")
	_, err = f.svc.AdjustItem(ctx, f.teacher, f.class.ID, a.ID, ana.ID, 5, ptr(1.0), "")
	require.NoError(t, err)
	_, err = f.svc.FinishReview(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	require.NoError(t, err)

	_, err = f.svc.PublishGrades(ctx, f.as(f.ana), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.PublishGrades(ctx, f.other, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)

	f.now = at(21, 10, 30)
	got, err := f.svc.PublishGrades(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	require.NotNil(t, got.GradesPublishedAt)
	assert.Equal(t, at(21, 10, 30), *got.GradesPublishedAt)
	assert.Equal(t, "Profa. Sediane", got.GradesPublishedByName)

	f.now = at(21, 11, 30)
	again, err := f.svc.PublishGrades(ctx, f.admin, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, at(21, 10, 30), *again.GradesPublishedAt, "publishing again changes nothing")
	assert.Equal(t, "Profa. Sediane", again.GradesPublishedByName)

	public, err := f.svc.Public(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, public.GradesPublished)
}

// Covers SPEC-098 CA-01 (RN-01): before the end there is nothing to publish.
func TestPublishGrades_NeedsTheEnd(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.now = at(21, 9, 30)
	_, err := f.svc.PublishGrades(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotEnded)
}

// Covers SPEC-098 CA-03 (RN-04, D-04): once published, the correction is kept: no adjustment, no notes, no concluding nor reopening.
func TestReview_LockedAfterPublishing(t *testing.T) {
	f := newFixture(t)
	a, ana := f.reviewedExam(t)
	_, err := f.svc.PublishGrades(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)

	_, err = f.svc.ReopenReview(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrGradesPublished)
	_, err = f.svc.AdjustItem(ctx, f.teacher, f.class.ID, a.ID, ana.ID, 1, ptr(1.0), "x")
	assert.ErrorIs(t, err, domain.ErrGradesPublished)
	assert.ErrorIs(t, f.svc.SaveReviewNotes(ctx, f.teacher, f.class.ID, a.ID, ana.ID, "x", "y"), domain.ErrGradesPublished)
	_, err = f.svc.FinishReview(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrGradesPublished)
	_, err = f.svc.ReviewOf(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	assert.NoError(t, err, "reading the correction still works")
}

// Covers SPEC-098 CA-02 (RN-03, D-02): after the publication, the student reads the final score, the note to the student and, for each question,
// the answer, the key of the objective ones, the points that counted and the reason of an adjustment; never the private note.
func TestMyResult_GivesTheGradeAndNeverThePrivate(t *testing.T) {
	f := newFixture(t)
	a, ana := f.reviewedExam(t)
	_, err := f.svc.ReopenReview(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	require.NoError(t, err)
	_, err = f.svc.AdjustItem(ctx, f.teacher, f.class.ID, a.ID, ana.ID, 1, ptr(0.5), "Faltou justificar")
	require.NoError(t, err)
	require.NoError(t, f.svc.SaveReviewNotes(ctx, f.teacher, f.class.ID, a.ID, ana.ID, "Colou?", "Muito bem no terminal."))
	done, err := f.svc.FinishReview(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	require.NoError(t, err)
	_, err = f.svc.PublishGrades(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)

	got, err := f.svc.MyResult(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, *done.FinalScore, got.FinalScore)
	assert.Equal(t, domain.Points(10), got.MaxScore)
	assert.Equal(t, "Muito bem no terminal.", got.StudentNote)
	require.Len(t, got.Items, 5)
	single := got.Items[0]
	require.NotNil(t, single.Points)
	assert.Equal(t, domain.Points(0.5), *single.Points, "the adjustment counts")
	assert.Equal(t, "Faltou justificar", single.AdjustReason)
	assert.JSONEq(t, `{"choice":"a"}`, string(single.AnswerKey))
	assert.JSONEq(t, `{"choice":"a"}`, string(single.Answer))
	assert.Empty(t, got.Items[3].Answer, "never the machine")
	written := got.Items[4]
	assert.Empty(t, written.AnswerKey, "never the expected answer")
	assert.Equal(t, domain.Points(1), *written.Points)
}

// Covers SPEC-098 CA-03 (RN-04, D-03): nothing before the publication; who did not come never reads a result; only the student reads it.
func TestMyResult_HiddenBeforePublishingAndToTheAbsent(t *testing.T) {
	f := newFixture(t)
	a, _ := f.reviewedExam(t)
	_, err := f.svc.MyResult(ctx, f.as(f.ana), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrResultNotPublished)
	_, err = f.svc.PublishGrades(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	_, err = f.svc.MyResult(ctx, f.as(f.bruno), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrResultNotPublished, "Bruno did not come")
	_, err = f.svc.MyResult(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}
