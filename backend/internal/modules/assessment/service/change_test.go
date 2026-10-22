package service_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

func (f *fixture) lastEvent(t *testing.T, id uuid.UUID) domain.Event {
	t.Helper()
	events := f.repo.events[id]
	require.NotEmpty(t, events, "the history has no event")
	return events[len(events)-1]
}

// ---- RN-10: freezing and updating ----

// Covers SPEC-075 CA-11 (RN-10): before the start the composition changes; from the start on it is refused, while the title, the
// instructions and the audience (only wider) still change.
func TestUpdate_FrozenRefusesCompositionAndAcceptsTitleNotesAndWiderAudience(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)

	// before the start: the composition is open, and it is checked again as a whole
	newItems := f.items(2)
	got, err := f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Items: &newItems})
	require.NoError(t, err)
	assert.Equal(t, 2, got.TotalQuestions)
	assert.Equal(t, f.teacher.UserID, got.UpdatedBy)
	assert.Equal(t, "Profa. Sediane", got.UpdatedByName)

	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{MaxScore: ptr(domain.Points(20))})
	assert.ErrorIs(t, err, domain.ErrWeightsMismatch, "changing the score alone leaves the weights short")

	// from the start instant on
	f.now = at(21, 9, 0)
	frozen := map[string]service.UpdateInput{
		"module":      {ModuleID: &f.module.ID},
		"type":        {Type: ptr(domain.TypeAssignment)},
		"max score":   {MaxScore: ptr(domain.Points(10))},
		"duration":    {DurationMinutes: ptr(30)},
		"composition": {Composition: ptr(domain.CompositionDraw), Draw: f.draw(3, 3, 4, 1, 1, 1)},
		"items":       {Items: &newItems},
		"draw":        {Draw: f.draw(3, 3, 4, 1, 1, 1)},
	}
	writes := f.repo.writes
	for name, in := range frozen {
		_, err := f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, in)
		assert.ErrorIs(t, err, domain.ErrAssessmentFrozen, name)
	}
	assert.Equal(t, writes, f.repo.writes, "nothing was written")

	f.now = at(21, 9, 30)
	got, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Title: ptr("Prova 1 (revisada)"), Description: ptr("Leia de novo.")})
	require.NoError(t, err)
	assert.Equal(t, "Prova 1 (revisada)", got.Title)
	assert.Equal(t, "Leia de novo.", got.Description)
	assert.True(t, got.Frozen)
	assert.Equal(t, domain.PhaseRunning, got.Phase)
	last := f.lastEvent(t, a.ID)
	assert.Equal(t, domain.EventUpdated, last.Kind)
	assert.ElementsMatch(t, []string{"title", "description"}, last.ChangedFields)
	assert.Equal(t, f.teacher.UserID, last.ActorID)
	assert.True(t, f.repo.assessments[a.ID].UpdatedAt.Equal(f.now), "updated_at is the moment of the change")
	assert.Equal(t, f.teacher.UserID, f.repo.assessments[a.ID].UpdatedBy)
}

// Covers SPEC-075 CA-11 (RN-10): once started, the audience can grow (add students, or go to ALL_CLASS) and never shrink.
func TestUpdate_FrozenRefusesToNarrowTheAudience(t *testing.T) {
	f := newFixture(t)
	a := f.create(t, func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.ana.ID, f.bruno.ID}
	})
	f.now = at(21, 9, 30)

	narrower := []uuid.UUID{f.ana.ID}
	_, err := f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Audience: ptr(domain.AudienceSelected), StudentIDs: &narrower})
	assert.ErrorIs(t, err, domain.ErrAssessmentFrozen, "removing a student")

	wider := []uuid.UUID{f.ana.ID, f.bruno.ID, f.carla.ID}
	got, err := f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Audience: ptr(domain.AudienceSelected), StudentIDs: &wider})
	require.NoError(t, err)
	assert.Equal(t, 3, got.EligibleStudents)
	assert.ElementsMatch(t, wider, f.repo.students[a.ID])

	got, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Audience: ptr(domain.AudienceAllClass)})
	require.NoError(t, err)
	assert.Equal(t, domain.AudienceAllClass, got.Audience)

	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Audience: ptr(domain.AudienceSelected), StudentIDs: &narrower})
	assert.ErrorIs(t, err, domain.ErrAssessmentFrozen, "going from the whole class to a few is narrowing too")
}

// Covers SPEC-075 CA-16 (RN-12): a canceled assessment accepts no change.
func TestUpdate_CanceledRefusesEverything(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, "Greve")
	require.NoError(t, err)
	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Title: ptr("Outro")})
	assert.ErrorIs(t, err, domain.ErrAssessmentCanceled)
}

// ---- RN-11: rescheduling ----

// Covers SPEC-075 CA-12, CA-18 (RN-11, RN-15): before the start both dates change, and the event keeps the old and the new ones.
func TestReschedule_BeforeStartWritesOldAndNewDates(t *testing.T) {
	f := newFixture(t)
	lesson := f.lesson("Tema", true)
	a := f.create(t, func(in *service.CreateInput) {
		in.ClassSessionID, in.StartsAt, in.EndsAt = &lesson.ID, ptr(at(21, 9, 0)), ptr(at(21, 11, 0))
	})
	before := f.lessons.lessons[lesson.ID]

	got, err := f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(22, 14, 0), EndsAt: at(22, 16, 0)})
	require.NoError(t, err)
	assert.True(t, got.StartsAt.Equal(at(22, 14, 0)))
	assert.True(t, got.EndsAt.Equal(at(22, 16, 0)))
	assert.Equal(t, f.teacher.UserID, got.UpdatedBy)

	e := f.lastEvent(t, a.ID)
	assert.Equal(t, domain.EventRescheduled, e.Kind)
	assert.Equal(t, f.teacher.UserID, e.ActorID)
	require.NotNil(t, e.OldStartsAt)
	require.NotNil(t, e.NewEndsAt)
	assert.True(t, e.OldStartsAt.Equal(at(21, 9, 0)))
	assert.True(t, e.OldEndsAt.Equal(at(21, 11, 0)))
	assert.True(t, e.NewStartsAt.Equal(at(22, 14, 0)))
	assert.True(t, e.NewEndsAt.Equal(at(22, 16, 0)))
	assert.Nil(t, e.Reason, "the reason is optional before the start")
	assert.Equal(t, before, f.lessons.lessons[lesson.ID], "the lesson does not move")

	_, err = f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(23, 14, 0), EndsAt: at(23, 16, 0), Reason: "Laboratório ocupado"})
	require.NoError(t, err)
	require.NotNil(t, f.lastEvent(t, a.ID).Reason)
	assert.Equal(t, "Laboratório ocupado", *f.lastEvent(t, a.ID).Reason)

	_, err = f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(19, 9, 0), EndsAt: at(19, 11, 0)})
	assert.ErrorIs(t, err, domain.ErrInvalidPeriod, "a start in the past")
}

// Covers SPEC-075 CA-13 (RN-11, D-07): in progress only the end is pushed later, with a reason, and the start is kept.
func TestReschedule_RunningOnlyExtendsTheEndAndNeedsReason(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.now = at(21, 10, 0)
	writes := f.repo.writes

	_, err := f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(21, 9, 0), EndsAt: at(21, 12, 0)})
	assert.ErrorIs(t, err, domain.ErrReasonRequired)
	_, err = f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(21, 9, 30), EndsAt: at(21, 12, 0), Reason: "x"})
	assert.ErrorIs(t, err, domain.ErrInvalidPeriod, "the start cannot change")
	_, err = f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(21, 9, 0), EndsAt: at(21, 10, 30), Reason: "x"})
	assert.ErrorIs(t, err, domain.ErrInvalidPeriod, "the end cannot come earlier")
	assert.Equal(t, writes, f.repo.writes)

	got, err := f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(21, 9, 0), EndsAt: at(21, 12, 0), Reason: "Queda de rede"})
	require.NoError(t, err)
	assert.True(t, got.StartsAt.Equal(at(21, 9, 0)))
	assert.True(t, got.EndsAt.Equal(at(21, 12, 0)))
	assert.Equal(t, domain.PhaseRunning, got.Phase)
	e := f.lastEvent(t, a.ID)
	assert.Equal(t, domain.EventRescheduled, e.Kind)
	require.NotNil(t, e.Reason)
	assert.Equal(t, "Queda de rede", *e.Reason)
}

// Covers SPEC-075 CA-14 (RN-11): after the end, or once canceled, nothing is rescheduled.
func TestReschedule_EndedOrCanceledIsRefused(t *testing.T) {
	f := newFixture(t)
	ended := f.create(t)
	canceled := f.create(t)
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)

	f.now = at(21, 11, 0)
	_, err = f.svc.Reschedule(ctx, f.teacher, f.class.ID, ended.ID, service.RescheduleInput{StartsAt: at(22, 9, 0), EndsAt: at(22, 11, 0), Reason: "x"})
	assert.ErrorIs(t, err, domain.ErrAssessmentEnded)
	_, err = f.svc.Reschedule(ctx, f.teacher, f.class.ID, canceled.ID, service.RescheduleInput{StartsAt: at(22, 9, 0), EndsAt: at(22, 11, 0), Reason: "x"})
	assert.ErrorIs(t, err, domain.ErrAssessmentCanceled)
}

// ---- RN-12: canceling ----

// Covers SPEC-075 CA-15, CA-18 (RN-12, RN-15, D-09): canceling keeps who, when and why, writes the event, keeps the link only as history and
// leaves the lesson alone; the lesson can be converted again.
func TestCancel_WritesWhoWhenAndWhyAndKeepsTheSession(t *testing.T) {
	f := newFixture(t)
	lesson := f.lesson("Tema", true)
	a := f.create(t, func(in *service.CreateInput) { in.ClassSessionID, in.StartsAt, in.EndsAt = &lesson.ID, nil, nil })
	before := f.lessons.lessons[lesson.ID]

	f.now = at(20, 9, 15)
	got, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, "Falta de energia no câmpus")
	require.NoError(t, err)
	assert.Equal(t, domain.StatusCanceled, got.Status)
	require.NotNil(t, got.CancelReason)
	assert.Equal(t, "Falta de energia no câmpus", *got.CancelReason)
	require.NotNil(t, got.CanceledBy)
	assert.Equal(t, f.teacher.UserID, *got.CanceledBy)
	require.NotNil(t, got.CanceledAt)
	assert.True(t, got.CanceledAt.Equal(f.now))

	e := f.lastEvent(t, a.ID)
	assert.Equal(t, domain.EventCanceled, e.Kind)
	assert.Equal(t, f.teacher.UserID, e.ActorID)
	require.NotNil(t, e.Reason)
	assert.Equal(t, "Falta de energia no câmpus", *e.Reason)

	stored := f.repo.assessments[a.ID]
	require.NotNil(t, stored.ClassSessionID, "the link stays, as history")
	assert.Equal(t, lesson.ID, *stored.ClassSessionID)
	assert.Equal(t, before, f.lessons.lessons[lesson.ID], "the lesson stays as it was")

	again := f.input()
	again.ClassSessionID, again.StartsAt, again.EndsAt = &lesson.ID, nil, nil
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, again)
	assert.NoError(t, err, "the lesson is free again")
}

// Covers SPEC-075 CA-15, CA-16 (RN-12, D-12): a reason is required, a second cancel is refused and so is one with homologated grades.
func TestCancel_RequiresReasonAndRefusesRepeatAndHomologatedGrades(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)

	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, "")
	assert.ErrorIs(t, err, domain.ErrReasonRequired)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, "   ")
	assert.ErrorIs(t, err, domain.ErrReasonRequired)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, strOf(501))
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment)
	assert.Equal(t, domain.StatusScheduled, f.repo.assessments[a.ID].Status)

	graded := f.create(t)
	f.homolog.homologated[graded.ID] = true
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, graded.ID, "Erro de cadastro")
	assert.ErrorIs(t, err, domain.ErrGradesHomologated)
	assert.Equal(t, domain.StatusScheduled, f.repo.assessments[graded.ID].Status)

	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, strOf(500))
	require.NoError(t, err)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, "De novo")
	assert.ErrorIs(t, err, domain.ErrAssessmentCanceled)
}

// ---- RN-13: the private notes ----

// Covers SPEC-075 CA-10 (RN-13, D-10): the notes are saved in any phase and status, without touching updated_by, updated_at or the history.
func TestPrivateNotes_AnyPhaseAnyStatusAndNoAuditNoUpdatedBy(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	stored := f.repo.assessments[a.ID]
	writes := f.repo.writes

	saved, err := f.svc.SaveNotes(ctx, f.teacher, f.class.ID, a.ID, "Atenção na questão 3 sobre permissão octal")
	require.NoError(t, err)
	assert.Equal(t, "Atenção na questão 3 sobre permissão octal", saved)

	after := f.repo.assessments[a.ID]
	assert.Equal(t, stored.UpdatedBy, after.UpdatedBy)
	assert.True(t, stored.UpdatedAt.Equal(after.UpdatedAt), "saving the notes is not changing the assessment")
	assert.Len(t, f.repo.events[a.ID], 1, "and it writes no event")
	assert.Equal(t, writes, f.repo.writes)

	canceled := f.create(t, func(in *service.CreateInput) { in.StartsAt, in.EndsAt = ptr(at(23, 9, 0)), ptr(at(23, 11, 0)) })
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)

	f.now = at(21, 10, 0)
	_, err = f.svc.SaveNotes(ctx, f.admin, f.class.ID, a.ID, "Gabarito comentado na gaveta")
	assert.NoError(t, err, "in progress, and by the administrator")

	f.now = at(21, 12, 0)
	_, err = f.svc.SaveNotes(ctx, f.teacher, f.class.ID, a.ID, "Depois do fim")
	assert.NoError(t, err, "after the end")

	_, err = f.svc.SaveNotes(ctx, f.teacher, f.class.ID, canceled.ID, "Depois de cancelada")
	assert.NoError(t, err, "even when canceled")

	cleared, err := f.svc.SaveNotes(ctx, f.teacher, f.class.ID, a.ID, "")
	require.NoError(t, err)
	assert.Empty(t, cleared)
	assert.Nil(t, f.repo.assessments[a.ID].TeacherPrivateNotes, "an empty text clears the notes")

	_, err = f.svc.SaveNotes(ctx, f.teacher, f.class.ID, a.ID, strOf(5001))
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment)
	_, err = f.svc.SaveNotes(ctx, f.teacher, f.class.ID, a.ID, strOf(5000))
	assert.NoError(t, err)

	_, err = f.svc.SaveNotes(ctx, f.as(f.ana), f.class.ID, a.ID, "x")
	assert.ErrorIs(t, err, domain.ErrForbidden, "a student never writes them")
	_, err = f.svc.SaveNotes(ctx, f.other, f.class.ID, a.ID, "x")
	assert.ErrorIs(t, err, domain.ErrForbidden, "nor a teacher who does not own the class")
}

// ---- RN-14: the access decision ----

// Covers SPEC-075 CA-17 (RN-14): ALLOWED only for an eligible student, with the assessment SCHEDULED and RUNNING; the other results say why not.
// The assessment here is online, which is what an assessment was before SPEC-076: for an in-person one the tables of
// TestAccessOf_ClearanceDecisionTable and TestAccessOf_NotStartedComesAfterEndedAndBeforeNotCleared apply (SPEC-076 RN-08, SPEC-083 RN-05).
func TestAccessOf_DecisionTable(t *testing.T) {
	f := newFixture(t)
	a := f.create(t, func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.ana.ID, f.bruno.ID}
		in.Modality = ptr(domain.ModalityOnline)
	})

	cases := []struct {
		name    string
		now     time.Time
		student service.Student
		want    domain.Access
	}{
		{"before the start", at(21, 8, 59), f.ana, domain.AccessNotOpenYet},
		{"at the start", at(21, 9, 0), f.ana, domain.AccessAllowed},
		{"in the middle", at(21, 10, 0), f.bruno, domain.AccessAllowed},
		{"at the end", at(21, 11, 0), f.ana, domain.AccessEnded},
		{"not on the list", at(21, 10, 0), f.carla, domain.AccessNotEligible},
		{"not in the class", at(21, 10, 0), f.outsider, domain.AccessNotEligible},
	}
	for _, c := range cases {
		f.now = c.now
		got, err := f.svc.AccessOf(ctx, c.student.ID, a.ID)
		require.NoError(t, err, c.name)
		assert.Equal(t, c.want, got, c.name)
	}

	f.students.leave(f.class.ID, f.ana.ID)
	f.now = at(21, 10, 0)
	got, err := f.svc.AccessOf(ctx, f.ana.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotEligible, got, "who left the class")

	f.now = at(20, 8, 0)
	canceled := f.create(t)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	f.now = at(21, 10, 0)
	got, err = f.svc.AccessOf(ctx, f.bruno.ID, canceled.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessCanceled, got, "a canceled assessment is never allowed")

	_, err = f.svc.AccessOf(ctx, f.bruno.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound)
}

// ---- RN-01: who may do what ----

// Covers SPEC-075 CA-21 (RN-01, RN-16): a student and a teacher who does not own the class are refused in every operation; an administrator is not.
func TestAuthorization_OnlyOwnerTeacherAndAdminWrite(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	op := map[string]func(service.Actor) error{
		"create": func(who service.Actor) error {
			_, err := f.svc.Create(ctx, who, f.class.ID, f.input())
			return err
		},
		"update": func(who service.Actor) error {
			_, err := f.svc.Update(ctx, who, f.class.ID, a.ID, service.UpdateInput{Title: ptr("Novo")})
			return err
		},
		"reschedule": func(who service.Actor) error {
			_, err := f.svc.Reschedule(ctx, who, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(23, 9, 0), EndsAt: at(23, 11, 0)})
			return err
		},
		"cancel": func(who service.Actor) error {
			_, err := f.svc.Cancel(ctx, who, f.class.ID, f.create(t).ID, "Greve")
			return err
		},
		"notes": func(who service.Actor) error {
			_, err := f.svc.SaveNotes(ctx, who, f.class.ID, a.ID, "x")
			return err
		},
		"detail": func(who service.Actor) error {
			_, err := f.svc.Detail(ctx, who, f.class.ID, a.ID)
			return err
		},
		"preview": func(who service.Actor) error {
			_, err := f.svc.Preview(ctx, who, f.class.ID, a.ID)
			return err
		},
		"list": func(who service.Actor) error {
			_, err := f.svc.List(ctx, who, f.class.ID, service.ListFilter{})
			return err
		},
		"eligible questions": func(who service.Actor) error {
			_, err := f.svc.EligibleQuestions(ctx, who, f.class.ID, service.QuestionFilter{ModuleID: f.module.ID})
			return err
		},
	}
	for name, run := range op {
		assert.ErrorIs(t, run(f.as(f.ana)), domain.ErrForbidden, name+": a student")
		assert.ErrorIs(t, run(f.other), domain.ErrForbidden, name+": a teacher of another class")
		assert.NoError(t, run(f.teacher), name+": the owner")
		assert.NoError(t, run(f.admin), name+": an administrator")
	}

	// the assessment of another class is not found, and an unknown class is not found either
	f.modules.assigned[[2]uuid.UUID{f.otherClass.ID, f.module.ID}] = f.module
	own, err := f.svc.Create(ctx, f.admin, f.otherClass.ID, f.input())
	require.NoError(t, err)
	_, err = f.svc.Detail(ctx, f.teacher, f.class.ID, own.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound, "the assessment is of another class")
	_, err = f.svc.Detail(ctx, f.other, f.otherClass.ID, own.ID)
	assert.NoError(t, err, "its own teacher reads it")
	_, err = f.svc.Detail(ctx, f.teacher, uuid.New(), a.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
}
