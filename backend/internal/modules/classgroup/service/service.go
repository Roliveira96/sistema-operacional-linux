// Package service implements class management and enrollment business logic (SPEC-009).
package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
)

// ClassRepository defines persistence operations needed by the service.
type ClassRepository interface {
	CreateClass(ctx context.Context, class *domain.ClassGroup, initialStudentIDs []uuid.UUID, now time.Time) error
	FindClassByID(ctx context.Context, id uuid.UUID) (domain.ClassGroup, error)
	FindClassByInviteToken(ctx context.Context, token string) (domain.ClassGroup, error)
	ListClassesByTeacher(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error)
	UpdateClass(ctx context.Context, class *domain.ClassGroup) error

	CreateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error
	FindEnrollment(ctx context.Context, classID, userID uuid.UUID) (domain.Enrollment, error)
	FindEnrollmentByID(ctx context.Context, id uuid.UUID) (domain.Enrollment, error)
	ListEnrollmentsByClass(ctx context.Context, classID uuid.UUID, status string) ([]repository.EnrollmentWithUser, error)
	UpdateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error
}

// CreateClassInput defines parameters for creating a new class.
type CreateClassInput struct {
	Name                    string
	CourseCode              string
	Semester                string
	Syllabus                string
	InstitutionalGuidelines string
	StartDate               time.Time
	EndDate                 time.Time
	ScheduleDescription     string
	EnableVirtualClassroom  bool
	EnableInviteLink        bool
	InviteLinkStart         *time.Time
	InviteLinkEnd           *time.Time
	InitialStudentIDs       []uuid.UUID
	Status                  *domain.ClassStatus
}

// UpdateClassInput defines parameters for updating an existing class.
type UpdateClassInput struct {
	Name                    *string
	Syllabus                *string
	InstitutionalGuidelines *string
	StartDate               *time.Time
	EndDate                 *time.Time
	ScheduleDescription     *string
	EnableVirtualClassroom  *bool
	EnableInviteLink        *bool
	InviteLinkStart         *time.Time
	InviteLinkEnd           *time.Time
}

// JoinResult holds output data from a join request.
type JoinResult struct {
	EnrollmentID uuid.UUID
	ClassName    string
	Status       domain.EnrollmentStatus
}

// Service coordinates class management and moderation operations.
type Service struct {
	repo ClassRepository
	now  func() time.Time
}

// New creates a new classgroup service.
func New(repo ClassRepository) *Service {
	return &Service{
		repo: repo,
		now:  time.Now,
	}
}

// WithNow configures custom clock for deterministic testing.
func (s *Service) WithNow(now func() time.Time) *Service {
	s.now = now
	return s
}

// CreateClass creates a new class offering and optionally enrolls initial students.
func (s *Service) CreateClass(ctx context.Context, teacherID uuid.UUID, input CreateClassInput) (domain.ClassGroup, error) {
	if err := domain.ValidateDates(input.StartDate, input.EndDate); err != nil {
		return domain.ClassGroup{}, err
	}
	if err := domain.ValidateInviteLink(input.EnableInviteLink, input.InviteLinkStart, input.InviteLinkEnd); err != nil {
		return domain.ClassGroup{}, err
	}

	status := domain.ClassStatusActive
	if input.Status != nil {
		status = *input.Status
	}

	var inviteToken *string
	if input.EnableInviteLink {
		token, err := domain.GenerateInviteToken()
		if err != nil {
			return domain.ClassGroup{}, err
		}
		inviteToken = &token
	}

	now := s.now()
	class := domain.ClassGroup{
		TeacherID:               teacherID,
		Name:                    strings.TrimSpace(input.Name),
		CourseCode:              strings.TrimSpace(input.CourseCode),
		Semester:                strings.TrimSpace(input.Semester),
		Syllabus:                strings.TrimSpace(input.Syllabus),
		InstitutionalGuidelines: strings.TrimSpace(input.InstitutionalGuidelines),
		StartDate:               input.StartDate,
		EndDate:                 input.EndDate,
		ScheduleDescription:     strings.TrimSpace(input.ScheduleDescription),
		EnableVirtualClassroom:  input.EnableVirtualClassroom,
		EnableInviteLink:        input.EnableInviteLink,
		InviteLinkToken:         inviteToken,
		InviteLinkStart:         input.InviteLinkStart,
		InviteLinkEnd:           input.InviteLinkEnd,
		Status:                  status,
	}

	if err := s.repo.CreateClass(ctx, &class, input.InitialStudentIDs, now); err != nil {
		return domain.ClassGroup{}, err
	}
	return class, nil
}

// ListClasses retrieves paginated classes owned by the given teacher.
func (s *Service) ListClasses(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error) {
	return s.repo.ListClassesByTeacher(ctx, teacherID, filter)
}

// GetClass retrieves a single class assuring teacher ownership.
func (s *Service) GetClass(ctx context.Context, teacherID, classID uuid.UUID) (domain.ClassGroup, error) {
	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return domain.ClassGroup{}, err
	}
	if class.TeacherID != teacherID {
		return domain.ClassGroup{}, domain.ErrForbidden
	}
	return class, nil
}

// UpdateClass updates metadata, schedule or invite link configuration.
func (s *Service) UpdateClass(ctx context.Context, teacherID, classID uuid.UUID, input UpdateClassInput) (domain.ClassGroup, error) {
	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return domain.ClassGroup{}, err
	}
	if class.TeacherID != teacherID {
		return domain.ClassGroup{}, domain.ErrForbidden
	}

	startDate := class.StartDate
	endDate := class.EndDate
	if input.StartDate != nil {
		startDate = *input.StartDate
	}
	if input.EndDate != nil {
		endDate = *input.EndDate
	}
	if err := domain.ValidateDates(startDate, endDate); err != nil {
		return domain.ClassGroup{}, err
	}

	enableInvite := class.EnableInviteLink
	if input.EnableInviteLink != nil {
		enableInvite = *input.EnableInviteLink
	}

	inviteStart := class.InviteLinkStart
	if input.InviteLinkStart != nil {
		inviteStart = input.InviteLinkStart
	}
	inviteEnd := class.InviteLinkEnd
	if input.InviteLinkEnd != nil {
		inviteEnd = input.InviteLinkEnd
	}

	if err := domain.ValidateInviteLink(enableInvite, inviteStart, inviteEnd); err != nil {
		return domain.ClassGroup{}, err
	}

	if enableInvite && (class.InviteLinkToken == nil || *class.InviteLinkToken == "") {
		token, err := domain.GenerateInviteToken()
		if err != nil {
			return domain.ClassGroup{}, err
		}
		class.InviteLinkToken = &token
	}

	if input.Name != nil {
		class.Name = strings.TrimSpace(*input.Name)
	}
	if input.Syllabus != nil {
		class.Syllabus = strings.TrimSpace(*input.Syllabus)
	}
	if input.InstitutionalGuidelines != nil {
		class.InstitutionalGuidelines = strings.TrimSpace(*input.InstitutionalGuidelines)
	}
	class.StartDate = startDate
	class.EndDate = endDate
	if input.ScheduleDescription != nil {
		class.ScheduleDescription = strings.TrimSpace(*input.ScheduleDescription)
	}
	if input.EnableVirtualClassroom != nil {
		class.EnableVirtualClassroom = *input.EnableVirtualClassroom
	}
	class.EnableInviteLink = enableInvite
	class.InviteLinkStart = inviteStart
	class.InviteLinkEnd = inviteEnd

	if err := s.repo.UpdateClass(ctx, &class); err != nil {
		return domain.ClassGroup{}, err
	}
	return class, nil
}

// ArchiveClass archives an active or draft class with required justification.
func (s *Service) ArchiveClass(ctx context.Context, teacherID, classID uuid.UUID, reason string) (domain.ClassGroup, error) {
	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return domain.ClassGroup{}, err
	}
	if class.TeacherID != teacherID {
		return domain.ClassGroup{}, domain.ErrForbidden
	}

	trimmedReason := strings.TrimSpace(reason)
	if class.Status != domain.ClassStatusDraft && trimmedReason == "" {
		return domain.ClassGroup{}, domain.ErrArchiveReasonRequired
	}

	class.Status = domain.ClassStatusArchived
	class.ArchiveReason = &trimmedReason

	if err := s.repo.UpdateClass(ctx, &class); err != nil {
		return domain.ClassGroup{}, err
	}
	return class, nil
}

// JoinByToken processes a student join request via invite token.
func (s *Service) JoinByToken(ctx context.Context, studentID uuid.UUID, token string) (JoinResult, error) {
	class, err := s.repo.FindClassByInviteToken(ctx, token)
	if err != nil {
		return JoinResult{}, domain.ErrClassNotFound
	}

	now := s.now()
	if !class.IsInviteLinkValid(now) {
		return JoinResult{}, domain.ErrInviteLinkExpired
	}

	existing, err := s.repo.FindEnrollment(ctx, class.ID, studentID)
	if err == nil {
		if existing.Status == domain.EnrollmentActive || existing.Status == domain.EnrollmentPendingModeration {
			return JoinResult{}, domain.ErrAlreadyEnrolled
		}
		// If previously rejected or unenrolled, reinstate as pending
		existing.Status = domain.EnrollmentPendingModeration
		existing.Origin = domain.OriginInviteLink
		existing.RequestedAt = now
		existing.DecidedAt = nil
		existing.RejectionReason = nil
		if err := s.repo.UpdateEnrollment(ctx, &existing); err != nil {
			return JoinResult{}, err
		}
		return JoinResult{
			EnrollmentID: existing.ID,
			ClassName:    class.Name,
			Status:       domain.EnrollmentPendingModeration,
		}, nil
	}

	enrollment := domain.Enrollment{
		ClassID:     class.ID,
		UserID:      studentID,
		Status:      domain.EnrollmentPendingModeration,
		Origin:      domain.OriginInviteLink,
		RequestedAt: now,
	}

	if err := s.repo.CreateEnrollment(ctx, &enrollment); err != nil {
		return JoinResult{}, err
	}

	return JoinResult{
		EnrollmentID: enrollment.ID,
		ClassName:    class.Name,
		Status:       domain.EnrollmentPendingModeration,
	}, nil
}

// ListMembers retrieves class members and pending requests for the teacher.
func (s *Service) ListMembers(ctx context.Context, teacherID, classID uuid.UUID, status string) ([]repository.EnrollmentWithUser, error) {
	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return nil, err
	}
	if class.TeacherID != teacherID {
		return nil, domain.ErrForbidden
	}

	return s.repo.ListEnrollmentsByClass(ctx, classID, status)
}

// ModerateMember deliberates (approves or rejects) a student's pending enrollment.
func (s *Service) ModerateMember(ctx context.Context, teacherID, classID, enrollmentID uuid.UUID, approve bool, rejectionReason *string) (domain.Enrollment, error) {
	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return domain.Enrollment{}, err
	}
	if class.TeacherID != teacherID {
		return domain.Enrollment{}, domain.ErrForbidden
	}

	enrollment, err := s.repo.FindEnrollmentByID(ctx, enrollmentID)
	if err != nil {
		return domain.Enrollment{}, err
	}
	if enrollment.ClassID != classID {
		return domain.Enrollment{}, domain.ErrEnrollmentNotFound
	}

	now := s.now()
	enrollment.DecidedAt = &now
	if approve {
		enrollment.Status = domain.EnrollmentActive
		enrollment.RejectionReason = nil
	} else {
		enrollment.Status = domain.EnrollmentRejected
		enrollment.RejectionReason = rejectionReason
	}

	if err := s.repo.UpdateEnrollment(ctx, &enrollment); err != nil {
		return domain.Enrollment{}, err
	}
	return enrollment, nil
}
