package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classrepo "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func TestStudentRepository(t *testing.T) {
	db := dbtest.Open(t)
	repo := repository.New(db)
	userRepo := userrepository.New(db)
	classRepo := classrepo.New(db)
	ctx := context.Background()

	// Create teacher
	teacherName := "Professora Sediane"
	teacher := userdomain.User{
		Name:   &teacherName,
		Email:  "sediane@utfpr.edu.br",
		Role:   userdomain.RoleTeacher,
		Status: userdomain.StatusActive,
	}
	if err := userRepo.Create(ctx, &teacher); err != nil {
		t.Fatalf("create teacher error: %v", err)
	}

	// Create student
	studentName := "Carlos Drummond"
	ra := "1234567"
	student := userdomain.User{
		Name:       &studentName,
		Email:      "carlos@utfpr.edu.br",
		AcademicID: &ra,
		Role:       userdomain.RoleStudent,
		Status:     userdomain.StatusActive,
	}
	if err := userRepo.Create(ctx, &student); err != nil {
		t.Fatalf("create student error: %v", err)
	}

	// Create class
	now := time.Now().Truncate(time.Microsecond)
	endDate := now.Add(30 * 24 * time.Hour)
	token := "token-repo-test-123"
	class := classdomain.ClassGroup{
		TeacherID:        teacher.ID,
		Name:             "Sistemas Operacionais 2026/2",
		CourseCode:       "SO-TSI",
		Semester:         "2026/2",
		StartDate:        now,
		EndDate:          endDate,
		EnableInviteLink: true,
		InviteLinkToken:  &token,
		InviteLinkStart:  &now,
		InviteLinkEnd:    &endDate,
		Status:           classdomain.ClassStatusActive,
	}
	if err := classRepo.CreateClass(ctx, &class, nil, now); err != nil {
		t.Fatalf("create class error: %v", err)
	}

	t.Run("upsert and get student profile", func(t *testing.T) {
		w := "+5542999998888"
		d := "carlos#0001"
		prof := domain.StudentProfile{
			UserID:   student.ID,
			Whatsapp: &w,
			Discord:  &d,
		}
		if err := repo.UpsertProfile(ctx, &prof); err != nil {
			t.Fatalf("upsert profile error: %v", err)
		}

		got, err := repo.GetProfileByUserID(ctx, student.ID)
		if err != nil {
			t.Fatalf("get profile error: %v", err)
		}
		if got == nil || got.Whatsapp == nil || *got.Whatsapp != w {
			t.Fatalf("expected whatsapp %s, got %v", w, got)
		}

		// Update profile with avatar
		avatarKey := "avatars/carlos/avatar.png"
		prof.AvatarObjectKey = &avatarKey
		if err := repo.UpsertProfile(ctx, &prof); err != nil {
			t.Fatalf("update profile error: %v", err)
		}

		updated, err := repo.GetProfileByUserID(ctx, student.ID)
		if err != nil {
			t.Fatalf("get updated profile error: %v", err)
		}
		if updated.AvatarObjectKey == nil || *updated.AvatarObjectKey != avatarKey {
			t.Fatalf("expected avatar %s, got %v", avatarKey, updated.AvatarObjectKey)
		}
	})

	t.Run("enrollment operations", func(t *testing.T) {
		enr := classdomain.Enrollment{
			ClassID:     class.ID,
			UserID:      student.ID,
			Status:      classdomain.EnrollmentActive,
			Origin:      classdomain.OriginDirectByTeacher,
			RequestedAt: now,
			DecidedAt:   &now,
		}
		if err := repo.CreateEnrollment(ctx, &enr); err != nil {
			t.Fatalf("create enrollment error: %v", err)
		}

		found, err := repo.FindEnrollment(ctx, class.ID, student.ID)
		if err != nil {
			t.Fatalf("find enrollment error: %v", err)
		}
		if found == nil || found.Status != classdomain.EnrollmentActive {
			t.Fatalf("expected active enrollment, got %v", found)
		}

		// Update enrollment
		found.Status = classdomain.EnrollmentUnenrolled
		if err := repo.UpdateEnrollment(ctx, found); err != nil {
			t.Fatalf("update enrollment error: %v", err)
		}

		reloaded, err := repo.FindEnrollment(ctx, class.ID, student.ID)
		if err != nil {
			t.Fatalf("reload enrollment error: %v", err)
		}
		if reloaded.Status != classdomain.EnrollmentUnenrolled {
			t.Fatalf("expected UNENROLLED status, got %s", reloaded.Status)
		}
	})

	t.Run("find user by email and academic id", func(t *testing.T) {
		uByEmail, err := repo.FindUserByEmail(ctx, "carlos@utfpr.edu.br")
		if err != nil || uByEmail == nil {
			t.Fatalf("find user by email failed: %v", err)
		}
		if uByEmail.ID != student.ID {
			t.Fatalf("expected ID %s, got %s", student.ID, uByEmail.ID)
		}

		uByRA, err := repo.FindUserByAcademicID(ctx, "1234567")
		if err != nil || uByRA == nil {
			t.Fatalf("find user by RA failed: %v", err)
		}
		if uByRA.ID != student.ID {
			t.Fatalf("expected ID %s, got %s", student.ID, uByRA.ID)
		}
	})

	t.Run("find class by ID and token", func(t *testing.T) {
		cByID, err := repo.FindClassByID(ctx, class.ID)
		if err != nil || cByID == nil {
			t.Fatalf("find class by ID failed: %v", err)
		}

		cByToken, err := repo.FindClassByInviteToken(ctx, token)
		if err != nil || cByToken == nil {
			t.Fatalf("find class by token failed: %v", err)
		}
		if cByToken.ID != class.ID {
			t.Fatalf("expected ID %s, got %s", class.ID, cByToken.ID)
		}
	})

	t.Run("list students with search", func(t *testing.T) {
		items, total, err := repo.ListStudents(ctx, 1, 10, "Carlos")
		if err != nil {
			t.Fatalf("list students error: %v", err)
		}
		if total < 1 || len(items) < 1 {
			t.Fatalf("expected at least 1 student, got total %d", total)
		}
		if items[0].AcademicID != "1234567" {
			t.Fatalf("expected RA 1234567, got %s", items[0].AcademicID)
		}
	})

	t.Run("not found queries return nil", func(t *testing.T) {
		p, err := repo.GetProfileByUserID(ctx, uuid.New())
		if err != nil || p != nil {
			t.Fatalf("expected nil profile, got %v, err %v", p, err)
		}
		uEmail, err := repo.FindUserByEmail(ctx, "inexistente@utfpr.edu.br")
		if err != nil || uEmail != nil {
			t.Fatalf("expected nil user, got %v, err %v", uEmail, err)
		}
		uRA, err := repo.FindUserByAcademicID(ctx, "0000000")
		if err != nil || uRA != nil {
			t.Fatalf("expected nil user, got %v, err %v", uRA, err)
		}
		if repo.DB() == nil {
			t.Fatalf("expected DB instance")
		}
	})
}
