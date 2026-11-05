package service_test

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// startedExam is an online exam with one question, started by the teacher at 09:05 and with nobody admitted (SPEC-096).
func (f *fixture) startedExam(t *testing.T) service.Summary {
	t.Helper()
	q := f.addKind(kindSingle, `{"choice":"a"}`)
	a := f.create(t, func(in *service.CreateInput) {
		in.Modality, in.Items, in.MaxScore = ptr(domain.ModalityOnline), []domain.Item{{QuestionID: q, Position: 1, Weight: domain.Points(10)}}, domain.Points(10)
	})
	f.begin(t, a)
	return a
}

// Covers SPEC-096 CA-01, CA-03 (RN-02, RN-03): the start admits nobody: the student waits in the room, asking to enter, and the attempt is refused
// until the teacher admits her.
func TestStart_AdmitsNobody(t *testing.T) {
	f := newFixture(t)
	a := f.startedExam(t)
	f.now = at(21, 9, 10)
	entry, err := f.svc.EnterRoom(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, entry.Started)
	assert.True(t, entry.Waiting, "after the start she asks to enter")
	_, _, err = f.svc.EnterAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAttemptNotAdmitted)
	assert.Empty(t, f.repo.attempts)
}

// Covers SPEC-096 CA-02, CA-03, CA-04 (RN-01): the teacher admits one or many students, who then enter; one already admitted is ignored; the student
// with an attempt goes back to it; before the start, an empty list, more than 200 or a student who is not eligible are refused, and only the teacher
// who owns the class or the administrator admits.
func TestAdmit_SavesAndRefusesBeforeStartAndNotEligible(t *testing.T) {
	f := newFixture(t)
	q := f.addKind(kindSingle, `{"choice":"a"}`)
	a := f.create(t, func(in *service.CreateInput) {
		in.Modality, in.Items, in.MaxScore = ptr(domain.ModalityOnline), []domain.Item{{QuestionID: q, Position: 1, Weight: domain.Points(10)}}, domain.Points(10)
	})
	f.now = at(21, 9, 1)
	_, err := f.svc.Admit(ctx, f.teacher, f.class.ID, a.ID, []uuid.UUID{f.ana.ID})
	assert.ErrorIs(t, err, domain.ErrAssessmentNotStarted, "D-03: no admission before the start")

	f.begin(t, a)
	f.now = at(21, 9, 10)
	for name, ids := range map[string][]uuid.UUID{"empty": {}, "not eligible": {f.ana.ID, f.outsider.ID}, "more than 200": make([]uuid.UUID, 201)} {
		_, err = f.svc.Admit(ctx, f.teacher, f.class.ID, a.ID, ids)
		assert.ErrorIs(t, err, domain.ErrInvalidAdmission, name)
	}
	_, err = f.svc.Admit(ctx, f.as(f.ana), f.class.ID, a.ID, []uuid.UUID{f.ana.ID})
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.Admit(ctx, f.other, f.class.ID, a.ID, []uuid.UUID{f.ana.ID})
	assert.ErrorIs(t, err, domain.ErrForbidden)

	got, err := f.svc.Admit(ctx, f.teacher, f.class.ID, a.ID, []uuid.UUID{f.ana.ID, f.bruno.ID})
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{f.ana.ID, f.bruno.ID}, got)
	got, err = f.svc.Admit(ctx, f.admin, f.class.ID, a.ID, []uuid.UUID{f.ana.ID, f.carla.ID})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{f.carla.ID}, got, "the one already admitted is ignored")

	entry, err := f.svc.EnterRoom(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, entry.Waiting, "admitted, she is in")
	first, _, err := f.svc.EnterAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	again, created, err := f.svc.EnterAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, first.ID, again.ID, "she goes back to her attempt")
}

// Covers SPEC-096 CA-05 (RN-04, RN-05, D-02): finishing the exam ends the attempts in progress as ended by the teacher, with the fixed reason and the
// preliminary score, keeps the delivered ones, counts who did not come, and then refuses entering, admitting and finishing again.
func TestFinish_EndsTheAttemptsInProgressAndRefusesAfter(t *testing.T) {
	f := newFixture(t)
	a := f.startedExam(t)
	_, err := f.svc.Admit(ctx, f.teacher, f.class.ID, a.ID, []uuid.UUID{f.ana.ID, f.bruno.ID})
	require.NoError(t, err)
	f.now = at(21, 9, 10)
	ana := f.enter(t, f.ana, a)
	_, err = f.svc.SubmitAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	bruno := f.enter(t, f.bruno, a)
	require.NoError(t, f.svc.SaveAnswer(ctx, f.as(f.bruno), f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))

	_, err = f.svc.Finish(ctx, f.as(f.ana), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.Finish(ctx, f.other, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)

	f.now = at(21, 10, 0)
	got, err := f.svc.Finish(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, at(21, 10, 0), got.FinishedAt)
	assert.Equal(t, f.teacher.UserID, got.FinishedBy)
	assert.Equal(t, "Profa. Sediane", got.FinishedByName)
	assert.Equal(t, []uuid.UUID{f.bruno.ID}, got.Ended)
	assert.Equal(t, 1, got.Absent, "Carla did not come")

	closed := f.repo.attempts[[2]uuid.UUID{a.ID, f.bruno.ID}]
	assert.Equal(t, bruno.ID, closed.ID)
	assert.Equal(t, domain.AttemptEndedByTeacher, closed.Status)
	require.NotNil(t, closed.EndReason)
	assert.Equal(t, domain.FinishReason, *closed.EndReason)
	require.NotNil(t, closed.PreliminaryScore)
	assert.Equal(t, domain.Points(10), *closed.PreliminaryScore)
	assert.Equal(t, domain.AttemptSubmitted, f.repo.attempts[[2]uuid.UUID{a.ID, f.ana.ID}].Status, "the delivered one is kept")
	assert.Equal(t, ana.ID, f.repo.attempts[[2]uuid.UUID{a.ID, f.ana.ID}].ID)

	_, err = f.svc.Finish(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentFinished)
	_, err = f.svc.Admit(ctx, f.teacher, f.class.ID, a.ID, []uuid.UUID{f.carla.ID})
	assert.ErrorIs(t, err, domain.ErrAssessmentFinished)
	_, _, err = f.svc.EnterAttempt(ctx, f.as(f.carla), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentFinished)
	_, err = f.svc.EnterRoom(ctx, f.as(f.carla), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentFinished)
	access, err := f.svc.AccessOf(ctx, f.carla.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessEnded, access)
	detail, err := f.svc.Detail(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.PhaseEnded, detail.Phase)
	require.NotNil(t, detail.FinishedAt)
	assert.Equal(t, "Profa. Sediane", detail.FinishedByName)
}

// Covers SPEC-096 CA-05: an exam the teacher has not started cannot be finished.
func TestFinish_NeedsTheStart(t *testing.T) {
	f := newFixture(t)
	a := f.createOnline(t)
	f.now = at(21, 9, 10)
	_, err := f.svc.Finish(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotStarted)
}

// Covers SPEC-096 CA-06 (RN-06): after the end, the eligible students without an attempt come in the list as absent, with no attempt.
func TestAttempts_ListTheAbsentAfterTheEnd(t *testing.T) {
	f := newFixture(t)
	a := f.startedExam(t)
	_, err := f.svc.Admit(ctx, f.teacher, f.class.ID, a.ID, []uuid.UUID{f.ana.ID})
	require.NoError(t, err)
	f.now = at(21, 9, 10)
	f.enter(t, f.ana, a)
	rows, err := f.svc.Attempts(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Len(t, rows, 1, "while it runs, only who entered")

	_, err = f.svc.Finish(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	rows, err = f.svc.Attempts(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	require.Len(t, rows, 3)
	absent := map[string]service.AttemptRow{}
	for _, r := range rows {
		if r.Status == domain.AttemptAbsent {
			absent[r.StudentName] = r
		}
	}
	require.Len(t, absent, 2)
	assert.Equal(t, uuid.Nil, absent["Bruno"].AttemptID)
	assert.Equal(t, "1000003", absent["Carla"].AcademicID)
}
