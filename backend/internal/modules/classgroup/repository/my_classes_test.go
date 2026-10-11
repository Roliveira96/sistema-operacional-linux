package repository_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func TestMyClassesQueries(t *testing.T) {
	db := dbtest.Open(t)
	repo := repository.New(db)
	userRepo := userrepository.New(db)
	ctx := context.Background()

	newUser := func(email string, role userdomain.Role) userdomain.User {
		u := userdomain.User{Email: email, Role: role, Status: userdomain.StatusActive}
		require.NoError(t, userRepo.Create(ctx, &u))
		return u
	}
	teacher := newUser("t1@utfpr.edu.br", userdomain.RoleTeacher)
	otherTeacher := newUser("t2@utfpr.edu.br", userdomain.RoleTeacher)
	student := newUser("s1@utfpr.edu.br", userdomain.RoleStudent)
	otherStudent := newUser("s2@utfpr.edu.br", userdomain.RoleStudent)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	seq := 0
	newClass := func(owner uuid.UUID, startOffsetDays int, status domain.ClassStatus) domain.ClassGroup {
		seq++
		token := fmt.Sprintf("secret-token-%d", seq)
		c := domain.ClassGroup{
			TeacherID:        owner,
			Name:             fmt.Sprintf("Class %d", seq),
			CourseCode:       fmt.Sprintf("C%d", seq),
			Semester:         "2026/1",
			StartDate:        base.AddDate(0, 0, startOffsetDays),
			EndDate:          base.AddDate(0, 6, startOffsetDays),
			Status:           status,
			EnableInviteLink: true,
			InviteLinkToken:  &token,
			InviteLinkStart:  &base,
			InviteLinkEnd:    &base,
		}
		require.NoError(t, repo.CreateClass(ctx, &c, nil, base))
		return c
	}
	enroll := func(c domain.ClassGroup, userID uuid.UUID, status domain.EnrollmentStatus) {
		require.NoError(t, repo.CreateEnrollment(ctx, &domain.Enrollment{
			ClassID: c.ID, UserID: userID, Status: status,
			Origin: domain.OriginInviteLink, RequestedAt: base,
		}))
	}

	// Student: ACTIVE, PENDING_MODERATION listed; REJECTED/TRANSFERRED/UNENROLLED/soft-deleted excluded.
	cActive := newClass(teacher.ID, 10, domain.ClassStatusActive)
	cPending := newClass(teacher.ID, 30, domain.ClassStatusActive)
	cRejected := newClass(teacher.ID, 50, domain.ClassStatusActive)
	cTransferred := newClass(teacher.ID, 60, domain.ClassStatusActive)
	cUnenrolled := newClass(teacher.ID, 70, domain.ClassStatusActive)
	cDeletedClass := newClass(teacher.ID, 80, domain.ClassStatusActive)
	cDeletedEnroll := newClass(teacher.ID, 90, domain.ClassStatusActive)
	enroll(cActive, student.ID, domain.EnrollmentActive)
	enroll(cPending, student.ID, domain.EnrollmentPendingModeration)
	enroll(cRejected, student.ID, domain.EnrollmentRejected)
	enroll(cTransferred, student.ID, domain.EnrollmentTransferred)
	enroll(cUnenrolled, student.ID, domain.EnrollmentUnenrolled)
	enroll(cDeletedClass, student.ID, domain.EnrollmentActive)
	enroll(cDeletedEnroll, student.ID, domain.EnrollmentActive)
	enroll(cActive, otherStudent.ID, domain.EnrollmentActive) // another member of the same class

	now := time.Now()
	require.NoError(t, db.Conn(ctx).Model(&domain.ClassGroup{}).Where("id = ?", cDeletedClass.ID).Update("deleted_at", now).Error)
	require.NoError(t, db.Conn(ctx).Model(&domain.Enrollment{}).
		Where("class_id = ? AND user_id = ?", cDeletedEnroll.ID, student.ID).Update("deleted_at", now).Error)

	t.Run("student sees only ACTIVE and PENDING_MODERATION, newest start first", func(t *testing.T) {
		res, err := repo.ListStudentClassesForMenu(ctx, student.ID, domain.MyClassesLimit)
		require.NoError(t, err)
		require.Equal(t, int64(2), res.Total)
		require.Len(t, res.Items, 2)

		assert.Equal(t, cPending.ID, res.Items[0].ID)
		assert.Equal(t, domain.RelationStudent, res.Items[0].Relation)
		require.NotNil(t, res.Items[0].EnrollmentStatus)
		assert.Equal(t, "PENDING_MODERATION", *res.Items[0].EnrollmentStatus)

		assert.Equal(t, cActive.ID, res.Items[1].ID)
		assert.Equal(t, "ACTIVE", *res.Items[1].EnrollmentStatus)
		assert.Equal(t, cActive.Name, res.Items[1].Name)
		assert.Equal(t, cActive.CourseCode, res.Items[1].CourseCode)
		assert.Equal(t, cActive.Semester, res.Items[1].Semester)
	})

	t.Run("another student only sees his own enrollment", func(t *testing.T) {
		res, err := repo.ListStudentClassesForMenu(ctx, otherStudent.ID, domain.MyClassesLimit)
		require.NoError(t, err)
		require.Len(t, res.Items, 1)
		assert.Equal(t, cActive.ID, res.Items[0].ID)
	})

	t.Run("student without enrollments gets an empty list", func(t *testing.T) {
		res, err := repo.ListStudentClassesForMenu(ctx, uuid.New(), domain.MyClassesLimit)
		require.NoError(t, err)
		assert.Empty(t, res.Items)
		assert.Zero(t, res.Total)
	})

	t.Run("teacher sees own non-archived, non-deleted classes only", func(t *testing.T) {
		archived := newClass(otherTeacher.ID, 5, domain.ClassStatusArchived)
		draft := newClass(otherTeacher.ID, 15, domain.ClassStatusDraft)
		active := newClass(otherTeacher.ID, 25, domain.ClassStatusActive)
		deleted := newClass(otherTeacher.ID, 35, domain.ClassStatusActive)
		require.NoError(t, db.Conn(ctx).Model(&domain.ClassGroup{}).Where("id = ?", deleted.ID).Update("deleted_at", now).Error)

		res, err := repo.ListTeacherClassesForMenu(ctx, otherTeacher.ID, domain.MyClassesLimit)
		require.NoError(t, err)
		require.Equal(t, int64(2), res.Total)
		require.Len(t, res.Items, 2)
		assert.Equal(t, active.ID, res.Items[0].ID)
		assert.Equal(t, draft.ID, res.Items[1].ID)
		for _, it := range res.Items {
			assert.NotEqual(t, archived.ID, it.ID)
			assert.Equal(t, domain.RelationTeacher, it.Relation)
			assert.Nil(t, it.EnrollmentStatus)
		}
	})

	t.Run("limit caps items but total stays real", func(t *testing.T) {
		busy := newUser("t3@utfpr.edu.br", userdomain.RoleTeacher)
		for i := 0; i < 25; i++ {
			newClass(busy.ID, 100+i, domain.ClassStatusActive)
		}
		res, err := repo.ListTeacherClassesForMenu(ctx, busy.ID, domain.MyClassesLimit)
		require.NoError(t, err)
		assert.Equal(t, int64(25), res.Total)
		require.Len(t, res.Items, 20)
		assert.True(t, res.Items[0].StartDate.After(res.Items[19].StartDate), "descending start date")
	})
}
