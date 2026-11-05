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
