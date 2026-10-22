package service_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// decision is one student of an UPDATE.
func decision(s service.Student, status domain.ClearanceStatus, reason string) service.ClearanceDecision {
	return service.ClearanceDecision{StudentID: s.ID, Status: status, Reason: reason}
}

func update(decisions ...service.ClearanceDecision) service.ClearanceInput {
	return service.ClearanceInput{Action: service.ClearanceUpdate, Students: decisions}
}

var approveAll = service.ClearanceInput{Action: service.ClearanceApproveAll}

// decide runs an action as the teacher and requires it to succeed.
func (f *fixture) decide(t *testing.T, a service.Summary, in service.ClearanceInput) service.ClearanceList {
	t.Helper()
	f.ensureStarted(t, a) // the clearance is decided once the teacher started the exam (SPEC-083 RN-04)
	got, err := f.svc.Decide(ctx, f.teacher, f.class.ID, a.ID, in)
	require.NoError(t, err)
	return got
}

func statusOf(list service.ClearanceList) map[string]domain.ClearanceStatus {
	out := map[string]domain.ClearanceStatus{}
	for _, it := range list.Items {
		out[it.Name] = it.Status
	}
	return out
}

func clearanceEvents(f *fixture, a service.Summary) []domain.Event {
	var out []domain.Event
	for _, e := range f.repo.events[a.ID] {
		if e.Kind == domain.EventClearanceUpdated {
			out = append(out, e)
		}
	}
	return out
}

// ---- RN-01, RN-02: the modality and the requirement ----

// Covers SPEC-076 CA-01, CA-02, CA-03 (RN-01, RN-02): the modality and the requirement follow the type when nothing is said; an assignment is
// never in person, and an online assessment never requires the clearance. A refused creation writes nothing.
func TestCreate_ModalityAndRequirementFollowTheType(t *testing.T) {
	f := newFixture(t)

	exam := f.create(t)
	assert.Equal(t, domain.ModalityInPerson, exam.Modality)
	assert.True(t, exam.RequiresClearance, "an in-person exam requires the clearance by default")

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

// ---- RN-04, RN-05: the list ----

// Covers SPEC-076 CA-05 (RN-04, RN-05): the eligible students by name, waiting when there is no decision, with the counters; who joins the class
// later shows up waiting, who leaves is gone, and a SELECTED audience limits the list.
func TestClearances_ListsEligibleStudentsWithPendingForWhoHasNoDecision(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)

	list, err := f.svc.Clearances(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, list.RequiresClearance)
	require.Len(t, list.Items, 3)
	assert.Equal(t, []string{"Ana", "Bruno", "Carla"}, []string{list.Items[0].Name, list.Items[1].Name, list.Items[2].Name}, "by name")
	assert.Equal(t, "1000001", list.Items[0].AcademicID)
	for _, it := range list.Items {
		assert.Equal(t, domain.ClearancePending, it.Status)
		assert.Nil(t, it.ClearedAt)
		assert.Nil(t, it.RejectionReason)
		assert.Empty(t, it.ClearedByName)
	}
	assert.Equal(t, service.ClearanceCounts{Pending: 3}, list.Counts)

	f.students.enroll(f.class.ID, f.outsider) // joins later
	f.students.leave(f.class.ID, f.carla.ID)
	list, err = f.svc.Clearances(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, map[string]domain.ClearanceStatus{"Ana": domain.ClearancePending, "Bruno": domain.ClearancePending, "Davi": domain.ClearancePending}, statusOf(list))

	selected := f.create(t, func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.ana.ID, f.bruno.ID}
	})
	list, err = f.svc.Clearances(ctx, f.teacher, f.class.ID, selected.ID)
	require.NoError(t, err)
	assert.Len(t, list.Items, 2)
	assert.Equal(t, 2, list.Counts.Pending)
}

// Covers SPEC-076 CA-05 (RN-05): the decision about who is no longer eligible is ignored, and kept in the table; the counters only count the
// eligible.
func TestClearances_IgnoresTheDecisionOfWhoLeftTheClass(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.decide(t, a, update(decision(f.carla, domain.ClearanceApproved, ""), decision(f.ana, domain.ClearanceRejected, "Faltas")))

	f.students.leave(f.class.ID, f.carla.ID)
	list, err := f.svc.Clearances(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, map[string]domain.ClearanceStatus{"Ana": domain.ClearanceRejected, "Bruno": domain.ClearancePending}, statusOf(list))
	assert.Equal(t, service.ClearanceCounts{Pending: 1, Rejected: 1}, list.Counts)
	assert.Contains(t, f.repo.clearances[a.ID], f.carla.ID, "the row stays")

	f.students.enroll(f.class.ID, f.carla)
	list, err = f.svc.Clearances(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ClearanceApproved, statusOf(list)["Carla"], "and it is back when she is")
}

// Covers SPEC-076 CA-09, CA-13: the list reads in any state, and says whether the clearance is required, so the screen can explain.
func TestClearances_ListReadsWhenNotRequiredEndedOrCanceled(t *testing.T) {
	f := newFixture(t)
	online := f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
	list, err := f.svc.Clearances(ctx, f.teacher, f.class.ID, online.ID)
	require.NoError(t, err)
	assert.False(t, list.RequiresClearance)

	ended := f.create(t)
	f.now = at(21, 12, 0)
	list, err = f.svc.Clearances(ctx, f.teacher, f.class.ID, ended.ID)
	require.NoError(t, err)
	assert.True(t, list.RequiresClearance)
	assert.Len(t, list.Items, 3)
}

// ---- RN-06: deciding ----

// Covers SPEC-076 CA-06, CA-14 (RN-06, RN-11): approving all clears who waits and leaves the refused as they are; each row says who and when; one
// event for each action.
func TestClearances_ApproveAllApprovesOnlyWhoWaitsAndKeepsTheRejected(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.now = at(20, 8, 10)
	f.decide(t, a, update(decision(f.bruno, domain.ClearanceRejected, "Reprovado por faltas")))

	f.now = at(20, 8, 30)
	list := f.decide(t, a, approveAll)

	assert.Equal(t, map[string]domain.ClearanceStatus{"Ana": domain.ClearanceApproved, "Bruno": domain.ClearanceRejected, "Carla": domain.ClearanceApproved}, statusOf(list))
	assert.Equal(t, service.ClearanceCounts{Approved: 2, Rejected: 1}, list.Counts)
	ana := f.repo.clearances[a.ID][f.ana.ID]
	assert.Equal(t, f.teacher.UserID, ana.ClearedBy)
	assert.True(t, ana.ClearedAt.Equal(at(20, 8, 30)))
	bruno := f.repo.clearances[a.ID][f.bruno.ID]
	assert.True(t, bruno.ClearedAt.Equal(at(20, 8, 10)), "the refusal keeps its own moment")
	require.NotNil(t, bruno.RejectionReason)
	assert.Equal(t, "Reprovado por faltas", *bruno.RejectionReason)

	events := clearanceEvents(f, a)
	require.Len(t, events, 2, "one event for each action")
	assert.Equal(t, f.teacher.UserID, events[1].ActorID)
	assert.True(t, events[1].CreatedAt.Equal(at(20, 8, 30)))
	assert.Equal(t, []string{"clearances"}, events[1].ChangedFields)
}

// Covers SPEC-076 RN-06: approving all when nobody waits changes nothing, so it writes nothing and leaves no event.
func TestClearances_ApproveAllWithNobodyWaitingWritesNothing(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.decide(t, a, approveAll)
	saves, events := f.repo.clearanceSaves, len(f.repo.events[a.ID])

	list := f.decide(t, a, approveAll)
	assert.Equal(t, service.ClearanceCounts{Approved: 3}, list.Counts)
	assert.Equal(t, saves, f.repo.clearanceSaves)
	assert.Len(t, f.repo.events[a.ID], events)
}

// Covers SPEC-076 CA-07, CA-14 (RN-06, RN-11): an UPDATE stores the state of each student, with the optional reason of the refusal; a blank reason
// is stored empty; the last decision wins and only the last is kept.
func TestClearances_UpdateStoresStatusAndOptionalReason(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)

	list := f.decide(t, a, update(
		decision(f.ana, domain.ClearanceRejected, "  Reprovado por faltas  "),
		decision(f.bruno, domain.ClearanceRejected, ""),
		decision(f.carla, domain.ClearanceApproved, ""),
	))
	require.Len(t, list.Items, 3)
	ana, bruno, carla := list.Items[0], list.Items[1], list.Items[2]
	assert.Equal(t, domain.ClearanceRejected, ana.Status)
	require.NotNil(t, ana.RejectionReason)
	assert.Equal(t, "Reprovado por faltas", *ana.RejectionReason, "trimmed")
	assert.Equal(t, domain.ClearanceRejected, bruno.Status)
	assert.Nil(t, bruno.RejectionReason, "a blank reason is stored empty")
	assert.Equal(t, domain.ClearanceApproved, carla.Status)
	assert.Equal(t, "Profa. Sediane", ana.ClearedByName, "who decided, by name")
	require.NotNil(t, ana.ClearedAt)
	assert.True(t, ana.ClearedAt.Equal(f.now))
	assert.Equal(t, service.ClearanceCounts{Approved: 1, Rejected: 2}, list.Counts)
	assert.Len(t, clearanceEvents(f, a), 1, "one event for the whole action")

	f.now = at(20, 9, 0)
	list = f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, "")))
	assert.Equal(t, domain.ClearanceApproved, list.Items[0].Status, "from refused to cleared")
	assert.Nil(t, list.Items[0].RejectionReason, "and the old reason is gone")
	assert.Len(t, f.repo.clearances[a.ID], 3, "one row for each student, the last decision only")
}

// Covers SPEC-076 CA-07, CA-08, CA-14 (RN-06, RN-12): a bad action, list, reason or student is refused, and not even the good students of the same
// action are written.
func TestClearances_RefusesBadListsStudentsOutsideAndNothingIsWritten(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.ensureStarted(t, a)
	events := len(f.repo.events[a.ID])

	long := strings.Repeat("a", 301)
	cases := map[string]struct {
		in   service.ClearanceInput
		want error
	}{
		"an action that does not exist": {service.ClearanceInput{Action: "ERASE"}, domain.ErrInvalidClearance},
		"no action":                     {service.ClearanceInput{}, domain.ErrInvalidClearance},
		"an empty list":                 {update(), domain.ErrInvalidClearance},
		"a repeated student": {update(decision(f.ana, domain.ClearanceApproved, ""), decision(f.ana, domain.ClearanceRejected, "")),
			domain.ErrInvalidClearance},
		"a reason with an approval": {update(decision(f.ana, domain.ClearanceApproved, "motivo")), domain.ErrInvalidClearance},
		"a reason above 300":        {update(decision(f.ana, domain.ClearanceRejected, long)), domain.ErrInvalidClearance},
		"waiting as a decision":     {update(decision(f.ana, domain.ClearancePending, "")), domain.ErrInvalidClearance},
		"a student outside the audience": {update(decision(f.ana, domain.ClearanceApproved, ""), decision(f.outsider, domain.ClearanceApproved, "")),
			domain.ErrStudentNotInClass},
	}
	for name, c := range cases {
		_, err := f.svc.Decide(ctx, f.teacher, f.class.ID, a.ID, c.in)
		assert.ErrorIs(t, err, c.want, name)
	}
	assert.Zero(t, f.repo.clearanceSaves, "all or nothing")
	assert.Empty(t, f.repo.clearances[a.ID])
	assert.Len(t, f.repo.events[a.ID], events)

	// the audience of a SELECTED assessment is the one that counts, not the class
	selected := f.create(t, func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.ana.ID}
	})
	f.ensureStarted(t, selected)
	_, err := f.svc.Decide(ctx, f.teacher, f.class.ID, selected.ID, update(decision(f.bruno, domain.ClearanceApproved, "")))
	assert.ErrorIs(t, err, domain.ErrStudentNotInClass, "Bruno is in the class but not on the list")
}

// Covers SPEC-076 CA-09 (RN-06): there is nothing to decide in an online assessment or one that does not require the clearance; and nothing after
// the end or the cancellation. It still works while the assessment is running (CA-04).
func TestClearances_RefusedWhenNotRequiredEndedOrCanceled(t *testing.T) {
	f := newFixture(t)

	online := f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
	_, err := f.svc.Decide(ctx, f.teacher, f.class.ID, online.ID, approveAll)
	assert.ErrorIs(t, err, domain.ErrClearanceNotRequired)

	free := f.create(t, func(in *service.CreateInput) { in.RequiresClearance = ptr(false) })
	_, err = f.svc.Decide(ctx, f.teacher, f.class.ID, free.ID, update(decision(f.ana, domain.ClearanceRejected, "")))
	assert.ErrorIs(t, err, domain.ErrClearanceNotRequired)

	a := f.create(t)
	f.ensureStarted(t, a)
	f.now = at(21, 10, 59)
	_, err = f.svc.Decide(ctx, f.teacher, f.class.ID, a.ID, approveAll)
	assert.NoError(t, err, "running, one minute before the end")

	f.now = at(21, 11, 0)
	_, err = f.svc.Decide(ctx, f.teacher, f.class.ID, a.ID, approveAll)
	assert.ErrorIs(t, err, domain.ErrAssessmentEnded)

	f.now = at(20, 8, 0)
	canceled := f.create(t)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	_, err = f.svc.Decide(ctx, f.teacher, f.class.ID, canceled.ID, approveAll)
	assert.ErrorIs(t, err, domain.ErrAssessmentCanceled)
}

// Covers SPEC-076 CA-10 (RN-07, RN-12): the decision about a student who already started the attempt is refused, and the other students of the
// same action are not touched either.
func TestClearances_RefusedForAStudentWhoStartedTheAttempt(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.ensureStarted(t, a)
	f.attempts.started[[2]uuid.UUID{a.ID, f.bruno.ID}] = true

	_, err := f.svc.Decide(ctx, f.teacher, f.class.ID, a.ID, update(decision(f.ana, domain.ClearanceApproved, ""), decision(f.bruno, domain.ClearanceRejected, "")))
	assert.ErrorIs(t, err, domain.ErrClearanceLocked)
	assert.Zero(t, f.repo.clearanceSaves, "Ana was not written either")

	_, err = f.svc.Decide(ctx, f.teacher, f.class.ID, a.ID, approveAll)
	assert.ErrorIs(t, err, domain.ErrClearanceLocked, "approving all would change Bruno too")

	list := f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, "")))
	assert.Equal(t, domain.ClearanceApproved, statusOf(list)["Ana"], "the others can still be decided one by one")
}

// Covers SPEC-076 CA-04, CA-13 (RN-03, RN-01): who may decide: the teacher of the class and the administrator, never a student or another
// teacher; an assessment of another class is not found.
func TestClearances_AuthorizationOnlyOwnerTeacherAndAdmin(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.ensureStarted(t, a)

	for name, actor := range map[string]service.Actor{"a student": f.as(f.ana), "another teacher": f.other} {
		_, err := f.svc.Clearances(ctx, actor, f.class.ID, a.ID)
		assert.ErrorIs(t, err, domain.ErrForbidden, "list by "+name)
		_, err = f.svc.Decide(ctx, actor, f.class.ID, a.ID, approveAll)
		assert.ErrorIs(t, err, domain.ErrForbidden, "decide by "+name)
	}
	_, err := f.svc.Clearances(ctx, f.admin, f.class.ID, a.ID)
	assert.NoError(t, err)
	_, err = f.svc.Decide(ctx, f.admin, f.class.ID, a.ID, approveAll)
	assert.NoError(t, err)
	assert.Equal(t, f.admin.UserID, f.repo.clearances[a.ID][f.ana.ID].ClearedBy)

	_, err = f.svc.Clearances(ctx, f.teacher, f.class.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound)
	_, err = f.svc.Clearances(ctx, f.teacher, uuid.New(), a.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	_, err = f.svc.Clearances(ctx, f.other, f.otherClass.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound, "an assessment of another class is not found, even for the teacher of that class")
}

// ---- RN-08, RN-09: the access ----

// Covers SPEC-076 CA-11 (RN-08): with the requirement on, only who is cleared gets ALLOWED; waiting or refused gets NOT_CLEARED once the
// assessment is running; the other reasons come first, in the order of SPEC-075 RN-14; without the requirement nothing changes.
func TestAccessOf_ClearanceDecisionTable(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, ""), decision(f.bruno, domain.ClearanceRejected, "Faltas")))
	// a decision about someone who is not eligible stays in the table and does not open the door
	f.repo.clearances[a.ID][f.outsider.ID] = domain.Clearance{AssessmentID: a.ID, StudentID: f.outsider.ID, Status: domain.ClearanceApproved}

	cases := []struct {
		name    string
		now     time.Time
		student service.Student
		want    domain.Access
	}{
		{"cleared and running", at(21, 10, 0), f.ana, domain.AccessAllowed},
		{"refused and running", at(21, 10, 0), f.bruno, domain.AccessNotCleared},
		{"waiting and running", at(21, 10, 0), f.carla, domain.AccessNotCleared},
		{"waiting before the start", at(21, 8, 59), f.carla, domain.AccessNotOpenYet},
		{"cleared before the start", at(21, 8, 59), f.ana, domain.AccessNotOpenYet},
		{"waiting after the end", at(21, 11, 0), f.carla, domain.AccessEnded},
		{"not eligible, even with a row", at(21, 10, 0), f.outsider, domain.AccessNotEligible},
	}
	for _, c := range cases {
		f.now = c.now
		got, err := f.svc.AccessOf(ctx, c.student.ID, a.ID)
		require.NoError(t, err, c.name)
		assert.Equal(t, c.want, got, c.name)
	}

	f.now = at(20, 8, 0)
	free := f.create(t, func(in *service.CreateInput) { in.RequiresClearance = ptr(false) })
	online := f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
	f.ensureStarted(t, free) // an in-person exam is open once the teacher starts it, with or without the requirement (SPEC-083 D-03)
	f.now = at(21, 10, 0)
	for _, other := range []service.Summary{free, online} {
		got, err := f.svc.AccessOf(ctx, f.carla.ID, other.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.AccessAllowed, got, "without the requirement it is as before")
	}

	f.now = at(20, 8, 0)
	canceled := f.create(t)
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	f.now = at(21, 10, 0)
	got, err := f.svc.AccessOf(ctx, f.carla.ID, canceled.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessCanceled, got, "canceled comes before not cleared")
}

// Covers SPEC-076 CA-12 (RN-08, RN-09): the student gets whether they may enter, why, the modality, whether the clearance is required and their own
// state with the reason of the refusal; and nothing of the others.
func TestMyAccess_ReturnsTheOwnStateAndReason(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, ""), decision(f.bruno, domain.ClearanceRejected, "Reprovado por faltas")))

	f.now = at(21, 8, 0)
	got, err := f.svc.MyAccess(ctx, f.as(f.carla), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, got.Allowed)
	assert.Equal(t, domain.AccessNotOpenYet, got.Reason)
	assert.Equal(t, domain.ModalityInPerson, got.Modality)
	assert.True(t, got.RequiresClearance)
	require.NotNil(t, got.Clearance)
	assert.Equal(t, domain.ClearancePending, got.Clearance.Status)
	assert.Nil(t, got.Clearance.RejectionReason)

	f.now = at(21, 10, 0)
	got, err = f.svc.MyAccess(ctx, f.as(f.carla), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotCleared, got.Reason, "waiting")
	assert.False(t, got.Allowed)

	got, err = f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, got.Allowed)
	assert.Equal(t, domain.AccessAllowed, got.Reason)
	assert.Equal(t, domain.ClearanceApproved, got.Clearance.Status)

	got, err = f.svc.MyAccess(ctx, f.as(f.bruno), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, got.Allowed)
	assert.Equal(t, domain.AccessNotCleared, got.Reason)
	assert.Equal(t, domain.ClearanceRejected, got.Clearance.Status)
	require.NotNil(t, got.Clearance.RejectionReason)
	assert.Equal(t, "Reprovado por faltas", *got.Clearance.RejectionReason)

	f.decide(t, a, update(decision(f.bruno, domain.ClearanceRejected, "")))
	got, err = f.svc.MyAccess(ctx, f.as(f.bruno), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Nil(t, got.Clearance.RejectionReason, "a refusal without a reason has none to show")
}

// Covers SPEC-076 CA-12 (RN-02, RN-09): an online assessment, or one that does not require the clearance, has no state of the student to show.
func TestMyAccess_WithoutTheRequirementThereIsNoClearanceToShow(t *testing.T) {
	f := newFixture(t)
	online := f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
	f.now = at(21, 10, 0)
	got, err := f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, online.ID)
	require.NoError(t, err)
	assert.True(t, got.Allowed)
	assert.Equal(t, domain.ModalityOnline, got.Modality)
	assert.False(t, got.RequiresClearance)
	assert.Nil(t, got.Clearance)

	f.now = at(20, 8, 0)
	free := f.create(t, func(in *service.CreateInput) { in.RequiresClearance = ptr(false) })
	f.now = at(21, 10, 0)
	got, err = f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, free.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ModalityInPerson, got.Modality)
	assert.False(t, got.RequiresClearance)
	assert.Nil(t, got.Clearance)

	f.now = at(20, 8, 0)
	canceled := f.create(t)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	got, err = f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, canceled.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessCanceled, got.Reason)
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

// ---- RN-13: the summary ----

// Covers SPEC-076 RN-13: the summary of the teacher carries the modality, the requirement and the counters of the eligible students, in the list
// and in the detail; the public form of the student does not change.
func TestSummary_CarriesModalityRequirementAndCounts(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	assert.Equal(t, service.ClearanceCounts{Pending: 3}, a.ClearanceCounts)

	f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, ""), decision(f.bruno, domain.ClearanceRejected, "")))
	list, err := f.svc.List(ctx, f.teacher, f.class.ID, service.ListFilter{})
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, domain.ModalityInPerson, list[0].Modality)
	assert.True(t, list[0].RequiresClearance)
	assert.Equal(t, service.ClearanceCounts{Pending: 1, Approved: 1, Rejected: 1}, list[0].ClearanceCounts)

	detail, err := f.svc.Detail(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, list[0].ClearanceCounts, detail.ClearanceCounts)
	require.Len(t, detail.Events, 3, "the creation, the start and the action")
	var action *service.EventView
	for i := range detail.Events {
		if detail.Events[i].Kind == domain.EventClearanceUpdated {
			action = &detail.Events[i]
		}
	}
	require.NotNil(t, action, "the action is in the history")
	assert.Equal(t, "Profa. Sediane", action.ActorName)
}
