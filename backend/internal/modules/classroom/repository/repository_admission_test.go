package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

func (e env) openRoom(t *testing.T) domain.LiveClassroomSession {
	t.Helper()
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	return s
}

// Covers SPEC-054 section 4: one row per student and room; asking again changes the row and does not add another.
func TestAdmissions_UniquePerStudentAndSession(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)

	_, err := e.repo.FindAdmission(e.ctx, s.ID, e.student.ID)
	assert.ErrorIs(t, err, domain.ErrAdmissionNotFound)

	first, err := e.repo.UpsertAdmission(e.ctx, s.ID, e.student.ID, domain.AdmissionWaiting, e.now, nil)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionWaiting, first.Status)
	assert.Nil(t, first.DecidedAt)

	later := e.now.Add(time.Minute)
	decided, err := e.repo.UpsertAdmission(e.ctx, s.ID, e.student.ID, domain.AdmissionAdmitted, later, &e.teacher.ID)
	require.NoError(t, err)
	assert.Equal(t, first.ID, decided.ID, "the same row")
	assert.Equal(t, domain.AdmissionAdmitted, decided.Status)
	require.NotNil(t, decided.DecidedAt)
	assert.True(t, later.Equal(*decided.DecidedAt))
	assert.Equal(t, &e.teacher.ID, decided.DecidedBy)
	assert.True(t, e.now.Equal(decided.RequestedAt), "the order of the waiting is kept by the first request")

	askedAgain, err := e.repo.UpsertAdmission(e.ctx, s.ID, e.student.ID, domain.AdmissionWaiting, later.Add(time.Minute), nil)
	require.NoError(t, err)
	assert.Equal(t, first.ID, askedAgain.ID)
	assert.True(t, later.Add(time.Minute).Equal(askedAgain.RequestedAt), "asking again goes to the end of the line")
	assert.Nil(t, askedAgain.DecidedAt)
	assert.Nil(t, askedAgain.DecidedBy)

	var n int64
	require.NoError(t, e.db.Conn(e.ctx).Model(&domain.LiveClassroomAdmission{}).Count(&n).Error)
	assert.EqualValues(t, 1, n)

	// The database itself refuses a second live row for the pair.
	dup := domain.LiveClassroomAdmission{SessionID: s.ID, StudentID: e.student.ID, Status: domain.AdmissionWaiting, RequestedAt: e.now}
	assert.Error(t, e.db.Conn(e.ctx).Create(&dup).Error)

	// Another room of the class starts its own line.
	require.NoError(t, e.repo.SaveSession(e.ctx, func() *domain.LiveClassroomSession { s.End(later); return &s }()))
	next := e.session(e.class.ID, later)
	require.NoError(t, e.repo.CreateSession(e.ctx, &next))
	_, err = e.repo.FindAdmission(e.ctx, next.ID, e.student.ID)
	assert.ErrorIs(t, err, domain.ErrAdmissionNotFound)
}

// Covers SPEC-054 section 4: the line has the name, in the order of the request, without the removed; and accepting all admits only who waits.
func TestAdmissions_ListAndAdmitAll(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	carla := e.newStudent(t, "1000003", "Carla")
	dani := e.newStudent(t, "1000004", "Dani")

	for i, id := range []uuid.UUID{carla.ID, e.student.ID, bruno.ID, dani.ID} {
		_, err := e.repo.UpsertAdmission(e.ctx, s.ID, id, domain.AdmissionWaiting, e.now.Add(time.Duration(i)*time.Second), nil)
		require.NoError(t, err)
	}
	_, err := e.repo.UpsertAdmission(e.ctx, s.ID, dani.ID, domain.AdmissionRemoved, e.now.Add(time.Minute), &e.teacher.ID)
	require.NoError(t, err)
	_, err = e.repo.UpsertAdmission(e.ctx, s.ID, bruno.ID, domain.AdmissionAdmitted, e.now.Add(time.Minute), &e.teacher.ID)
	require.NoError(t, err)

	list, err := e.repo.ListAdmissions(e.ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, list, 3, "the removed is left out")
	assert.Equal(t, []string{"Carla", "Ana", "Bruno"}, []string{list[0].Name, list[1].Name, list[2].Name})
	assert.Equal(t, domain.AdmissionWaiting, list[0].Status)
	assert.Equal(t, domain.AdmissionAdmitted, list[2].Status)

	ids, err := e.repo.AdmitAllWaiting(e.ctx, s.ID, e.now.Add(2*time.Minute), &e.teacher.ID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{carla.ID, e.student.ID}, ids)
	st, err := e.repo.FindAdmission(e.ctx, s.ID, dani.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionRemoved, st.Status, "the removed stays out")
	ids, err = e.repo.AdmitAllWaiting(e.ctx, s.ID, e.now.Add(3*time.Minute), &e.teacher.ID)
	require.NoError(t, err)
	assert.Empty(t, ids)
}

// Covers SPEC-054 section 4: a row that was soft deleted is neither found nor listed, and the pair may be created again.
func TestAdmissions_SoftDelete(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	a, err := e.repo.UpsertAdmission(e.ctx, s.ID, e.student.ID, domain.AdmissionAdmitted, e.now, &e.teacher.ID)
	require.NoError(t, err)
	require.NoError(t, e.db.Conn(e.ctx).Delete(&domain.LiveClassroomAdmission{}, "id = ?", a.ID).Error)

	_, err = e.repo.FindAdmission(e.ctx, s.ID, e.student.ID)
	assert.ErrorIs(t, err, domain.ErrAdmissionNotFound)
	list, err := e.repo.ListAdmissions(e.ctx, s.ID)
	require.NoError(t, err)
	assert.Empty(t, list)

	again, err := e.repo.UpsertAdmission(e.ctx, s.ID, e.student.ID, domain.AdmissionWaiting, e.now, nil)
	require.NoError(t, err)
	assert.NotEqual(t, a.ID, again.ID)
}
