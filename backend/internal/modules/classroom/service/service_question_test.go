package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- SPEC-058: the doubt that comes with the raised hand ----

// twoStudents puts the student of the world and a second one (Bruno) in the room, both admitted.
func twoStudents(t *testing.T, w *world, session uuid.UUID) service.Actor {
	t.Helper()
	bruno := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.repo.studentNames[bruno.UserID] = "Bruno"
	w.admit(session, w.student.UserID, bruno.UserID)
	return bruno
}

func questions(q []domain.HandRaiseEntry) []string {
	out := make([]string, len(q))
	for i, e := range q {
		out[i] = e.Name + ":" + e.Question
	}
	return out
}

// Covers SPEC-058 CA-08: a hand is raised with or without a question; the question is trimmed, and blanks only are no question.
func TestRaiseHand_WithAndWithoutAQuestion(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	bruno := twoStudents(t, w, s.ID)

	q, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "")
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana:"}, questions(q), "one click, no text")

	w.now = w.now.Add(time.Second)
	q, err = w.svc.RaiseHand(ctx, s.ID, bruno.UserID, "  Como funciona o fork?\n ")
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana:", "Bruno:Como funciona o fork?"}, questions(q), "trimmed, and in the queue with its place")
	assert.Equal(t, "Como funciona o fork?", w.repo.hands[1].question, "what the repository keeps is the trimmed text")

	third := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.repo.studentNames[third.UserID] = "Carla"
	w.admit(s.ID, third.UserID)
	w.now = w.now.Add(time.Second)
	q, err = w.svc.RaiseHand(ctx, s.ID, third.UserID, " \t\n ")
	require.NoError(t, err)
	assert.Equal(t, "Carla:", questions(q)[2], "blanks only is no question")
	assert.Empty(t, w.repo.hands[2].question)
}

// Covers SPEC-058 CA-08: raising the hand again, while it is up, only updates the question, and keeps the place in the queue; the question
// can be taken away by sending none.
func TestRaiseHand_AgainOnlyUpdatesTheQuestion(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	bruno := twoStudents(t, w, s.ID)

	_, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "primeira")
	require.NoError(t, err)
	w.now = w.now.Add(time.Second)
	_, err = w.svc.RaiseHand(ctx, s.ID, bruno.UserID, "")
	require.NoError(t, err)
	before, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)

	w.now = w.now.Add(time.Minute)
	q, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "segunda")
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana:segunda", "Bruno:"}, questions(q), "the question changed, the order did not")
	assert.Equal(t, before.HandRaises[0].RequestedAt, q[0].RequestedAt, "the hand is the same one: it did not go to the end of the queue")
	assert.Len(t, w.repo.hands, 2, "no second hand")

	q, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "")
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana:", "Bruno:"}, questions(q), "sending none takes the question away; the hand stays up")
}

// Covers SPEC-058 CA-08: a question over 300 characters or with a control character is refused, before it reaches the repository, and the
// hand does not change: a hand that was down stays down, and a hand that was up keeps its question.
func TestRaiseHand_RefusedQuestionChangesNothing(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)
	bad := []string{strings.Repeat("a", 301), strings.Repeat("😀", 301), "a\tb", "a\x00b", "a\r\nb", "a\n\n\n\nb", "a\xffb"}

	for _, question := range bad {
		_, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, question)
		assert.ErrorIs(t, err, domain.ErrInvalidQuestion, "%q", question)
	}
	assert.Zero(t, w.repo.raises, "a refused question never reached the repository")
	q, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.Empty(t, q.HandRaises, "the hand that was down stays down")

	_, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "a dúvida certa")
	require.NoError(t, err)
	raised := w.repo.raises
	for _, question := range bad {
		_, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, question)
		assert.ErrorIs(t, err, domain.ErrInvalidQuestion, "%q", question)
	}
	assert.Equal(t, raised, w.repo.raises)
	q, err = w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana:a dúvida certa"}, questions(q.HandRaises), "the hand that was up keeps its question")
}

// Covers SPEC-058 CA-08: the limit counts characters, not bytes: 300 characters of any size are accepted.
func TestRaiseHand_TheLimitIsPerCharacter(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)

	for _, text := range []string{strings.Repeat("a", 300), strings.Repeat("ã", 300), strings.Repeat("😀", 300)} {
		q, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, text)
		require.NoError(t, err)
		assert.Equal(t, text, q[0].Question)
	}
}

// Covers SPEC-058 CA-08: only an admitted student raises his hand, with or without a question (the waiting, the removed, a teacher), and
// nothing is kept for the others.
func TestRaiseHand_OnlyAnAdmittedStudentEvenWithAQuestion(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)

	_, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "posso entrar?")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "he never asked to come in")
	_, err = w.svc.Connect(ctx, w.student, w.class) // now he waits
	require.NoError(t, err)
	_, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "posso entrar?")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "waiting")
	_, err = w.svc.RaiseHand(ctx, s.ID, w.teacher.UserID, "pergunta do professor")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "a teacher has no hand to raise")
	_, err = w.svc.Remove(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	_, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "posso voltar?")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "removed")
	assert.Zero(t, w.repo.raises)

	_, err = w.svc.RaiseHand(ctx, uuid.New(), w.student.UserID, "outra sala")
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
}

// Covers SPEC-058 CA-05: when the student lowers his hand, or the teacher answers it or lowers every hand, the question goes with it: the
// next hand starts with none.
func TestHandQuestion_DoesNotSurviveItsHand(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	bruno := twoStudents(t, w, s.ID)

	for _, tc := range []struct {
		name string
		end  func() ([]domain.HandRaiseEntry, error)
	}{
		{"the student lowers it", func() ([]domain.HandRaiseEntry, error) { return w.svc.LowerHand(ctx, s.ID, w.student.UserID) }},
		{"the teacher answers it", func() ([]domain.HandRaiseEntry, error) { return w.svc.ModerateHand(ctx, s.ID, &w.student.UserID) }},
		{"the teacher lowers every hand", func() ([]domain.HandRaiseEntry, error) { return w.svc.ModerateHand(ctx, s.ID, nil) }},
	} {
		_, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "dúvida de "+tc.name)
		require.NoError(t, err, tc.name)
		_, err = w.svc.RaiseHand(ctx, s.ID, bruno.UserID, "dúvida do Bruno")
		require.NoError(t, err, tc.name)
		q, err := tc.end()
		require.NoError(t, err, tc.name)
		for _, e := range q {
			assert.NotEqual(t, "Ana", e.Name, tc.name)
		}
		for _, h := range w.repo.hands {
			if h.status != domain.HandPending {
				assert.Empty(t, h.question, "%s: the closed hand keeps no question", tc.name)
			}
		}

		w.now = w.now.Add(time.Second)
		q, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "")
		require.NoError(t, err, tc.name)
		for _, e := range q {
			if e.Name == "Ana" {
				assert.Empty(t, e.Question, "%s: the new hand starts with no question", tc.name)
			}
		}
		_, err = w.svc.ModerateHand(ctx, s.ID, nil)
		require.NoError(t, err)
	}
}

// Covers SPEC-058 CA-07: the state of the room carries the question of each raised hand, so that the handler can give it to the teacher
// (it is the handler that keeps it from the students).
func TestHandQuestion_IsInTheStateOfTheRoom(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)
	_, err := w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "Como funciona o fork?")
	require.NoError(t, err)

	for _, who := range []service.Actor{w.teacher, w.admin, w.student} {
		a, err := w.svc.GetActive(ctx, who, w.class)
		require.NoError(t, err)
		require.Len(t, a.HandRaises, 1)
		assert.Equal(t, "Como funciona o fork?", a.HandRaises[0].Question)
	}
	a, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, "Como funciona o fork?", a.HandRaises[0].Question)
}
