package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

type fakeClassRepo struct {
	classes     map[uuid.UUID]domain.ClassGroup
	enrollments map[uuid.UUID]domain.Enrollment
}

func newFakeRepo() *fakeClassRepo {
	return &fakeClassRepo{
		classes:     make(map[uuid.UUID]domain.ClassGroup),
		enrollments: make(map[uuid.UUID]domain.Enrollment),
	}
}

func (f *fakeClassRepo) CreateClass(ctx context.Context, class *domain.ClassGroup, initialStudentIDs []uuid.UUID, now time.Time) error {
	for _, c := range f.classes {
		if c.TeacherID == class.TeacherID && c.CourseCode == class.CourseCode && c.Semester == class.Semester && c.Status != domain.ClassStatusArchived {
			return domain.ErrClassConflict
		}
	}
	if class.ID == uuid.Nil {
		class.ID = uuid.New()
	}
	class.CreatedAt = now
	class.UpdatedAt = now
	f.classes[class.ID] = *class

	for _, sID := range initialStudentIDs {
		eid := uuid.New()
		f.enrollments[eid] = domain.Enrollment{
			Model:       database.Model{ID: eid, CreatedAt: now, UpdatedAt: now},
			ClassID:     class.ID,
			UserID:      sID,
			Status:      domain.EnrollmentActive,
			Origin:      domain.OriginDirectByTeacher,
			RequestedAt: now,
			DecidedAt:   &now,
		}
	}
	return nil
}

func (f *fakeClassRepo) FindClassByID(ctx context.Context, id uuid.UUID) (domain.ClassGroup, error) {
	c, ok := f.classes[id]
	if !ok {
		return domain.ClassGroup{}, domain.ErrClassNotFound
	}
	return c, nil
}

func (f *fakeClassRepo) FindClassByInviteToken(ctx context.Context, token string) (domain.ClassGroup, error) {
	for _, c := range f.classes {
		if c.InviteLinkToken != nil && *c.InviteLinkToken == token {
			return c, nil
		}
	}
	return domain.ClassGroup{}, domain.ErrClassNotFound
}

func (f *fakeClassRepo) ListClassesByTeacher(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error) {
	var items []repository.ClassSummary
	for _, c := range f.classes {
		if c.TeacherID == teacherID {
			if filter.Status != "" && string(c.Status) != filter.Status {
				continue
			}
			var active, pending int64
			for _, e := range f.enrollments {
				if e.ClassID == c.ID {
					if e.Status == domain.EnrollmentActive {
						active++
					}
					if e.Status == domain.EnrollmentPendingModeration {
						pending++
					}
				}
			}
			items = append(items, repository.ClassSummary{
				Class:                c,
				TotalActiveStudents:  active,
				TotalPendingRequests: pending,
			})
		}
	}
	return repository.ListResult{
		Items:      items,
		TotalCount: int64(len(items)),
		Page:       1,
		Limit:      20,
	}, nil
}

func (f *fakeClassRepo) UpdateClass(ctx context.Context, class *domain.ClassGroup) error {
	for _, c := range f.classes {
		if c.ID != class.ID && c.TeacherID == class.TeacherID && c.CourseCode == class.CourseCode && c.Semester == class.Semester && c.Status != domain.ClassStatusArchived {
			return domain.ErrClassConflict
		}
	}
	f.classes[class.ID] = *class
	return nil
}

func (f *fakeClassRepo) CreateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error {
	for _, e := range f.enrollments {
		if e.ClassID == enrollment.ClassID && e.UserID == enrollment.UserID {
			return domain.ErrAlreadyEnrolled
		}
	}
	if enrollment.ID == uuid.Nil {
		enrollment.ID = uuid.New()
	}
	f.enrollments[enrollment.ID] = *enrollment
	return nil
}

func (f *fakeClassRepo) FindEnrollment(ctx context.Context, classID, userID uuid.UUID) (domain.Enrollment, error) {
	for _, e := range f.enrollments {
		if e.ClassID == classID && e.UserID == userID {
			return e, nil
		}
	}
	return domain.Enrollment{}, domain.ErrEnrollmentNotFound
}

func (f *fakeClassRepo) FindEnrollmentByID(ctx context.Context, id uuid.UUID) (domain.Enrollment, error) {
	e, ok := f.enrollments[id]
	if !ok {
		return domain.Enrollment{}, domain.ErrEnrollmentNotFound
	}
	return e, nil
}

func (f *fakeClassRepo) ListEnrollmentsByClass(ctx context.Context, classID uuid.UUID, status string) ([]repository.EnrollmentWithUser, error) {
	var list []repository.EnrollmentWithUser
	for _, e := range f.enrollments {
		if e.ClassID == classID {
			if status != "" && string(e.Status) != status {
				continue
			}
			name := "Student " + e.UserID.String()[:4]
			email := "student@" + e.UserID.String()[:4] + ".utfpr.edu.br"
			ra := "1234567"
			list = append(list, repository.EnrollmentWithUser{
				Enrollment:     e,
				UserName:       &name,
				UserEmail:      email,
				UserAcademicID: &ra,
			})
		}
	}
	return list, nil
}

func (f *fakeClassRepo) UpdateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error {
	f.enrollments[enrollment.ID] = *enrollment
	return nil
}

func setupTest() (*service.Service, *fakeClassRepo, time.Time) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	repo := newFakeRepo()
	svc := service.New(repo).WithNow(func() time.Time { return now })
	return svc, repo, now
}

func TestCreateClassSuccess(t *testing.T) {
	svc, repo, now := setupTest()
	ctx := context.Background()
	teacherID := uuid.New()
	student1 := uuid.New()
	student2 := uuid.New()

	linkStart := now
	linkEnd := now.Add(48 * time.Hour)

	class, err := svc.CreateClass(ctx, teacherID, service.CreateClassInput{
		Name:                    "Sistemas Operacionais - Turma A",
		CourseCode:              "SO34E",
		Semester:                "2026/2",
		Syllabus:                "Processos, threads e VFS",
		InstitutionalGuidelines: "Presença obrigatória 75%",
		StartDate:               now,
		EndDate:                 now.Add(90 * 24 * time.Hour),
		ScheduleDescription:     "Segundas e Quartas, 08:00 - 10:00",
		EnableVirtualClassroom:  true,
		EnableInviteLink:        true,
		InviteLinkStart:         &linkStart,
		InviteLinkEnd:           &linkEnd,
		InitialStudentIDs:       []uuid.UUID{student1, student2},
	})

	if err != nil {
		t.Fatalf("unexpected error creating class: %v", err)
	}

	if class.ID == uuid.Nil {
		t.Fatal("expected assigned class ID")
	}
	if class.Status != domain.ClassStatusActive {
		t.Fatalf("expected ACTIVE status, got %s", class.Status)
	}
	if class.InviteLinkToken == nil || *class.InviteLinkToken == "" {
		t.Fatal("expected invite link token to be generated")
	}
	if len(repo.enrollments) != 2 {
		t.Fatalf("expected 2 initial enrollments, got %d", len(repo.enrollments))
	}
}

func TestCreateClassValidation(t *testing.T) {
	svc, _, now := setupTest()
	ctx := context.Background()
	teacherID := uuid.New()

	// Invalid dates
	_, err := svc.CreateClass(ctx, teacherID, service.CreateClassInput{
		Name:       "Test",
		CourseCode: "SO34E",
		Semester:   "2026/2",
		StartDate:  now.Add(24 * time.Hour),
		EndDate:    now,
	})
	if err != domain.ErrInvalidDateRange {
		t.Fatalf("expected ErrInvalidDateRange, got: %v", err)
	}

	// Invite enabled without dates
	_, err = svc.CreateClass(ctx, teacherID, service.CreateClassInput{
		Name:             "Test",
		CourseCode:       "SO34E",
		Semester:         "2026/2",
		StartDate:        now,
		EndDate:          now.Add(24 * time.Hour),
		EnableInviteLink: true,
	})
	if err != domain.ErrInviteLinkConfigRequired {
		t.Fatalf("expected ErrInviteLinkConfigRequired, got: %v", err)
	}

	// Conflict
	lStart := now
	lEnd := now.Add(time.Hour)
	_, err = svc.CreateClass(ctx, teacherID, service.CreateClassInput{
		Name:             "Test 1",
		CourseCode:       "SO34E",
		Semester:         "2026/2",
		StartDate:        now,
		EndDate:          now.Add(24 * time.Hour),
		EnableInviteLink: true,
		InviteLinkStart:  &lStart,
		InviteLinkEnd:    &lEnd,
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.CreateClass(ctx, teacherID, service.CreateClassInput{
		Name:             "Test Duplicate",
		CourseCode:       "SO34E",
		Semester:         "2026/2",
		StartDate:        now,
		EndDate:          now.Add(24 * time.Hour),
		EnableInviteLink: true,
		InviteLinkStart:  &lStart,
		InviteLinkEnd:    &lEnd,
	})
	if err != domain.ErrClassConflict {
		t.Fatalf("expected ErrClassConflict, got %v", err)
	}
}

func TestUpdateClassAndPermissions(t *testing.T) {
	svc, _, now := setupTest()
	ctx := context.Background()
	teacher1 := uuid.New()
	teacher2 := uuid.New()

	class, err := svc.CreateClass(ctx, teacher1, service.CreateClassInput{
		Name:       "Turma Original",
		CourseCode: "SO34E",
		Semester:   "2026/2",
		StartDate:  now,
		EndDate:    now.Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Teacher 2 cannot update
	newName := "Turma Hackeada"
	_, err = svc.UpdateClass(ctx, teacher2, class.ID, service.UpdateClassInput{Name: &newName})
	if err != domain.ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}

	// Teacher 1 updates with new extended date
	extendedEnd := now.Add(60 * 24 * time.Hour)
	updated, err := svc.UpdateClass(ctx, teacher1, class.ID, service.UpdateClassInput{
		Name:    &newName,
		EndDate: &extendedEnd,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if updated.Name != newName || !updated.EndDate.Equal(extendedEnd) {
		t.Fatalf("fields not updated properly")
	}
}

func TestArchiveClass(t *testing.T) {
	svc, _, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()

	class, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:       "Turma Ativa",
		CourseCode: "SO34E",
		Semester:   "2026/2",
		StartDate:  now,
		EndDate:    now.Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Archiving active class with empty reason fails
	_, err = svc.ArchiveClass(ctx, teacher, class.ID, "   ")
	if err != domain.ErrArchiveReasonRequired {
		t.Fatalf("expected ErrArchiveReasonRequired, got %v", err)
	}

	// Archiving with reason succeeds
	reason := "Semestre encerrado após calendário suplementar"
	archived, err := svc.ArchiveClass(ctx, teacher, class.ID, reason)
	if err != nil {
		t.Fatalf("archive failed: %v", err)
	}
	if archived.Status != domain.ClassStatusArchived || *archived.ArchiveReason != reason {
		t.Fatalf("unexpected archived state: %+v", archived)
	}
}

func TestJoinByTokenFlow(t *testing.T) {
	svc, repo, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()
	student := uuid.New()

	linkStart := now.Add(-1 * time.Hour)
	linkEnd := now.Add(2 * time.Hour)

	class, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:             "Turma Ingresso",
		CourseCode:       "SO34E",
		Semester:         "2026/2",
		StartDate:        now,
		EndDate:          now.Add(60 * 24 * time.Hour),
		EnableInviteLink: true,
		InviteLinkStart:  &linkStart,
		InviteLinkEnd:    &linkEnd,
	})
	if err != nil {
		t.Fatal(err)
	}

	token := *class.InviteLinkToken

	// Successful join request -> status PENDING_MODERATION
	res, err := svc.JoinByToken(ctx, student, token)
	if err != nil {
		t.Fatalf("join request failed: %v", err)
	}
	if res.Status != domain.EnrollmentPendingModeration {
		t.Fatalf("expected PENDING_MODERATION, got %s", res.Status)
	}
	if res.ClassName != "Turma Ingresso" {
		t.Fatalf("expected class name match")
	}

	// Duplicate join fails
	_, err = svc.JoinByToken(ctx, student, token)
	if err != domain.ErrAlreadyEnrolled {
		t.Fatalf("expected ErrAlreadyEnrolled, got %v", err)
	}

	// Join with expired window fails with ErrInviteLinkExpired
	expiredSvc := service.New(repo).WithNow(func() time.Time { return now.Add(5 * time.Hour) })
	student2 := uuid.New()
	_, err = expiredSvc.JoinByToken(ctx, student2, token)
	if err != domain.ErrInviteLinkExpired {
		t.Fatalf("expected ErrInviteLinkExpired, got %v", err)
	}
}

func TestModerateMemberFlow(t *testing.T) {
	svc, repo, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()
	student := uuid.New()

	linkStart := now.Add(-1 * time.Hour)
	linkEnd := now.Add(2 * time.Hour)

	class, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:             "Turma Moderação",
		CourseCode:       "SO34E",
		Semester:         "2026/2",
		StartDate:        now,
		EndDate:          now.Add(60 * 24 * time.Hour),
		EnableInviteLink: true,
		InviteLinkStart:  &linkStart,
		InviteLinkEnd:    &linkEnd,
	})
	if err != nil {
		t.Fatal(err)
	}

	joinRes, err := svc.JoinByToken(ctx, student, *class.InviteLinkToken)
	if err != nil {
		t.Fatal(err)
	}

	// List members
	members, err := svc.ListMembers(ctx, teacher, class.ID, string(domain.EnrollmentPendingModeration))
	if err != nil {
		t.Fatalf("failed to list members: %v", err)
	}
	if len(members) != 1 {
		t.Fatalf("expected 1 pending member, got %d", len(members))
	}

	// Teacher approves enrollment
	approved, err := svc.ModerateMember(ctx, teacher, class.ID, joinRes.EnrollmentID, true, nil)
	if err != nil {
		t.Fatalf("approve failed: %v", err)
	}
	if approved.Status != domain.EnrollmentActive || approved.DecidedAt == nil {
		t.Fatalf("expected active approved status")
	}

	// Verify in repo
	saved := repo.enrollments[joinRes.EnrollmentID]
	if saved.Status != domain.EnrollmentActive {
		t.Fatalf("status not updated in repo")
	}

	// Moderate with rejection
	student2 := uuid.New()
	joinRes2, err := svc.JoinByToken(ctx, student2, *class.InviteLinkToken)
	if err != nil {
		t.Fatal(err)
	}

	reason := "Aluno não consta na lista oficial da turma"
	rejected, err := svc.ModerateMember(ctx, teacher, class.ID, joinRes2.EnrollmentID, false, &reason)
	if err != nil {
		t.Fatalf("reject failed: %v", err)
	}
	if rejected.Status != domain.EnrollmentRejected || rejected.RejectionReason == nil || *rejected.RejectionReason != reason {
		t.Fatalf("expected rejected status with reason")
	}
}

func TestGetClassAndListClasses(t *testing.T) {
	svc, _, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()
	otherTeacher := uuid.New()

	class, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:       "Turma Consulta",
		CourseCode: "SO34E",
		Semester:   "2026/2",
		StartDate:  now,
		EndDate:    now.Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Teacher gets own class
	found, err := svc.GetClass(ctx, teacher, class.ID)
	if err != nil {
		t.Fatalf("unexpected error getting class: %v", err)
	}
	if found.ID != class.ID {
		t.Fatalf("class ID mismatch")
	}

	// Other teacher gets forbidden
	_, err = svc.GetClass(ctx, otherTeacher, class.ID)
	if err != domain.ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}

	// Non-existent class
	_, err = svc.GetClass(ctx, teacher, uuid.New())
	if err != domain.ErrClassNotFound {
		t.Fatalf("expected ErrClassNotFound, got %v", err)
	}

	// List classes
	res, err := svc.ListClasses(ctx, teacher, repository.ListFilter{Limit: 10, Page: 1})
	if err != nil {
		t.Fatalf("unexpected error listing classes: %v", err)
	}
	if len(res.Items) != 1 {
		t.Fatalf("expected 1 class item, got %d", len(res.Items))
	}
}

func TestArchiveDraftClassWithoutReason(t *testing.T) {
	svc, _, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()

	draftStatus := domain.ClassStatusDraft
	class, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:       "Turma Rascunho",
		CourseCode: "SO34E",
		Semester:   "2026/2",
		StartDate:  now,
		EndDate:    now.Add(30 * 24 * time.Hour),
		Status:     &draftStatus,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Archiving draft without reason succeeds
	archived, err := svc.ArchiveClass(ctx, teacher, class.ID, "")
	if err != nil {
		t.Fatalf("expected draft archiving to succeed without reason, got: %v", err)
	}
	if archived.Status != domain.ClassStatusArchived {
		t.Fatalf("expected archived status")
	}
}

func TestUpdateClassValidationAndEdgeCases(t *testing.T) {
	svc, _, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()

	class, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:       "Turma Teste Updates",
		CourseCode: "SO34E",
		Semester:   "2026/2",
		StartDate:  now,
		EndDate:    now.Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Update with invalid dates (start > end)
	badStart := now.Add(40 * 24 * time.Hour)
	_, err = svc.UpdateClass(ctx, teacher, class.ID, service.UpdateClassInput{StartDate: &badStart})
	if err != domain.ErrInvalidDateRange {
		t.Fatalf("expected ErrInvalidDateRange, got %v", err)
	}

	// Enable invite link with valid dates
	enableInvite := true
	invStart := now
	invEnd := now.Add(10 * time.Hour)
	updated, err := svc.UpdateClass(ctx, teacher, class.ID, service.UpdateClassInput{
		EnableInviteLink: &enableInvite,
		InviteLinkStart:  &invStart,
		InviteLinkEnd:    &invEnd,
	})
	if err != nil {
		t.Fatalf("unexpected error updating invite link: %v", err)
	}
	if !updated.EnableInviteLink || updated.InviteLinkToken == nil {
		t.Fatalf("expected invite link to be enabled with generated token")
	}

	// Update with invalid invite dates
	badInvStart := now.Add(20 * time.Hour)
	_, err = svc.UpdateClass(ctx, teacher, class.ID, service.UpdateClassInput{
		InviteLinkStart: &badInvStart,
	})
	if err != domain.ErrInvalidInviteRange {
		t.Fatalf("expected ErrInvalidInviteRange, got %v", err)
	}
}

func TestRejoinAndModerateErrors(t *testing.T) {
	svc, repo, now := setupTest()
	ctx := context.Background()
	teacher := uuid.New()
	student := uuid.New()

	linkStart := now.Add(-1 * time.Hour)
	linkEnd := now.Add(2 * time.Hour)

	class, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:             "Turma Rejoin",
		CourseCode:       "SO34E",
		Semester:         "2026/2",
		StartDate:        now,
		EndDate:          now.Add(60 * 24 * time.Hour),
		EnableInviteLink: true,
		InviteLinkStart:  &linkStart,
		InviteLinkEnd:    &linkEnd,
	})
	if err != nil {
		t.Fatal(err)
	}

	// First join
	joinRes, err := svc.JoinByToken(ctx, student, *class.InviteLinkToken)
	if err != nil {
		t.Fatal(err)
	}

	// Reject enrollment
	reason := "Documento incompleto"
	_, err = svc.ModerateMember(ctx, teacher, class.ID, joinRes.EnrollmentID, false, &reason)
	if err != nil {
		t.Fatal(err)
	}

	// Student rejoins after being rejected -> succeeds and becomes PENDING_MODERATION again
	rejoined, err := svc.JoinByToken(ctx, student, *class.InviteLinkToken)
	if err != nil {
		t.Fatalf("rejoining after rejection should succeed, got: %v", err)
	}
	if rejoined.Status != domain.EnrollmentPendingModeration {
		t.Fatalf("expected PENDING_MODERATION, got: %s", rejoined.Status)
	}

	// Moderation error: not class owner
	otherTeacher := uuid.New()
	_, err = svc.ModerateMember(ctx, otherTeacher, class.ID, joinRes.EnrollmentID, true, nil)
	if err != domain.ErrForbidden {
		t.Fatalf("expected ErrForbidden for other teacher, got: %v", err)
	}

	// Moderation error: enrollment not in class
	otherClass, err := svc.CreateClass(ctx, teacher, service.CreateClassInput{
		Name:       "Outra Turma",
		CourseCode: "SO35E",
		Semester:   "2026/2",
		StartDate:  now,
		EndDate:    now.Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.ModerateMember(ctx, teacher, otherClass.ID, joinRes.EnrollmentID, true, nil)
	if err != domain.ErrEnrollmentNotFound {
		t.Fatalf("expected ErrEnrollmentNotFound, got: %v", err)
	}

	// Archive non-existent class
	_, err = svc.ArchiveClass(ctx, teacher, uuid.New(), "motivo")
	if err != domain.ErrClassNotFound {
		t.Fatalf("expected ErrClassNotFound, got: %v", err)
	}

	// List members for non-existent class
	_, err = svc.ListMembers(ctx, teacher, uuid.New(), "")
	if err != domain.ErrClassNotFound {
		t.Fatalf("expected ErrClassNotFound, got: %v", err)
	}
	_ = repo
}


