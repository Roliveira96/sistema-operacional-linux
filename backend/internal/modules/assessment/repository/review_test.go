package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-097 section 4: migration 00052 adds the adjustment of each question and the review of the attempt, and going down takes them away.
func TestMigration00052_UpAndDown(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00052_")
	count := func() int64 {
		var n int64
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND (
			(table_name = 'assessment_attempt_items' AND column_name IN ('adjusted_points', 'adjust_reason', 'adjusted_at', 'adjusted_by')) OR
			(table_name = 'assessment_attempts' AND column_name IN ('teacher_note', 'student_note', 'final_score', 'reviewed_at', 'reviewed_by')))`).Scan(&n).Error)
		return n
	}
	assert.Equal(t, int64(9), count())
	runMigration(t, e, down)
	assert.Zero(t, count())
	runMigration(t, e, up)
	assert.Equal(t, int64(9), count())
}

// Covers SPEC-097 CA-02: every request for help of an attempt, open or closed, the oldest first.
func TestAttemptHelps_AllOfTheAttemptInOrder(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	at, _ := e.attempt(t, a)
	first := domain.HelpRequest{AttemptID: at.ID, Question: "Posso?", Status: domain.HelpOpen, CreatedAt: e.now}
	require.NoError(t, e.repo.CreateHelp(e.ctx, &first))
	require.NoError(t, e.repo.CloseHelp(e.ctx, first.ID, domain.HelpAnswered, e.now.Add(time.Minute), &e.teacher.ID, "Pode."))
	second := domain.HelpRequest{AttemptID: at.ID, Question: "E agora?", Status: domain.HelpOpen, CreatedAt: e.now.Add(2 * time.Minute)}
	require.NoError(t, e.repo.CreateHelp(e.ctx, &second))

	list, err := e.repo.AttemptHelps(e.ctx, at.ID)
	require.NoError(t, err)
	require.Len(t, list, 2)
	assert.Equal(t, "Posso?", list[0].Question)
	assert.Equal(t, "Pode.", list[0].Answer)
	assert.Equal(t, domain.HelpOpen, list[1].Status)
}

// Covers SPEC-097 CA-03: the adjustment of a question is stored with the reason, who and when, and undone.
func TestAdjustItem_StoresAndClears(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	at, _ := e.attempt(t, a)
	half, reason := domain.Points(0.5), "Parcial"
	require.NoError(t, e.repo.AdjustItem(e.ctx, at.ID, 1, &half, &reason, e.now, e.teacher.ID))
	items, err := e.repo.AttemptItems(e.ctx, at.ID)
	require.NoError(t, err)
	require.NotNil(t, items[0].AdjustedPoints)
	assert.Equal(t, half, *items[0].AdjustedPoints)
	assert.Equal(t, "Parcial", *items[0].AdjustReason)
	require.NoError(t, e.repo.AdjustItem(e.ctx, at.ID, 1, nil, nil, e.now, e.teacher.ID))
	items, err = e.repo.AttemptItems(e.ctx, at.ID)
	require.NoError(t, err)
	assert.Nil(t, items[0].AdjustedPoints)
	assert.Nil(t, items[0].AdjustReason)
	assert.ErrorIs(t, e.repo.AdjustItem(e.ctx, at.ID, 99, &half, &reason, e.now, e.teacher.ID), domain.ErrAttemptNotFound)
}

// Covers SPEC-097 CA-04, CA-05: the notes, the review done with the final score and the review reopened are stored in the attempt.
func TestReview_NotesFinishAndReopen(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	at, _ := e.attempt(t, a)
	teacher, student := "Colou?", "Muito bem."
	require.NoError(t, e.repo.SaveReviewNotes(e.ctx, at.ID, &teacher, &student))
	score := domain.Points(7.5)
	require.NoError(t, e.repo.FinishReview(e.ctx, at.ID, score, e.now, e.teacher.ID))
	got, err := e.repo.FindAttemptByID(e.ctx, at.ID)
	require.NoError(t, err)
	assert.Equal(t, "Colou?", *got.TeacherNote)
	assert.Equal(t, "Muito bem.", *got.StudentNote)
	require.NotNil(t, got.FinalScore)
	assert.Equal(t, score, *got.FinalScore)
	require.NotNil(t, got.ReviewedAt)
	assert.Equal(t, e.teacher.ID, *got.ReviewedBy)

	require.NoError(t, e.repo.ReopenReview(e.ctx, at.ID))
	require.NoError(t, e.repo.SaveReviewNotes(e.ctx, at.ID, nil, nil))
	got, err = e.repo.FindAttemptByID(e.ctx, at.ID)
	require.NoError(t, err)
	assert.Nil(t, got.ReviewedAt)
	assert.Nil(t, got.FinalScore)
	assert.Nil(t, got.TeacherNote)
	assert.ErrorIs(t, e.repo.FinishReview(e.ctx, uuid.New(), score, e.now, e.teacher.ID), domain.ErrAttemptNotFound)
}

// Covers SPEC-098 section 4: migration 00053 adds the publication of the grades to the assessments, and going down takes it away.
func TestMigration00053_UpAndDown(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00053_")
	count := func() int64 {
		var n int64
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
			AND table_name = 'assessments' AND column_name IN ('grades_published_at', 'grades_published_by')`).Scan(&n).Error)
		return n
	}
	assert.Equal(t, int64(2), count())
	runMigration(t, e, down)
	assert.Zero(t, count())
	runMigration(t, e, up)
	assert.Equal(t, int64(2), count())
}
