package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// roomsRepo adds to the fake repository the open rooms of a student, which the test puts in it (SPEC-067).
type roomsRepo struct {
	*fakeRepo
	rooms []service.StudentRoom
	err   error
	asked []uuid.UUID
}

func (r *roomsRepo) ListOpenRoomsOfStudent(_ context.Context, studentID uuid.UUID) ([]service.StudentRoom, error) {
	r.asked = append(r.asked, studentID)
	return r.rooms, r.err
}

func newMyRooms() (*service.Service, *roomsRepo) {
	repo := &roomsRepo{fakeRepo: newRepo()}
	return service.New(repo, &fakeStorage{}, time.Now), repo
}

// Covers SPEC-067 CA-01, CA-15: the student gets the rooms that the repository found for him, in its order (the newest first).
func TestListMyLive_GivesTheRoomsOfTheStudent(t *testing.T) {
	svc, repo := newMyRooms()
	student := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	repo.rooms = []service.StudentRoom{
		{ClassID: uuid.New(), ClassName: "Turma B", SessionID: uuid.New(), Title: "Agora", StartedAt: time.Date(2026, 10, 15, 19, 0, 0, 0, time.UTC)},
		{ClassID: uuid.New(), ClassName: "Turma A", SessionID: uuid.New(), Title: "Dúvidas", StartedAt: time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)},
	}

	got, err := svc.ListMyLive(context.Background(), student)
	require.NoError(t, err)
	assert.Equal(t, repo.rooms, got)
	assert.Equal(t, []uuid.UUID{student.UserID}, repo.asked, "only the rooms of the student who asks")
}

// Covers SPEC-067 CA-02 (RN-04): no room is an empty list, never nil, so the answer has an empty list and not null.
func TestListMyLive_NoRoomIsAnEmptyList(t *testing.T) {
	svc, _ := newMyRooms()
	got, err := svc.ListMyLive(context.Background(), service.Actor{UserID: uuid.New(), Role: authn.RoleStudent})
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Empty(t, got)
}

// Covers SPEC-067 CA-04 (RN-05): the teacher and the administrator are refused, before the repository is asked.
func TestListMyLive_OnlyStudents(t *testing.T) {
	svc, repo := newMyRooms()
	for _, role := range []string{authn.RoleTeacher, authn.RoleAdmin} {
		_, err := svc.ListMyLive(context.Background(), service.Actor{UserID: uuid.New(), Role: role})
		assert.ErrorIs(t, err, domain.ErrForbidden, role)
	}
	assert.Empty(t, repo.asked)
}

// A failure of the repository is the failure of the use case.
func TestListMyLive_RepositoryFailure(t *testing.T) {
	svc, repo := newMyRooms()
	repo.err = errors.New("boom")
	_, err := svc.ListMyLive(context.Background(), service.Actor{UserID: uuid.New(), Role: authn.RoleStudent})
	assert.ErrorIs(t, err, repo.err)
}
