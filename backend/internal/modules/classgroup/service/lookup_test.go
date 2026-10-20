package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

func enroll(repo *fakeClassRepo, classID, userID uuid.UUID, status domain.EnrollmentStatus) {
	id := uuid.New()
	repo.enrollments[id] = domain.Enrollment{Model: database.Model{ID: id}, ClassID: classID, UserID: userID, Status: status}
}

// Covers SPEC-075 RN-01 and RN-08: another module reads a class, and the students of it with an ACTIVE enrollment, without being its teacher; that
// module decides who may do what with what it reads.
func TestLookupAndActiveMembers(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	svc := service.New(repo)
	teacher := uuid.New()
	class := domain.ClassGroup{Model: database.Model{ID: uuid.New()}, TeacherID: teacher, Status: domain.ClassStatusActive}
	other := domain.ClassGroup{Model: database.Model{ID: uuid.New()}, TeacherID: uuid.New(), Status: domain.ClassStatusActive}
	repo.classes[class.ID], repo.classes[other.ID] = class, other

	ana, bruno, carla, davi := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	enroll(repo, class.ID, ana, domain.EnrollmentActive)
	enroll(repo, class.ID, bruno, domain.EnrollmentActive)
	enroll(repo, class.ID, carla, domain.EnrollmentPendingModeration)
	enroll(repo, other.ID, davi, domain.EnrollmentActive)

	got, err := svc.Lookup(ctx, class.ID)
	require.NoError(t, err)
	assert.Equal(t, class.ID, got.ID)
	assert.Equal(t, teacher, got.TeacherID, "it says who the teacher is, for the caller to compare")
	_, err = svc.Lookup(ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)

	members, err := svc.ActiveMembers(ctx, class.ID)
	require.NoError(t, err)
	ids := make([]uuid.UUID, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	assert.ElementsMatch(t, []uuid.UUID{ana, bruno}, ids, "only the active ones of this class")
	for _, m := range members {
		assert.NotNil(t, m.UserName)
	}
}
