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

// begin starts the exam of the fixture at 09:05 of the day it runs, as the teacher, and leaves the clock there.
func (f *fixture) begin(t *testing.T, a service.Summary) service.Summary {
	t.Helper()
	f.now = at(21, 9, 5)
	got, err := f.svc.Start(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	return got
}

// ensureStarted starts the exam, as the teacher, if it was not started yet, and puts the clock back where the test had it: the tests of the clearance
// (SPEC-076) decide at the moments they chose, and since SPEC-083 the decision only exists after the start.
func (f *fixture) ensureStarted(t *testing.T, a service.Summary) {
	t.Helper()
	if f.repo.assessments[a.ID].StartedAt != nil {
		return
	}
	keep := f.now
	f.begin(t, a)
	f.now = keep
}

func startedEvents(f *fixture, a service.Summary) []domain.Event {
	var out []domain.Event
	for _, e := range f.repo.events[a.ID] {
		if e.Kind == domain.EventStarted {
			out = append(out, e)
		}
	}
	return out
}

// ---- RN-01, RN-03: starting ----

// Covers SPEC-083 CA-01 (RN-01, RN-03): the teacher starts an in-person exam that is running; the start is stored with the clock of the server and
// the author, the summary says it with the name, and the event STARTED is added in the same write. The administrator can start one too.
func TestStart_RecordsWhoAndWhenAndWritesTheEvent(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	assert.Nil(t, a.StartedAt, "a new assessment is not started")
	writes := f.repo.writes

	f.now = at(21, 9, 7)
	got, err := f.svc.Start(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	require.NotNil(t, got.StartedAt)
	assert.True(t, got.StartedAt.Equal(at(21, 9, 7)), "the clock of the server")
	require.NotNil(t, got.StartedBy)
	assert.Equal(t, f.teacher.UserID, *got.StartedBy)
	assert.Equal(t, "Profa. Sediane", got.StartedByName)
	assert.Equal(t, writes+1, f.repo.writes, "the start and its event are one write")

	events := startedEvents(f, a)
	require.Len(t, events, 1)
	assert.Equal(t, f.teacher.UserID, events[0].ActorID)
	assert.True(t, events[0].CreatedAt.Equal(at(21, 9, 7)))

	stored := f.repo.assessments[a.ID]
	require.NotNil(t, stored.StartedAt)
	assert.True(t, stored.StartedAt.Equal(at(21, 9, 7)))
	assert.Equal(t, f.teacher.UserID, *stored.StartedBy)

	f.now = at(20, 8, 0)
	other := f.create(t)
	f.now = at(21, 9, 30)
	byAdmin, err := f.svc.Start(ctx, f.admin, f.class.ID, other.ID)
	require.NoError(t, err)
	assert.Equal(t, "Administrador", byAdmin.StartedByName)
}

// Covers SPEC-083 CA-01 (RN-07): the list of the teacher carries the start once it happened, and not before.
func TestStart_TheSummaryOfTheListCarriesTheStart(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	list, err := f.svc.List(ctx, f.teacher, f.class.ID, service.ListFilter{})
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Nil(t, list[0].StartedAt)
	assert.Nil(t, list[0].StartedBy)
	assert.Empty(t, list[0].StartedByName)

	f.begin(t, a)
	list, err = f.svc.List(ctx, f.teacher, f.class.ID, service.ListFilter{})
	require.NoError(t, err)
	require.NotNil(t, list[0].StartedAt)
	assert.True(t, list[0].StartedAt.Equal(at(21, 9, 5)))
	assert.Equal(t, "Profa. Sediane", list[0].StartedByName)
}

// Covers SPEC-083 CA-02 (RN-01): an exam is started once; the second start is refused and changes nothing.
func TestStart_TheSecondStartIsRefusedAndNothingChanges(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.begin(t, a)
	writes := f.repo.writes

	f.now = at(21, 9, 40)
	_, err := f.svc.Start(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentAlreadyStarted)
	assert.Equal(t, writes, f.repo.writes)
	assert.Len(t, startedEvents(f, a), 1)
	assert.True(t, f.repo.assessments[a.ID].StartedAt.Equal(at(21, 9, 5)), "the first start stays")
}

// Covers SPEC-083 CA-03 (RN-01, RN-02): only an in-person exam that is running can be started; an online one or an assignment is not valid, and a
// canceled, an ended or a not yet open one is refused, in this order. Nothing is written by a refusal.
func TestStart_RefusedWhenNotInPersonCanceledEndedOrNotOpenYet(t *testing.T) {
	f := newFixture(t)
	online := f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
	assignment := f.create(t, func(in *service.CreateInput) {
		in.Type, in.StartsAt, in.EndsAt = domain.TypeAssignment, ptr(at(21, 9, 0)), ptr(at(23, 18, 0))
	})
	exam := f.create(t)
	canceled := f.create(t)
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	writes := f.repo.writes

	cases := []struct {
		name string
		a    service.Summary
		now  time.Time
		want error
	}{
		{"online", online, at(21, 10, 0), domain.ErrInvalidAssessment},
		{"an assignment", assignment, at(21, 10, 0), domain.ErrInvalidAssessment},
		{"canceled and running", canceled, at(21, 10, 0), domain.ErrAssessmentCanceled},
		{"canceled and ended: canceled comes first", canceled, at(21, 11, 0), domain.ErrAssessmentCanceled},
		{"ended", exam, at(21, 11, 0), domain.ErrAssessmentEnded},
		{"not open yet", exam, at(21, 8, 59), domain.ErrAssessmentNotOpenYet},
	}
	for _, c := range cases {
		f.now = c.now
		_, err := f.svc.Start(ctx, f.teacher, f.class.ID, c.a.ID)
		assert.ErrorIs(t, err, c.want, c.name)
	}
	assert.Equal(t, writes, f.repo.writes, "a refusal writes nothing")
	assert.Empty(t, startedEvents(f, exam))

	f.now = at(21, 9, 0)
	_, err = f.svc.Start(ctx, f.teacher, f.class.ID, exam.ID)
	assert.NoError(t, err, "from the instant of the start on")
}

// Covers SPEC-083 CA-03: only the teacher of the class and the administrator start the exam; the assessment of another class is not found.
func TestStart_OnlyTheOwnerTeacherAndTheAdministrator(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.now = at(21, 10, 0)
	for name, actor := range map[string]service.Actor{"a student": f.as(f.ana), "another teacher": f.other} {
		_, err := f.svc.Start(ctx, actor, f.class.ID, a.ID)
		assert.ErrorIs(t, err, domain.ErrForbidden, name)
	}
	assert.Empty(t, startedEvents(f, a))
	_, err := f.svc.Start(ctx, f.teacher, f.class.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound)
	_, err = f.svc.Start(ctx, f.other, f.otherClass.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound, "an assessment of another class is not found, even for the teacher of that class")
}

// ---- RN-04: the clearance only after the start ----

// Covers SPEC-083 CA-04, CA-05 (RN-04): before the start the clearance is not decided, in any phase, and nothing is written; the list is still read;
// after the start the decision works as SPEC-076 defines.
func TestClearances_DecidedOnlyAfterTheStart(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	writes := f.repo.writes

	for _, now := range []time.Time{at(20, 8, 0), at(21, 8, 59), at(21, 10, 0)} {
		f.now = now
		for name, in := range map[string]service.ClearanceInput{"all": approveAll, "one": update(decision(f.ana, domain.ClearanceApproved, ""))} {
			_, err := f.svc.Decide(ctx, f.teacher, f.class.ID, a.ID, in)
			assert.ErrorIs(t, err, domain.ErrAssessmentNotStarted, name+" at "+now.Format("02 15:04"))
		}
		list, err := f.svc.Clearances(ctx, f.teacher, f.class.ID, a.ID)
		require.NoError(t, err, "the list is read before the start")
		assert.Equal(t, 3, list.Counts.Pending)
	}
	assert.Equal(t, writes, f.repo.writes)

	f.begin(t, a)
	list := f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, ""), decision(f.bruno, domain.ClearanceRejected, "Faltas")))
	assert.Equal(t, domain.ClearanceApproved, statusOf(list)["Ana"])
	list = f.decide(t, a, approveAll)
	assert.Equal(t, domain.ClearanceApproved, statusOf(list)["Carla"], "the refusal of Bruno stays, as SPEC-076 D-04 says")
	assert.Equal(t, domain.ClearanceRejected, statusOf(list)["Bruno"])
}

// Covers SPEC-083 RN-04: an assessment that does not require the clearance still answers "not required" before "not started".
func TestClearances_NotRequiredComesBeforeNotStarted(t *testing.T) {
	f := newFixture(t)
	free := f.create(t, func(in *service.CreateInput) { in.RequiresClearance = ptr(false) })
	f.now = at(21, 10, 0)
	_, err := f.svc.Decide(ctx, f.teacher, f.class.ID, free.ID, approveAll)
	assert.ErrorIs(t, err, domain.ErrClearanceNotRequired)
}

// ---- RN-05, RN-06: the access ----

// Covers SPEC-083 CA-06 (RN-05): an in-person exam that is running and was not started is NOT_STARTED for who is eligible, after not eligible,
// canceled, not open yet and ended, and before not cleared; ALLOWED needs the start, also without the requirement; an online assessment does not
// need it.
func TestAccessOf_NotStartedComesAfterEndedAndBeforeNotCleared(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	free := f.create(t, func(in *service.CreateInput) { in.RequiresClearance = ptr(false) })
	online := f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
	canceled := f.create(t)
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)

	cases := []struct {
		name    string
		a       service.Summary
		now     time.Time
		student service.Student
		want    domain.Access
	}{
		{"running, not started", a, at(21, 10, 0), f.ana, domain.AccessNotStarted},
		{"running, not started, without the requirement", free, at(21, 10, 0), f.ana, domain.AccessNotStarted},
		{"not open yet comes before", a, at(21, 8, 59), f.ana, domain.AccessNotOpenYet},
		{"ended comes before", a, at(21, 11, 0), f.ana, domain.AccessEnded},
		{"not eligible comes before", a, at(21, 10, 0), f.outsider, domain.AccessNotEligible},
		{"canceled comes before", canceled, at(21, 10, 0), f.ana, domain.AccessCanceled},
		{"online does not need the start", online, at(21, 10, 0), f.ana, domain.AccessAllowed},
	}
	for _, c := range cases {
		f.now = c.now
		got, err := f.svc.AccessOf(ctx, c.student.ID, c.a.ID)
		require.NoError(t, err, c.name)
		assert.Equal(t, c.want, got, c.name)
	}

	f.begin(t, a)
	f.begin(t, free)
	f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, "")))
	after := []struct {
		name    string
		a       service.Summary
		student service.Student
		want    domain.Access
	}{
		{"started, cleared", a, f.ana, domain.AccessAllowed},
		{"started, waiting", a, f.carla, domain.AccessNotCleared},
		{"started, without the requirement everybody eligible enters", free, f.carla, domain.AccessAllowed},
	}
	for _, c := range after {
		got, err := f.svc.AccessOf(ctx, c.student.ID, c.a.ID)
		require.NoError(t, err, c.name)
		assert.Equal(t, c.want, got, c.name)
	}
}

// Covers SPEC-083 CA-07 (RN-06): the student asks for their own access before the start and gets NOT_STARTED and no permission; the state of the
// own clearance still comes, and the access changes once the teacher starts and clears.
func TestMyAccess_NotStartedBeforeTheTeacherStarts(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	f.now = at(21, 10, 0)

	got, err := f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, got.Allowed)
	assert.Equal(t, domain.AccessNotStarted, got.Reason)
	assert.Equal(t, domain.ModalityInPerson, got.Modality)
	require.NotNil(t, got.Clearance)
	assert.Equal(t, domain.ClearancePending, got.Clearance.Status)

	f.begin(t, a)
	f.decide(t, a, update(decision(f.ana, domain.ClearanceApproved, "")))
	got, err = f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, got.Allowed)
	assert.Equal(t, domain.AccessAllowed, got.Reason)
	got, err = f.svc.MyAccess(ctx, f.as(f.carla), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotCleared, got.Reason)
}
