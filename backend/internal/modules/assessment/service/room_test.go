package service_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// ---- RN-01, RN-02: entering the room ----

// Covers SPEC-091 CA-01, CA-02 (RN-01, RN-02): the teacher of the class and the administrator are the controller of the room; an eligible student
// waits until the start and enters after it; anyone else is refused; out of the phase the room is closed with the reason.
func TestEnterRoom_WhoAndWhen(t *testing.T) {
	f := newFixture(t)
	a := f.createOnline(t)

	f.now = at(21, 9, 1)
	got, err := f.svc.EnterRoom(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, got.Controller)
	got, err = f.svc.EnterRoom(ctx, f.admin, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, got.Controller)
	got, err = f.svc.EnterRoom(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, got.Controller)
	assert.True(t, got.Waiting, "before the start the student waits")

	f.begin(t, a)
	got, err = f.svc.EnterRoom(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, got.Waiting, "after the start the student is in")

	_, err = f.svc.EnterRoom(ctx, f.other, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.EnterRoom(ctx, f.as(f.outsider), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrNotEligible)

	f.now = at(21, 8, 59)
	_, err = f.svc.EnterRoom(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotOpenYet)
	f.now = at(21, 11, 1)
	_, err = f.svc.EnterRoom(ctx, f.teacher, f.class.ID, a.ID)
	assert.NoError(t, err, "within the tolerance of the end")
	f.now = at(21, 11, 2)
	_, err = f.svc.EnterRoom(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentEnded)

	f.now = at(20, 8, 0)
	canceled := f.createOnline(t)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	f.now = at(21, 10, 0)
	_, err = f.svc.EnterRoom(ctx, f.teacher, f.class.ID, canceled.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentCanceled)
}

// ---- RN-04: the cards ----

// Covers SPEC-091 CA-04 (RN-04): a card for each eligible student, absent until they enter, with the progress of the attempt, the deadline and the
// open hand.
func TestRoomState_TheCards(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.enter(t, f.ana, a)
	me := f.as(f.ana)
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"value":true}`)))
	_, err := f.svc.CheckAnswer(ctx, me, f.class.ID, a.ID, 4, json.RawMessage(`{"solved":true}`))
	require.NoError(t, err)
	_, err = f.svc.RaiseHand(ctx, a.ID, f.ana.ID, ptr(4), "Não entendi o enunciado")
	require.NoError(t, err)

	state, err := f.svc.RoomState(ctx, a.ID)
	require.NoError(t, err)
	require.NotNil(t, state.StartedAt)
	assert.Equal(t, "Profa. Sediane", state.StartedByName)
	require.Len(t, state.Cards, 3, "Ana, Bruno and Carla")
	byName := map[string]service.RoomCard{}
	for _, c := range state.Cards {
		byName[c.Name] = c
	}
	ana := byName["Ana"]
	assert.Equal(t, "IN_PROGRESS", ana.Status)
	require.NotNil(t, ana.AttemptID, "the room ends an attempt by its id")
	assert.Nil(t, byName["Bruno"].AttemptID)
	assert.Equal(t, 2, ana.Answered, "the true or false and the practical")
	assert.Equal(t, 5, ana.Total)
	assert.Equal(t, 1, ana.Solved)
	require.NotNil(t, ana.DeadlineAt)
	require.NotNil(t, ana.Help)
	assert.Equal(t, "Não entendi o enunciado", ana.Help.Question)
	assert.Equal(t, "ABSENT", byName["Bruno"].Status)
	assert.Nil(t, byName["Bruno"].Help)
	require.Len(t, state.Queue, 1)

	card, err := f.svc.RoomCard(ctx, a.ID, f.ana.ID)
	require.NoError(t, err)
	assert.Equal(t, ana, card)
}

// ---- RN-06: the commands ----

// Covers SPEC-091 CA-06 (RN-06, D-05): each command of the attempt is stored with its question, cut to the limits, at the clock of the server or at
// the original instant of a resend when that is within the attempt; only an attempt in progress takes commands.
func TestRecordCommand_StoresAndLists(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.enter(t, f.ana, a) // at 09:05
	f.now = at(21, 9, 30)

	got, err := f.svc.RecordCommand(ctx, a.ID, f.ana.ID, service.CommandInput{Position: 4, Command: "mkdir /a", Output: ""})
	require.NoError(t, err)
	assert.True(t, got.ExecutedAt.Equal(at(21, 9, 30)), "the clock of the server")
	resent := at(21, 9, 20)
	got, err = f.svc.RecordCommand(ctx, a.ID, f.ana.ID, service.CommandInput{Position: 4, Command: "ls", Output: strings.Repeat("x", 5000), At: &resent})
	require.NoError(t, err)
	assert.True(t, got.ExecutedAt.Equal(resent), "the original instant of a resend")
	assert.Len(t, got.Output, 4000)
	future := at(21, 9, 40)
	got, err = f.svc.RecordCommand(ctx, a.ID, f.ana.ID, service.CommandInput{Position: 4, Command: strings.Repeat("y", 1200), At: &future})
	require.NoError(t, err)
	assert.True(t, got.ExecutedAt.Equal(at(21, 9, 30)), "an instant after the receipt is not taken")
	assert.Len(t, got.Command, 1000)

	list, err := f.svc.StudentCommands(ctx, a.ID, f.ana.ID)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, "ls", list[0].Command, "in the order they ran")

	_, err = f.svc.RecordCommand(ctx, a.ID, f.bruno.ID, service.CommandInput{Position: 4, Command: "ls"})
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)
	_, err = f.svc.SubmitAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	_, err = f.svc.RecordCommand(ctx, a.ID, f.ana.ID, service.CommandInput{Position: 4, Command: "ls"})
	assert.ErrorIs(t, err, domain.ErrAttemptAlreadySubmitted)
}

// ---- RN-07: the help ----

// Covers SPEC-091 CA-07 (RN-07, D-03): one open request for each student; the student lowers it; the teacher answers it with an optional text that
// the student reads; the queue is the open ones, oldest first.
func TestHelp_RaiseLowerAndAnswer(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.enter(t, f.ana, a)
	f.enter(t, f.bruno, a)

	f.now = at(21, 9, 30)
	first, err := f.svc.RaiseHand(ctx, a.ID, f.ana.ID, ptr(2), "  Posso usar o manual?  ")
	require.NoError(t, err)
	assert.Equal(t, "Posso usar o manual?", first.Question)
	assert.Equal(t, domain.HelpOpen, first.Status)
	again, err := f.svc.RaiseHand(ctx, a.ID, f.ana.ID, nil, "")
	require.NoError(t, err)
	assert.Equal(t, first.ID, again.ID, "one open request")
	f.now = at(21, 9, 31)
	_, err = f.svc.RaiseHand(ctx, a.ID, f.bruno.ID, nil, "")
	require.NoError(t, err)
	_, err = f.svc.RaiseHand(ctx, a.ID, f.carla.ID, nil, "")
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound, "only who is doing the exam")
	_, err = f.svc.RaiseHand(ctx, a.ID, f.bruno.ID, nil, strings.Repeat("a", 301))
	assert.ErrorIs(t, err, domain.ErrInvalidHelp)

	queue, err := f.svc.HelpQueue(ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, queue, 2)
	assert.Equal(t, f.ana.ID, queue[0].StudentID)

	require.NoError(t, f.svc.LowerHand(ctx, a.ID, f.bruno.ID))
	mine, err := f.svc.MyHelp(ctx, a.ID, f.bruno.ID)
	require.NoError(t, err)
	require.NotNil(t, mine)
	assert.Equal(t, domain.HelpCanceled, mine.Status)

	f.now = at(21, 9, 35)
	answered, err := f.svc.AnswerHelp(ctx, a.ID, f.teacher.UserID, first.ID, "Não, só o terminal.")
	require.NoError(t, err)
	assert.Equal(t, domain.HelpAnswered, answered.Status)
	assert.Equal(t, "Não, só o terminal.", answered.Answer)
	mine, err = f.svc.MyHelp(ctx, a.ID, f.ana.ID)
	require.NoError(t, err)
	assert.Equal(t, "Não, só o terminal.", mine.Answer, "the student reads the answer")
	_, err = f.svc.AnswerHelp(ctx, a.ID, f.teacher.UserID, first.ID, "")
	assert.ErrorIs(t, err, domain.ErrHelpNotFound, "a closed request is not answered again")
	_, err = f.svc.AnswerHelp(ctx, a.ID, f.teacher.UserID, uuid.New(), "")
	assert.ErrorIs(t, err, domain.ErrHelpNotFound)

	queue, err = f.svc.HelpQueue(ctx, a.ID)
	require.NoError(t, err)
	assert.Empty(t, queue)
}

// ---- RN-08: ending the exam of a student ----

// Covers SPEC-091 CA-08 (RN-08): the teacher ends the attempt in progress of a student with a reason; it is ENDED_BY_TEACHER with who, when and why,
// and graded like a delivery; a delivered one is refused; the reason is required and limited.
func TestEndAttempt_ByTheTeacher(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	got := f.enter(t, f.ana, a)
	require.NoError(t, f.svc.SaveAnswer(ctx, f.as(f.ana), f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))

	_, err := f.svc.EndAttempt(ctx, f.teacher, f.class.ID, a.ID, got.ID, "  ")
	assert.ErrorIs(t, err, domain.ErrInvalidReason)
	_, err = f.svc.EndAttempt(ctx, f.teacher, f.class.ID, a.ID, got.ID, strings.Repeat("r", 501))
	assert.ErrorIs(t, err, domain.ErrInvalidReason)
	_, err = f.svc.EndAttempt(ctx, f.other, f.class.ID, a.ID, got.ID, "Cola")
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.EndAttempt(ctx, f.teacher, f.class.ID, a.ID, uuid.New(), "Cola")
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)

	f.now = at(21, 10, 0)
	row, err := f.svc.EndAttempt(ctx, f.teacher, f.class.ID, a.ID, got.ID, "Flagrante de cola")
	require.NoError(t, err)
	assert.Equal(t, domain.AttemptEndedByTeacher, row.Status)
	assert.Equal(t, "Profa. Sediane", row.EndedByName)
	assert.Equal(t, "Flagrante de cola", row.EndReason)
	require.NotNil(t, row.PreliminaryScore)
	assert.Equal(t, domain.Points(2), *row.PreliminaryScore, "graded like a delivery")
	stored := f.repo.attempts[[2]uuid.UUID{a.ID, f.ana.ID}]
	assert.True(t, stored.SubmittedAt.Equal(at(21, 10, 0)))
	require.NotNil(t, stored.EndedBy)
	assert.Equal(t, f.teacher.UserID, *stored.EndedBy)

	_, err = f.svc.EndAttempt(ctx, f.teacher, f.class.ID, a.ID, got.ID, "De novo")
	assert.ErrorIs(t, err, domain.ErrAttemptAlreadySubmitted)
	err = f.svc.SaveAnswer(ctx, f.as(f.ana), f.class.ID, a.ID, 1, json.RawMessage(`{"value":true}`))
	assert.ErrorIs(t, err, domain.ErrAttemptAlreadySubmitted, "the student cannot answer any more")
}
