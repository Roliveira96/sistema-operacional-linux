package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

func (f *fixture) createOnline(t *testing.T) service.Summary {
	t.Helper()
	return f.create(t, func(in *service.CreateInput) { in.Modality = ptr(domain.ModalityOnline) })
}

func (f *fixture) createAssignment(t *testing.T) service.Summary {
	t.Helper()
	return f.create(t, func(in *service.CreateInput) {
		in.Type, in.StartsAt, in.EndsAt = domain.TypeAssignment, ptr(at(21, 9, 0)), ptr(at(23, 18, 0))
	})
}

// Covers SPEC-089 CA-01 (RN-01, RN-03): an online exam that is running is started like an in-person one: the start, the author, the summary with the
// name and the event STARTED in the same write.
func TestStart_OnlineExam_RecordsStartAndEvent(t *testing.T) {
	f := newFixture(t)
	a := f.createOnline(t)
	writes := f.repo.writes

	f.now = at(21, 9, 7)
	got, err := f.svc.Start(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	require.NotNil(t, got.StartedAt)
	assert.True(t, got.StartedAt.Equal(at(21, 9, 7)))
	require.NotNil(t, got.StartedBy)
	assert.Equal(t, f.teacher.UserID, *got.StartedBy)
	assert.Equal(t, "Profa. Sediane", got.StartedByName)
	assert.Equal(t, writes+1, f.repo.writes, "the start and its event are one write")
	require.Len(t, startedEvents(f, a), 1)
}

// Covers SPEC-089 CA-02 (RN-01): an assignment is never started; the online exam keeps every refusal of SPEC-083.
func TestStart_Assignment_IsInvalid(t *testing.T) {
	f := newFixture(t)
	assignment := f.createAssignment(t)
	online := f.createOnline(t)
	canceled := f.createOnline(t)
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	writes := f.repo.writes

	f.now = at(21, 10, 0)
	_, err = f.svc.Start(ctx, f.teacher, f.class.ID, assignment.ID)
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "an assignment")
	_, err = f.svc.Start(ctx, f.teacher, f.class.ID, canceled.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentCanceled, "online and canceled")
	f.now = at(21, 7, 59)
	_, err = f.svc.Start(ctx, f.teacher, f.class.ID, online.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotOpenYet, "online and not open yet")
	f.now = at(21, 11, 0)
	_, err = f.svc.Start(ctx, f.teacher, f.class.ID, online.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentEnded, "online and ended")
	assert.Equal(t, writes, f.repo.writes, "a refusal writes nothing")

	f.begin(t, online)
	_, err = f.svc.Start(ctx, f.teacher, f.class.ID, online.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentAlreadyStarted, "online and started twice")
}

// Covers SPEC-089 CA-03 (RN-02): the eligible student of a running online exam waits for the start, and enters once it happens.
func TestAccessOf_OnlineExamNotStarted_IsNotStarted(t *testing.T) {
	f := newFixture(t)
	a := f.createOnline(t)

	f.now = at(21, 10, 0)
	got, err := f.svc.AccessOf(ctx, f.ana.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotStarted, got)

	mine, err := f.svc.MyAccess(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, mine.Allowed)
	assert.Equal(t, domain.AccessNotStarted, mine.Reason)
}

// Covers SPEC-089 CA-03 (RN-02): once the online exam is started, every eligible student enters; there is no clearance online.
func TestAccessOf_OnlineExamStarted_IsAllowed(t *testing.T) {
	f := newFixture(t)
	a := f.createOnline(t)
	f.begin(t, a)

	for _, s := range []service.Student{f.ana, f.carla} {
		got, err := f.svc.AccessOf(ctx, s.ID, a.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.AccessAllowed, got, s.Name)
	}
	got, err := f.svc.AccessOf(ctx, f.outsider.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotEligible, got)
}

// Covers SPEC-089 CA-03 (RN-02, D-01): a running assignment opens by the clock and never waits for a start.
func TestAccessOf_RunningAssignment_IsNeverNotStarted(t *testing.T) {
	f := newFixture(t)
	a := f.createAssignment(t)

	f.now = at(22, 10, 0)
	got, err := f.svc.AccessOf(ctx, f.ana.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessAllowed, got)
}
