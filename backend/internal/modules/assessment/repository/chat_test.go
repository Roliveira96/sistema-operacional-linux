package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-093 section 4: the migration of the conversation goes up and down.
func TestMigration00050_UpAndDown(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00050_")
	count := func() int64 {
		var n int64
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
			AND table_name IN ('assessment_chat_messages', 'assessment_chat_recipients')`).Scan(&n).Error)
		return n
	}
	assert.Equal(t, int64(2), count())
	runMigration(t, e, down)
	assert.Zero(t, count())
	runMigration(t, e, up)
	assert.Equal(t, int64(2), count())
}

// Covers SPEC-093 CA-04, CA-06 (RN-03, RN-04, RN-06, D-01): the messages are stored with their conversation, the ones to all with who received them, and
// read in the order of time: of an attempt, of the whole exam (the last ones) and counted by attempt. The database refuses an empty text and a
// message of a student without an attempt.
func TestChatMessages_InsertOnlyAndOrderedByTime(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	at, _ := e.attempt(t, a)
	position := 2
	later := domain.ChatMessage{AssessmentID: a.ID, AttemptID: &at.ID, SenderID: e.student.ID, SenderRole: domain.ChatStudent, Position: &position, Body: "Obrigada", CreatedAt: e.now.Add(2 * time.Minute)}
	first := domain.ChatMessage{AssessmentID: a.ID, AttemptID: &at.ID, SenderID: e.teacher.ID, SenderRole: domain.ChatTeacher, Position: &position, Body: "Leia de novo", CreatedAt: e.now}
	all := domain.ChatMessage{AssessmentID: a.ID, SenderID: e.teacher.ID, SenderRole: domain.ChatTeacher, Body: "Faltam 10 minutos", CreatedAt: e.now.Add(time.Minute)}
	require.NoError(t, e.repo.SaveChat(e.ctx, &later, nil))
	require.NoError(t, e.repo.SaveChat(e.ctx, &first, nil))
	require.NoError(t, e.repo.SaveChat(e.ctx, &all, []uuid.UUID{at.ID}))
	assert.NotZero(t, first.ID)

	list, err := e.repo.AttemptChat(e.ctx, at.ID)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []string{"Leia de novo", "Faltam 10 minutos", "Obrigada"}, []string{list[0].Body, list[1].Body, list[2].Body})
	require.NotNil(t, list[0].StudentID)
	assert.Equal(t, e.student.ID, *list[0].StudentID)
	assert.Equal(t, 2, *list[0].Position)
	assert.Equal(t, domain.ChatTeacher, list[0].SenderRole)
	assert.Nil(t, list[1].AttemptID)
	assert.Nil(t, list[1].StudentID)

	last, err := e.repo.AssessmentChat(e.ctx, a.ID, 2)
	require.NoError(t, err)
	require.Len(t, last, 2)
	assert.Equal(t, "Faltam 10 minutos", last[0].Body, "the last ones, oldest first")

	counts, err := e.repo.ChatCounts(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]int{at.ID: 3}, counts)

	assert.Error(t, e.repo.SaveChat(e.ctx, &domain.ChatMessage{AssessmentID: a.ID, AttemptID: &at.ID, SenderID: e.student.ID, SenderRole: domain.ChatStudent, Body: "", CreatedAt: e.now}, nil))
	assert.Error(t, e.repo.SaveChat(e.ctx, &domain.ChatMessage{AssessmentID: a.ID, SenderID: e.student.ID, SenderRole: domain.ChatStudent, Body: "Oi", CreatedAt: e.now}, nil),
		"a message of a student is always of its attempt")
}
