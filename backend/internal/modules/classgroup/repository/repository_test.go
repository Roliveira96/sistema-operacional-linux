package repository_test

import (
	"context"
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

func TestClassRepository(t *testing.T) {
	db := dbtest.Open(t)
	repo := repository.New(db)
	userRepo := userrepository.New(db)
	ctx := context.Background()

	// Create teacher user
	teacherName := "Profa. Sediane"
	teacher := userdomain.User{
		Name:   &teacherName,
		Email:  "sediane@utfpr.edu.br",
		Role:   userdomain.RoleTeacher,
		Status: userdomain.StatusActive,
	}
	require.NoError(t, userRepo.Create(ctx, &teacher))

	// Create student users
	studentName := "Aluno Teste"
	ra := "1234567"
	student := userdomain.User{
		Name:       &studentName,
		Email:      "aluno@utfpr.edu.br",
		AcademicID: &ra,
		Role:       userdomain.RoleStudent,
		Status:     userdomain.StatusActive,
	}
	require.NoError(t, userRepo.Create(ctx, &student))

	now := time.Now().Truncate(time.Microsecond)
	endDate := now.Add(90 * 24 * time.Hour)
	token := "validtoken123"
	linkStart := now
	linkEnd := now.Add(48 * time.Hour)

	class := domain.ClassGroup{
		TeacherID:               teacher.ID,
		Name:                    "Sistemas Operacionais",
		CourseCode:              "SO34E",
		Semester:                "2026/2",
		Syllabus:                "Processos e VFS",
		InstitutionalGuidelines: "Frequência 75%",
		StartDate:               now,
		EndDate:                 endDate,
		ScheduleDescription:     "Segunda e Quarta",
		EnableVirtualClassroom:  true,
		EnableInviteLink:        true,
		InviteLinkToken:         &token,
		InviteLinkStart:         &linkStart,
		InviteLinkEnd:           &linkEnd,
		Status:                  domain.ClassStatusActive,
	}

	// Create class with initial student
	err := repo.CreateClass(ctx, &class, []uuid.UUID{student.ID}, now)
	require.NoError(t, err)
	assert.NotEqual(t, uuid.Nil, class.ID)

	// Duplicate class for same teacher/course/semester fails
	dupClass := domain.ClassGroup{
		TeacherID:  teacher.ID,
		Name:       "Sistemas Operacionais Turma B",
		CourseCode: "SO34E",
		Semester:   "2026/2",
		StartDate:  now,
		EndDate:    endDate,
		Status:     domain.ClassStatusActive,
	}
	assert.ErrorIs(t, repo.CreateClass(ctx, &dupClass, nil, now), domain.ErrClassConflict)

	// Find by ID
	found, err := repo.FindClassByID(ctx, class.ID)
	require.NoError(t, err)
	assert.Equal(t, class.Name, found.Name)

	// Find by invite token
	byToken, err := repo.FindClassByInviteToken(ctx, token)
	require.NoError(t, err)
	assert.Equal(t, class.ID, byToken.ID)

	// List classes
	listResult, err := repo.ListClassesByTeacher(ctx, teacher.ID, repository.ListFilter{
		Limit: 10,
		Page:  1,
	})
	require.NoError(t, err)
	assert.Len(t, listResult.Items, 1)
	assert.Equal(t, int64(1), listResult.Items[0].TotalActiveStudents)

	// Find enrollment
	enrollment, err := repo.FindEnrollment(ctx, class.ID, student.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.EnrollmentActive, enrollment.Status)

	// Duplicate enrollment fails
	dupEnroll := domain.Enrollment{
		ClassID:     class.ID,
		UserID:      student.ID,
		Status:      domain.EnrollmentPendingModeration,
		Origin:      domain.OriginInviteLink,
		RequestedAt: now,
	}
	assert.ErrorIs(t, repo.CreateEnrollment(ctx, &dupEnroll), domain.ErrAlreadyEnrolled)

	// List enrollments with user data
	members, err := repo.ListEnrollmentsByClass(ctx, class.ID, "")
	require.NoError(t, err)
	assert.Len(t, members, 1)
	assert.Equal(t, "Aluno Teste", *members[0].UserName)
	assert.Equal(t, "1234567", *members[0].UserAcademicID)

	// Update class
	class.Name = "Sistemas Operacionais Avançados"
	require.NoError(t, repo.UpdateClass(ctx, &class))
	updated, err := repo.FindClassByID(ctx, class.ID)
	require.NoError(t, err)
	assert.Equal(t, "Sistemas Operacionais Avançados", updated.Name)
}
