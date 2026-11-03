package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-091 CA-06 (RN-06): the commands of an attempt are stored and read in the order they ran.
func TestRepository_Commands(t *testing.T) {
	e := newEnv(t)
	at, _ := e.attempt(t, e.create(t))
	later := domain.AttemptCommand{AttemptID: at.ID, Position: 2, Command: "ls", Output: "a", ExecutedAt: e.now.Add(time.Minute)}
	first := domain.AttemptCommand{AttemptID: at.ID, Position: 2, Command: "mkdir /a", Output: "", ExecutedAt: e.now}
	require.NoError(t, e.repo.SaveCommand(e.ctx, &later))
	require.NoError(t, e.repo.SaveCommand(e.ctx, &first))
	assert.NotZero(t, first.ID)

	list, err := e.repo.Commands(e.ctx, at.ID)
	require.NoError(t, err)
	require.Len(t, list, 2)
	assert.Equal(t, "mkdir /a", list[0].Command)
	assert.Equal(t, 2, list[0].Position)
	assert.True(t, list[1].ExecutedAt.Equal(e.now.Add(time.Minute)))
}

// Covers SPEC-091 CA-07 (RN-07, D-03): one open request for each attempt; closing it keeps who, when and the answer; the open ones of the assessment
// come with the student, oldest first.
func TestRepository_Help(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	at, _ := e.attempt(t, a)

	none, err := e.repo.LatestHelp(e.ctx, at.ID)
	require.NoError(t, err)
	assert.Nil(t, none)

	position := 2
	h := domain.HelpRequest{AttemptID: at.ID, Position: &position, Question: "Posso?", Status: domain.HelpOpen, CreatedAt: e.now}
	require.NoError(t, e.repo.CreateHelp(e.ctx, &h))
	second := domain.HelpRequest{AttemptID: at.ID, Status: domain.HelpOpen, CreatedAt: e.now}
	assert.Error(t, e.repo.CreateHelp(e.ctx, &second), "one open request for each attempt")

	open, err := e.repo.OpenHelps(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, open, 1)
	assert.Equal(t, e.student.ID, open[0].StudentID)
	assert.Equal(t, a.ID, open[0].AssessmentID)
	assert.Equal(t, "Posso?", open[0].Question)

	when := e.now.Add(time.Minute)
	require.NoError(t, e.repo.CloseHelp(e.ctx, h.ID, domain.HelpAnswered, when, &e.teacher.ID, "Pode."))
	assert.ErrorIs(t, e.repo.CloseHelp(e.ctx, h.ID, domain.HelpCanceled, when, nil, ""), domain.ErrHelpNotFound, "closed only once")
	found, err := e.repo.FindHelp(e.ctx, h.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.HelpAnswered, found.Status)
	assert.Equal(t, "Pode.", found.Answer)
	require.NotNil(t, found.ClosedBy)
	assert.Equal(t, e.teacher.ID, *found.ClosedBy)
	latest, err := e.repo.LatestHelp(e.ctx, at.ID)
	require.NoError(t, err)
	assert.Equal(t, h.ID, latest.ID)

	require.NoError(t, e.repo.CreateHelp(e.ctx, &second), "after closing, a new one opens")
	open, err = e.repo.OpenHelps(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, open, 1)
}

// Covers SPEC-091 CA-08 (RN-08): the attempt ended by the teacher keeps who ended it and why; it is found by its id.
func TestRepository_EndedByTheTeacher(t *testing.T) {
	e := newEnv(t)
	at, _ := e.attempt(t, e.create(t))
	found, err := e.repo.FindAttemptByID(e.ctx, at.ID)
	require.NoError(t, err)
	assert.Equal(t, at.AssessmentID, found.AssessmentID)

	when, score, pending, reason := e.now.Add(time.Minute), domain.Points(0), 0, "Flagrante de cola"
	at.Status, at.SubmittedAt, at.PreliminaryScore, at.PendingItems, at.EndedBy, at.EndReason = domain.AttemptEndedByTeacher, &when, &score, &pending, &e.teacher.ID, &reason
	require.NoError(t, e.repo.CloseAttempt(e.ctx, &at, nil))
	found, err = e.repo.FindAttemptByID(e.ctx, at.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AttemptEndedByTeacher, found.Status)
	require.NotNil(t, found.EndedBy)
	assert.Equal(t, e.teacher.ID, *found.EndedBy)
	require.NotNil(t, found.EndReason)
	assert.Equal(t, reason, *found.EndReason)
}

// Covers SPEC-091 (section 4): the migration of the room goes down and up again.
func TestMigration00048_UpAndDown(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00048_")
	count := func() int64 {
		var n int64
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
			AND table_name IN ('assessment_attempt_commands', 'assessment_help_requests')`).Scan(&n).Error)
		return n
	}
	assert.Equal(t, int64(2), count())
	runMigration(t, e, down)
	assert.Zero(t, count())
	runMigration(t, e, up)
	assert.Equal(t, int64(2), count())
}
