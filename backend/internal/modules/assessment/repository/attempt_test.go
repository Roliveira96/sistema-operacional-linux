package repository_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

func (e env) attempt(t *testing.T, a domain.Assessment) (domain.Attempt, []domain.AttemptItem) {
	t.Helper()
	at := domain.Attempt{AssessmentID: a.ID, StudentID: e.student.ID, Status: domain.AttemptInProgress, StartedAt: e.now, DeadlineAt: e.now.Add(time.Hour)}
	items := []domain.AttemptItem{
		{Position: 1, QuestionID: e.bank[domain.DifficultyEasy][0], Kind: "THEORETICAL_SINGLE", Weight: domain.Points(4),
			StudentView: json.RawMessage(`{"statement":"Qual?"}`), AnswerKey: json.RawMessage(`{"choice":"a"}`)},
		{Position: 2, QuestionID: e.bank[domain.DifficultyEasy][1], Kind: "PRACTICAL", Weight: domain.Points(6),
			StudentView: json.RawMessage(`{"statement":"Crie"}`), AnswerKey: json.RawMessage(`[]`)},
	}
	require.NoError(t, e.repo.CreateAttempt(e.ctx, &at, items))
	return at, items
}

// Covers SPEC-090 CA-01, CA-04 (RN-01, RN-04): an attempt is stored once for each student, with its items in order; an answer is stored and replaced.
func TestRepository_AttemptCreateFindAndAnswer(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	stored, _ := e.attempt(t, a)
	assert.NotEqual(t, [16]byte{}, [16]byte(stored.ID), "the id was given")

	again := domain.Attempt{AssessmentID: a.ID, StudentID: e.student.ID, Status: domain.AttemptInProgress, StartedAt: e.now, DeadlineAt: e.now.Add(time.Hour)}
	assert.ErrorIs(t, e.repo.CreateAttempt(e.ctx, &again, nil), domain.ErrAttemptExists)

	found, err := e.repo.FindAttempt(e.ctx, a.ID, e.student.ID)
	require.NoError(t, err)
	assert.Equal(t, stored.ID, found.ID)
	assert.True(t, found.DeadlineAt.Equal(e.now.Add(time.Hour)))
	_, err = e.repo.FindAttempt(e.ctx, a.ID, e.teacher.ID)
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)

	solved := true
	require.NoError(t, e.repo.SaveAttemptAnswer(e.ctx, stored.ID, 1, json.RawMessage(`{"choice":"b"}`), e.now, nil))
	require.NoError(t, e.repo.SaveAttemptAnswer(e.ctx, stored.ID, 1, json.RawMessage(`{"choice":"a"}`), e.now, nil))
	require.NoError(t, e.repo.SaveAttemptAnswer(e.ctx, stored.ID, 2, json.RawMessage(`{"cwd":"/"}`), e.now, &solved))
	assert.ErrorIs(t, e.repo.SaveAttemptAnswer(e.ctx, stored.ID, 9, json.RawMessage(`{}`), e.now, nil), domain.ErrAttemptNotFound)

	items, err := e.repo.AttemptItems(e.ctx, stored.ID)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, 1, items[0].Position)
	assert.JSONEq(t, `{"choice":"a"}`, string(items[0].Answer))
	assert.JSONEq(t, `{"choice":"a"}`, string(items[0].AnswerKey))
	assert.Equal(t, domain.Points(4), items[0].Weight)
	assert.Nil(t, items[0].CheckedSolved)
	require.NotNil(t, items[1].CheckedSolved)
	assert.True(t, *items[1].CheckedSolved)
}

// Covers SPEC-090 CA-06, CA-07, CA-09, CA-10 (RN-06 to RN-09, RN-11): closing stores the status, the score and the points of each item once; the
// due ones are found by the deadline; the list has the attempts; and the check of the clearance answers by the table.
func TestRepository_AttemptCloseDueListAndHasStarted(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	started, err := e.repo.HasStarted(e.ctx, a.ID, e.student.ID)
	require.NoError(t, err)
	assert.False(t, started)

	stored, _ := e.attempt(t, a)
	started, err = e.repo.HasStarted(e.ctx, a.ID, e.student.ID)
	require.NoError(t, err)
	assert.True(t, started)

	due, err := e.repo.DueAttempts(e.ctx, e.now.Add(2*time.Hour))
	require.NoError(t, err)
	require.Len(t, due, 1)
	due, err = e.repo.DueAttempts(e.ctx, e.now.Add(30*time.Minute))
	require.NoError(t, err)
	assert.Empty(t, due)

	when, score, pending := e.now.Add(40*time.Minute), domain.Points(4), 0
	four := domain.Points(4)
	stored.Status, stored.SubmittedAt, stored.PreliminaryScore, stored.PendingItems = domain.AttemptSubmitted, &when, &score, &pending
	require.NoError(t, e.repo.CloseAttempt(e.ctx, &stored, map[int]*domain.Score{1: &four, 2: nil}))
	assert.ErrorIs(t, e.repo.CloseAttempt(e.ctx, &stored, nil), domain.ErrAttemptAlreadySubmitted, "closed only once")

	list, err := e.repo.ListAttempts(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, domain.AttemptSubmitted, list[0].Status)
	require.NotNil(t, list[0].PreliminaryScore)
	assert.Equal(t, domain.Points(4), *list[0].PreliminaryScore)
	assert.Equal(t, 0, *list[0].PendingItems)
	assert.True(t, list[0].SubmittedAt.Equal(when))

	items, err := e.repo.AttemptItems(e.ctx, stored.ID)
	require.NoError(t, err)
	require.NotNil(t, items[0].Points)
	assert.Equal(t, domain.Points(4), *items[0].Points)
	assert.Nil(t, items[1].Points)

	due, err = e.repo.DueAttempts(e.ctx, e.now.Add(2*time.Hour))
	require.NoError(t, err)
	assert.Empty(t, due, "a closed attempt is not due")
}

// Covers SPEC-090 (section 4): the migration of the attempts goes down and up again.
func TestMigration00047_UpAndDown(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00047_")
	count := func() int64 {
		var n int64
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
			AND table_name IN ('assessment_attempts', 'assessment_attempt_items')`).Scan(&n).Error)
		return n
	}
	assert.Equal(t, int64(2), count())
	up48, down48 := migrationParts(t, "00048_") // the room of SPEC-091 points to the attempts
	runMigration(t, e, down48)
	runMigration(t, e, down)
	assert.Zero(t, count(), "the Down took the two tables away")
	runMigration(t, e, up)
	runMigration(t, e, up48)
	assert.Equal(t, int64(2), count(), "and they are back")
}
