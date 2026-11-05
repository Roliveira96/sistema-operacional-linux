package service_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

func texts(list []domain.ChatMessage) []string {
	out := make([]string, len(list))
	for i, m := range list {
		out[i] = m.Body
	}
	return out
}

// Covers SPEC-093 CA-01 (RN-01, RN-03): the message of the student is stored with the attempt, the question she is in and the instant of the server.
func TestSendChat_StudentGoesToTheAttemptWithThePosition(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	mine := f.enter(t, f.ana, a)
	f.now = at(21, 9, 30)

	m, err := f.svc.SendStudentChat(ctx, a.ID, f.ana.ID, ptr(4), "  Posso usar o man? ")
	require.NoError(t, err)
	assert.NotEqual(t, uuid.Nil, m.ID)
	assert.Equal(t, "Posso usar o man?", m.Body)
	require.NotNil(t, m.AttemptID)
	assert.Equal(t, mine.ID, *m.AttemptID)
	require.NotNil(t, m.StudentID)
	assert.Equal(t, f.ana.ID, *m.StudentID)
	assert.Equal(t, f.ana.ID, m.SenderID)
	assert.Equal(t, domain.ChatStudent, m.SenderRole)
	require.NotNil(t, m.Position)
	assert.Equal(t, 4, *m.Position)
	assert.Equal(t, domain.ChatPrivate, m.Scope())
	assert.True(t, m.CreatedAt.Equal(at(21, 9, 30)))

	list, err := f.svc.StudentChat(ctx, a.ID, f.ana.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Posso usar o man?"}, texts(list))
}

// Covers SPEC-093 CA-02 (RN-01, RN-03, RN-05, D-01): the teacher writes to one student, or to all those doing the exam, who are kept as the ones who
// received it; a student who delivered gets nothing.
func TestSendChat_TeacherPrivateAndToAllWithRecipients(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	ana := f.enter(t, f.ana, a)
	f.enter(t, f.bruno, a)

	f.now = at(21, 9, 20)
	m, to, err := f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, &f.ana.ID, ptr(2), "Leia o enunciado de novo")
	require.NoError(t, err)
	require.NotNil(t, m.AttemptID)
	assert.Equal(t, ana.ID, *m.AttemptID)
	assert.Equal(t, domain.ChatTeacher, m.SenderRole)
	assert.Equal(t, 2, *m.Position)
	assert.Equal(t, []uuid.UUID{f.ana.ID}, to)

	_, err = f.svc.SubmitAttempt(ctx, f.as(f.bruno), f.class.ID, a.ID)
	require.NoError(t, err)
	f.now = at(21, 9, 25)
	all, to, err := f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, nil, nil, "A questão 3 tem um erro de digitação")
	require.NoError(t, err)
	assert.Nil(t, all.AttemptID)
	assert.Nil(t, all.Position)
	assert.Equal(t, domain.ChatAll, all.Scope())
	assert.Equal(t, []uuid.UUID{f.ana.ID}, to, "only who is doing the exam")

	list, err := f.svc.StudentChat(ctx, a.ID, f.ana.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Leia o enunciado de novo", "A questão 3 tem um erro de digitação"}, texts(list))
	list, err = f.svc.StudentChat(ctx, a.ID, f.bruno.ID)
	require.NoError(t, err)
	assert.Empty(t, list, "Bruno had delivered")
	room, err := f.svc.RoomChat(ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, room, 2)

	_, _, err = f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, &f.bruno.ID, nil, "Oi")
	assert.ErrorIs(t, err, domain.ErrAttemptAlreadySubmitted)
	_, _, err = f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, &f.carla.ID, nil, "Oi")
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound, "Carla has not entered")
	_, _, err = f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, nil, nil, " ")
	assert.ErrorIs(t, err, domain.ErrInvalidChat)
}

// Covers SPEC-093 CA-03 (RN-01, RN-02): a student who waits, who delivered or who is not of the exam cannot write, nor a text out of the rules; nothing
// is stored.
func TestSendChat_RefusesWaitingDeliveredEndedAndOtherRoles(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	_, err := f.svc.SendStudentChat(ctx, a.ID, f.ana.ID, nil, "Oi")
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound, "in the waiting room there is no attempt yet")
	_, err = f.svc.SendStudentChat(ctx, a.ID, f.outsider.ID, nil, "Oi")
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)

	f.enter(t, f.ana, a)
	for _, bad := range []string{"", "  ", strings.Repeat("a", 501), "a\x00b"} {
		_, err = f.svc.SendStudentChat(ctx, a.ID, f.ana.ID, nil, bad)
		assert.ErrorIs(t, err, domain.ErrInvalidChat)
	}
	_, err = f.svc.SubmitAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	_, err = f.svc.SendStudentChat(ctx, a.ID, f.ana.ID, nil, "Oi")
	assert.ErrorIs(t, err, domain.ErrAttemptAlreadySubmitted)

	room, err := f.svc.RoomChat(ctx, a.ID)
	require.NoError(t, err)
	assert.Empty(t, room)
}

// Covers SPEC-093 CA-06 (RN-07, D-01): the teacher reads the whole conversation of an attempt, with the messages to all it received and who wrote each;
// the list of the attempts has the count of each one.
func TestAttemptChat_GivesTheConversationAndTheMessagesToAllReceived(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	ana := f.enter(t, f.ana, a)
	f.enter(t, f.bruno, a)
	f.now = at(21, 9, 10)
	_, err := f.svc.SendStudentChat(ctx, a.ID, f.ana.ID, ptr(1), "Posso?")
	require.NoError(t, err)
	f.now = at(21, 9, 15)
	_, _, err = f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, &f.bruno.ID, nil, "Bruno, atenção ao tempo")
	require.NoError(t, err)
	f.now = at(21, 9, 20)
	_, _, err = f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, nil, nil, "Faltam 30 minutos")
	require.NoError(t, err)
	f.now = at(21, 9, 30)
	_, _, err = f.svc.SendTeacherChat(ctx, a.ID, f.teacher.UserID, &f.ana.ID, nil, "Pode")
	require.NoError(t, err)

	lines, err := f.svc.AttemptChat(ctx, f.teacher, f.class.ID, a.ID, ana.ID)
	require.NoError(t, err)
	require.Len(t, lines, 3)
	assert.Equal(t, "Posso?", lines[0].Body)
	assert.Equal(t, "Ana", lines[0].SenderName)
	assert.Equal(t, "Faltam 30 minutos", lines[1].Body)
	assert.Equal(t, domain.ChatAll, lines[1].Scope())
	assert.Equal(t, "Profa. Sediane", lines[1].SenderName)
	assert.Equal(t, "Pode", lines[2].Body)
	_, err = f.svc.AttemptChat(ctx, f.admin, f.class.ID, a.ID, ana.ID)
	assert.NoError(t, err, "the administrator reads it too")

	rows, err := f.svc.Attempts(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	counts := map[uuid.UUID]int{}
	for _, r := range rows {
		counts[r.StudentID] = r.ChatCount
	}
	assert.Equal(t, map[uuid.UUID]int{f.ana.ID: 3, f.bruno.ID: 2}, counts)
}

// Covers SPEC-093 CA-06 (RN-07, D-03): a student and the teacher of another class cannot read a conversation; an attempt of another exam is not found.
func TestAttemptChat_ForbiddenToStudentsAndOtherTeachers(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	ana := f.enter(t, f.ana, a)
	_, err := f.svc.AttemptChat(ctx, f.as(f.ana), f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.AttemptChat(ctx, f.other, f.class.ID, a.ID, ana.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.AttemptChat(ctx, f.teacher, f.class.ID, a.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)
}
