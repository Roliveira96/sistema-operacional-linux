package service_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// ---- RN-01, RN-02: the modality ----

// Covers SPEC-076 CA-01, CA-02, CA-03 (RN-01, RN-02), with SPEC-091 RN-03: the modality and the requirement follow the type when nothing is said; an assignment is
// never in person, and an online assessment never requires the clearance. A refused creation writes nothing.
func TestCreate_ModalityAndRequirementFollowTheType(t *testing.T) {
	f := newFixture(t)

	exam := f.create(t)
	assert.Equal(t, domain.ModalityInPerson, exam.Modality)
	assert.False(t, exam.RequiresClearance, "since SPEC-091 RN-03 nothing requires the clearance by default")

	assignment := f.create(t, func(in *service.CreateInput) {
		in.Type, in.StartsAt, in.EndsAt = domain.TypeAssignment, ptr(at(21, 9, 0)), ptr(at(23, 18, 0))
	})
	assert.Equal(t, domain.ModalityOnline, assignment.Modality)
	assert.False(t, assignment.RequiresClearance)

	online := f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
	assert.Equal(t, domain.ModalityOnline, online.Modality)
	assert.False(t, online.RequiresClearance, "online is never required")

	free := f.create(t, func(in *service.CreateInput) { in.RequiresClearance = ptr(false) })
	assert.Equal(t, domain.ModalityInPerson, free.Modality)
	assert.False(t, free.RequiresClearance, "the teacher may turn it off for an in-person exam")

	writes := f.repo.writes
	for name, mutate := range map[string]func(*service.CreateInput){
		"an assignment in person": func(in *service.CreateInput) {
			in.Type, in.Modality, in.EndsAt = domain.TypeAssignment, ptr(domain.ModalityInPerson), ptr(at(23, 18, 0))
		},
		"online and required": func(in *service.CreateInput) {
			in.Modality, in.RequiresClearance = ptr(domain.ModalityOnline), ptr(true)
		},
		"an assignment and required": func(in *service.CreateInput) {
			in.Type, in.EndsAt, in.RequiresClearance = domain.TypeAssignment, ptr(at(23, 18, 0)), ptr(true)
		},
		"a modality that is not one": func(in *service.CreateInput) { in.Modality = ptr(domain.Modality("HYBRID")) },
	} {
		in := f.input()
		mutate(&in)
		_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
		assert.ErrorIs(t, err, domain.ErrInvalidAssessment, name)
	}
	assert.Equal(t, writes, f.repo.writes, "nothing was stored by the refused ones")
}

// Covers SPEC-076 CA-04 (RN-03): the modality and the requirement are part of what freezes at the start; before it they change, and the change is
// in the history by name. Switching to online needs the requirement off in the same change.
func TestUpdate_ModalityAndRequirementAreFrozenFromTheStart(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)

	got, err := f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{RequiresClearance: ptr(false)})
	require.NoError(t, err)
	assert.False(t, got.RequiresClearance)
	assert.Contains(t, f.repo.events[a.ID][1].ChangedFields, "requires_clearance")

	got, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Modality: ptr(domain.ModalityOnline)})
	require.NoError(t, err, "the requirement is already off")
	assert.Equal(t, domain.ModalityOnline, got.Modality)
	assert.Contains(t, f.repo.events[a.ID][2].ChangedFields, "modality")

	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Modality: ptr(domain.ModalityInPerson), RequiresClearance: ptr(true)})
	require.NoError(t, err)

	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Modality: ptr(domain.ModalityOnline)})
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "online with the requirement still on")

	f.now = at(21, 9, 0) // the start
	writes := f.repo.writes
	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Modality: ptr(domain.ModalityOnline), RequiresClearance: ptr(false)})
	assert.ErrorIs(t, err, domain.ErrAssessmentFrozen)
	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{RequiresClearance: ptr(false)})
	assert.ErrorIs(t, err, domain.ErrAssessmentFrozen)
	assert.Equal(t, writes, f.repo.writes)

	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Title: ptr("Prova 1 (2ª chamada)")})
	assert.NoError(t, err, "what is not composition still changes")
}

// ---- SPEC-091 RN-03: the end of the clearance ----

// Covers SPEC-091 CA-03 (RN-03): once the teacher started the exam every eligible student is ALLOWED, in person or online, whatever was decided
// about the clearance before; NOT_CLEARED is not a reason any more.
func TestAccessOf_NoClearanceAfterTheStart(t *testing.T) {
	f := newFixture(t)
	a := f.create(t, func(in *service.CreateInput) { in.RequiresClearance = ptr(true) })
	f.repo.clearances[a.ID] = map[uuid.UUID]domain.Clearance{f.bruno.ID: {AssessmentID: a.ID, StudentID: f.bruno.ID, Status: domain.ClearanceRejected}}
	f.begin(t, a)
	f.now = at(21, 10, 0)
	for _, s := range []service.Student{f.ana, f.bruno, f.carla} {
		got, err := f.svc.AccessOf(ctx, s.ID, a.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.AccessAllowed, got, s.Name)
	}
}

// Covers SPEC-091 CA-03 (RN-03): the own access of the student says whether they may enter, why and the modality, and nothing of a clearance.
func TestMyAccess_HasNoClearance(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.now = at(21, 10, 0)
	got, err := f.svc.MyAccess(ctx, f.as(f.carla), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, got.Allowed)
	assert.Equal(t, domain.AccessNotStarted, got.Reason)
	assert.Equal(t, domain.ModalityInPerson, got.Modality)

	f.begin(t, a)
	got, err = f.svc.MyAccess(ctx, f.as(f.carla), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, got.Allowed)
	assert.Equal(t, domain.AccessAllowed, got.Reason)
}

// Covers SPEC-076 CA-12, CA-13 (RN-09, RN-10): who is not eligible does not find the assessment; the teacher and the administrator are forbidden
// from this route; a student of another class does not even find the class.
func TestMyAccess_NotEligibleIsNotFoundAndStaffIsForbidden(t *testing.T) {
	f := newFixture(t)
	a := f.create(t, func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.ana.ID}
	})

	_, err := f.svc.MyAccess(ctx, f.as(f.bruno), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound, "in the class but not on the list")
	_, err = f.svc.MyAccess(ctx, f.as(f.outsider), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound, "not in the class")
	_, err = f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound)

	for name, actor := range map[string]service.Actor{"the teacher": f.teacher, "the administrator": f.admin} {
		_, err = f.svc.MyAccess(ctx, actor, f.class.ID, a.ID)
		assert.ErrorIs(t, err, domain.ErrForbidden, name)
	}
}
