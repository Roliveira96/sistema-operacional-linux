package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

type assessmentAsk struct {
	actor    service.Actor
	classIDs []uuid.UUID
	from, to time.Time
}

// fakeAssessments is the source of the assessments the assessment module offers to the calendar (SPEC-075 RN-17, D-08).
type fakeAssessments struct {
	items []service.CalendarAssessment
	err   error
	asked []assessmentAsk
}

func (f *fakeAssessments) CalendarAssessments(_ context.Context, actor service.Actor, classIDs []uuid.UUID, from, to time.Time) ([]service.CalendarAssessment, error) {
	f.asked = append(f.asked, assessmentAsk{actor: actor, classIDs: classIDs, from: from, to: to})
	return f.items, f.err
}

func assessmentOf(classID uuid.UUID) service.CalendarAssessment {
	return service.CalendarAssessment{
		ID: uuid.New(), ClassID: classID, Title: "Prova 1", Description: "Leia com atenção.", Type: "EXAM", Status: "SCHEDULED", Phase: "UPCOMING",
		StartsAt: time.Date(2026, 10, 21, 9, 0, 0, 0, time.FixedZone("BRT", -3*3600)), EndsAt: time.Date(2026, 10, 21, 11, 0, 0, 0, time.FixedZone("BRT", -3*3600)),
		MaxScore: 10,
	}
}

// Covers SPEC-075 CA-19 (RN-17, D-08): both calendars carry the assessments the source gives for the classes of the request, and the source is told
// who asks, which classes and which range, so it can decide what each role sees.
func TestCalendar_IncludesTheAssessmentsOfTheSource(t *testing.T) {
	f := newFixture(t)
	src := &fakeAssessments{items: []service.CalendarAssessment{assessmentOf(f.class.ID)}}
	f.svc.WithAssessments(src)
	student := service.Actor{UserID: f.ana.UserID, Role: authn.RoleStudent}
	from, to := day(2026, 10, 1), day(2026, 10, 31)

	cal, err := f.svc.ClassCalendar(context.Background(), f.teacher, f.class.ID, from, to)
	require.NoError(t, err)
	assert.Equal(t, src.items, cal.Assessments)
	require.Len(t, src.asked, 1)
	assert.Equal(t, f.teacher, src.asked[0].actor)
	assert.Equal(t, []uuid.UUID{f.class.ID}, src.asked[0].classIDs)
	assert.True(t, src.asked[0].from.Equal(from))
	assert.True(t, src.asked[0].to.Equal(to))

	cal, err = f.svc.ClassCalendar(context.Background(), student, f.class.ID, from, to)
	require.NoError(t, err)
	assert.Equal(t, src.items, cal.Assessments, "what the student sees is decided by the source, which knows her")
	require.Len(t, src.asked, 2)
	assert.Equal(t, student, src.asked[1].actor)

	mine, err := f.svc.MyCalendar(context.Background(), student, from, to)
	require.NoError(t, err)
	assert.Equal(t, src.items, mine.Assessments)
	require.Len(t, src.asked, 3)
	assert.Equal(t, []uuid.UUID{f.class.ID}, src.asked[2].classIDs, "the classes where she has an active enrollment")

	teacherCal, err := f.svc.MyCalendar(context.Background(), f.teacher, from, to)
	require.NoError(t, err)
	assert.Equal(t, src.items, teacherCal.Assessments)
	require.Len(t, src.asked, 4)
	assert.Equal(t, []uuid.UUID{f.class.ID}, src.asked[3].classIDs, "the classes of the teacher")
}

// Covers SPEC-075 CA-19, CA-21 (RN-17): the source is asked only after the request is authorized, and a failure of the source is not hidden.
func TestCalendar_AssessmentsAreAskedAfterAuthorizationAndErrorsShow(t *testing.T) {
	f := newFixture(t)
	src := &fakeAssessments{items: []service.CalendarAssessment{assessmentOf(f.class.ID)}}
	f.svc.WithAssessments(src)
	stranger := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	from, to := day(2026, 10, 1), day(2026, 10, 31)

	_, err := f.svc.ClassCalendar(context.Background(), stranger, f.class.ID, from, to)
	require.Error(t, err)
	assert.Empty(t, src.asked, "a student who is not in the class never reaches the source")

	_, err = f.svc.ClassCalendar(context.Background(), f.teacher, f.class.ID, from, day(2027, 3, 31))
	require.Error(t, err, "the range limit still holds")
	assert.Empty(t, src.asked)

	src.err = errors.New("the assessments are down")
	_, err = f.svc.ClassCalendar(context.Background(), f.teacher, f.class.ID, from, to)
	assert.ErrorIs(t, err, src.err)
}

// Covers SPEC-075 CA-19 (RN-17): with no source plugged in the calendar has no assessments and works as before.
func TestCalendar_WithoutASourceHasNoAssessments(t *testing.T) {
	f := newFixture(t)
	cal, err := f.svc.ClassCalendar(context.Background(), f.teacher, f.class.ID, day(2026, 10, 1), day(2026, 10, 31))
	require.NoError(t, err)
	assert.Empty(t, cal.Assessments)
}
