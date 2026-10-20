// Package service implements class management and enrollment business logic (SPEC-009).
package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/htmlsafe"
)

// ClassRepository defines persistence operations needed by the service.
type ClassRepository interface {
	CreateClass(ctx context.Context, class *domain.ClassGroup, initialStudentIDs []uuid.UUID, now time.Time) error
	FindClassByID(ctx context.Context, id uuid.UUID) (domain.ClassGroup, error)
	FindClassByInviteToken(ctx context.Context, token string) (domain.ClassGroup, error)
	ListClassesByTeacher(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error)
	UpdateClass(ctx context.Context, class *domain.ClassGroup) error
	// DeleteClass soft deletes the class, recording who did it (SPEC-050).
	DeleteClass(ctx context.Context, class *domain.ClassGroup, actorID uuid.UUID) error

	CreateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error
	FindEnrollment(ctx context.Context, classID, userID uuid.UUID) (domain.Enrollment, error)
	FindEnrollmentByID(ctx context.Context, id uuid.UUID) (domain.Enrollment, error)
	ListEnrollmentsByClass(ctx context.Context, classID uuid.UUID, status string) ([]repository.EnrollmentWithUser, error)
	UpdateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error

	ListTeacherClassesForMenu(ctx context.Context, teacherID uuid.UUID, limit int) (repository.MyClassesResult, error)
	ListStudentClassesForMenu(ctx context.Context, studentID uuid.UUID, limit int) (repository.MyClassesResult, error)

	FindUserRoles(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error)
	ListEnrollmentsByUsers(ctx context.Context, classID uuid.UUID, userIDs []uuid.UUID) ([]domain.Enrollment, error)
	SaveEnrollments(ctx context.Context, created, updated []domain.Enrollment) error
	FindUserName(ctx context.Context, id uuid.UUID) (*string, error)
}

// CreateClassInput defines parameters for creating a new class.
type CreateClassInput struct {
	Name                    string
	CourseCode              string
	Semester                string
	Summary                 string
	Color                   string
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
	CourseCode              *string
	Semester                *string
	Summary                 *string
	Color                   *string
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

// RejectedStudent is a student of a batch that was not enrolled, with the reason (SPEC-041 RN-05).
type RejectedStudent struct {
	StudentID uuid.UUID
	Reason    string
}

// EnrollStudentsResult is the outcome of a batch enrollment (SPEC-041, section 5.1).
type EnrollStudentsResult struct {
	Enrolled        []uuid.UUID
	AlreadyEnrolled []uuid.UUID
	Rejected        []RejectedStudent
}

// StudentClassView is what an enrolled student reads of a class (SPEC-041 RN-09).
type StudentClassView struct {
	Class       domain.ClassGroup
	TeacherName *string
}

// ScheduleHook rebuilds the sessions of a class when its validity changes (SPEC-042 CA-03).
type ScheduleHook interface {
	Regenerate(ctx context.Context, classID uuid.UUID) error
}

// Service coordinates class management and moderation operations.
type Service struct {
	repo     ClassRepository
	richText *htmlsafe.Sanitizer
	now      func() time.Time
	schedule ScheduleHook
}

// WithScheduleHook makes a change of validity regenerate the sessions of the class.
func (s *Service) WithScheduleHook(h ScheduleHook) *Service {
	s.schedule = h
	return s
}

// New creates a new classgroup service.
func New(repo ClassRepository) *Service {
	return &Service{
		repo:     repo,
		richText: htmlsafe.NewRichText(),
		now:      time.Now,
	}
}

// richTextField filters the HTML of a syllabus or guidelines and checks its length (SPEC-041 RN-02).
func (s *Service) richTextField(field, markup string) (string, error) {
	filtered := strings.TrimSpace(s.richText.Sanitize(markup))
	if utf8.RuneCountInString(filtered) > domain.RichTextMaxLength {
		return "", &domain.ContentTooLongError{Field: field}
	}
	return filtered, nil
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

	summary, err := domain.NormalizeSummary(input.Summary)
	if err != nil {
		return domain.ClassGroup{}, err
	}
	color, err := domain.NormalizeColor(input.Color)
	if err != nil {
		return domain.ClassGroup{}, err
	}
	syllabus, err := s.richTextField("syllabus", input.Syllabus)
	if err != nil {
		return domain.ClassGroup{}, err
	}
	guidelines, err := s.richTextField("institutionalGuidelines", input.InstitutionalGuidelines)
	if err != nil {
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
		Summary:                 summary,
		Color:                   color,
		Syllabus:                syllabus,
		InstitutionalGuidelines: guidelines,
		StartDate:               input.StartDate,
		EndDate:                 input.EndDate,
		ScheduleDescription:     strings.TrimSpace(input.ScheduleDescription),
		EnableVirtualClassroom:  input.EnableVirtualClassroom,
		EnableInviteLink:        input.EnableInviteLink,
		InviteLinkToken:         inviteToken,
		InviteLinkStart:         input.InviteLinkStart,
		InviteLinkEnd:           input.InviteLinkEnd,
		Status:                  status,
		CreatedBy:               teacherID,
		UpdatedBy:               teacherID,
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

// ListMyClasses returns the classes of the authenticated user for the account menu (SPEC-026).
// Teachers get their non-archived classes, students their ACTIVE/PENDING_MODERATION ones,
// any other role (admin) gets an empty list.
func (s *Service) ListMyClasses(ctx context.Context, userID uuid.UUID, role string) (repository.MyClassesResult, error) {
	var (
		res repository.MyClassesResult
		err error
	)
	switch role {
	case authn.RoleTeacher:
		res, err = s.repo.ListTeacherClassesForMenu(ctx, userID, domain.MyClassesLimit)
	case authn.RoleStudent:
		res, err = s.repo.ListStudentClassesForMenu(ctx, userID, domain.MyClassesLimit)
	}
	if err != nil {
		return repository.MyClassesResult{}, err
	}
	if res.Items == nil {
		res.Items = []repository.MyClass{}
	}
	return res, nil
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

// Lookup reads a class without asking who wants it. It is for the modules that decide who may do what themselves (SPEC-075 RN-01): they compare
// TeacherID with the actor.
func (s *Service) Lookup(ctx context.Context, classID uuid.UUID) (domain.ClassGroup, error) {
	return s.repo.FindClassByID(ctx, classID)
}

// ActiveMembers gives the students of a class with an ACTIVE enrollment, with their names, to the modules that decide who may do what themselves
// (SPEC-075 RN-08).
func (s *Service) ActiveMembers(ctx context.Context, classID uuid.UUID) ([]repository.EnrollmentWithUser, error) {
	return s.repo.ListEnrollmentsByClass(ctx, classID, string(domain.EnrollmentActive))
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
	if input.CourseCode != nil {
		class.CourseCode = strings.TrimSpace(*input.CourseCode)
	}
	if input.Semester != nil {
		class.Semester = strings.TrimSpace(*input.Semester)
	}
	if input.Color != nil {
		color, err := domain.NormalizeColor(*input.Color)
		if err != nil {
			return domain.ClassGroup{}, err
		}
		class.Color = color
	}
	if input.Summary != nil {
		summary, err := domain.NormalizeSummary(*input.Summary)
		if err != nil {
			return domain.ClassGroup{}, err
		}
		class.Summary = summary
	}
	if input.Syllabus != nil {
		syllabus, err := s.richTextField("syllabus", *input.Syllabus)
		if err != nil {
			return domain.ClassGroup{}, err
		}
		class.Syllabus = syllabus
	}
	if input.InstitutionalGuidelines != nil {
		guidelines, err := s.richTextField("institutionalGuidelines", *input.InstitutionalGuidelines)
		if err != nil {
			return domain.ClassGroup{}, err
		}
		class.InstitutionalGuidelines = guidelines
	}
	if input.ScheduleDescription != nil {
		class.ScheduleDescription = strings.TrimSpace(*input.ScheduleDescription)
	}
	if input.EnableVirtualClassroom != nil {
		class.EnableVirtualClassroom = *input.EnableVirtualClassroom
	}
	class.EnableInviteLink = enableInvite
	class.InviteLinkStart = inviteStart
	class.InviteLinkEnd = inviteEnd

	validityChanged := !class.StartDate.Equal(startDate) || !class.EndDate.Equal(endDate)
	class.StartDate = startDate
	class.EndDate = endDate
	class.UpdatedBy = teacherID
	class.UpdatedAt = s.now()
	if err := s.repo.UpdateClass(ctx, &class); err != nil {
		return domain.ClassGroup{}, err
	}
	if validityChanged && s.schedule != nil {
		if err := s.schedule.Regenerate(ctx, class.ID); err != nil {
			return domain.ClassGroup{}, err
		}
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

	now := s.now()
	class.Status = domain.ClassStatusArchived
	class.ArchiveReason = &trimmedReason
	class.ArchivedAt = &now
	class.ArchivedBy = &teacherID
	class.UpdatedBy = teacherID
	class.UpdatedAt = now

	if err := s.repo.UpdateClass(ctx, &class); err != nil {
		return domain.ClassGroup{}, err
	}
	return class, nil
}

// DeleteClass deletes an archived class once 30 days or more have passed since it was archived. Only the owner deletes; the class
// is soft deleted and what hangs from it is kept (SPEC-050 RN-01 to RN-04).
func (s *Service) DeleteClass(ctx context.Context, teacherID, classID uuid.UUID) error {
	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return err
	}
	if class.TeacherID != teacherID {
		return domain.ErrForbidden
	}
	if !class.CanDelete(s.now()) {
		return &domain.NotDeletableError{After: class.DeletableAfter()}
	}
	return s.repo.DeleteClass(ctx, &class, teacherID)
}

// UserNames returns the display names of the users, for the history of a class (SPEC-049 RN-04). A user that cannot be read is
// left out.
func (s *Service) UserNames(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	names := make(map[uuid.UUID]string, len(ids))
	for _, id := range uniqueIDs(ids) {
		name, err := s.repo.FindUserName(ctx, id)
		if err != nil {
			return nil, err
		}
		if name != nil && *name != "" {
			names[id] = *name
		}
	}
	return names, nil
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

// EnrollStudents enrolls a batch of existing students in the class (SPEC-041 RN-03 to RN-06). Only the owner teacher
// or an admin enrolls; an archived class refuses. Each id is handled on its own and lands in one group of the result.
func (s *Service) EnrollStudents(ctx context.Context, actorID uuid.UUID, actorRole string, classID uuid.UUID, studentIDs []uuid.UUID) (EnrollStudentsResult, error) {
	ids := uniqueIDs(studentIDs)
	if len(ids) == 0 || len(ids) > domain.MaxEnrollmentBatch {
		return EnrollStudentsResult{}, domain.ErrInvalidEnrollmentBatch
	}

	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return EnrollStudentsResult{}, err
	}
	if actorRole != authn.RoleAdmin && class.TeacherID != actorID {
		return EnrollStudentsResult{}, domain.ErrForbidden
	}
	if class.Status == domain.ClassStatusArchived {
		return EnrollStudentsResult{}, domain.ErrClassArchived
	}

	roles, err := s.repo.FindUserRoles(ctx, ids)
	if err != nil {
		return EnrollStudentsResult{}, err
	}
	existing, err := s.repo.ListEnrollmentsByUsers(ctx, classID, ids)
	if err != nil {
		return EnrollStudentsResult{}, err
	}
	byUser := make(map[uuid.UUID]domain.Enrollment, len(existing))
	for _, e := range existing {
		byUser[e.UserID] = e
	}

	now := s.now()
	result := EnrollStudentsResult{Enrolled: []uuid.UUID{}, AlreadyEnrolled: []uuid.UUID{}, Rejected: []RejectedStudent{}}
	var created, updated []domain.Enrollment
	for _, id := range ids {
		if roles[id] != authn.RoleStudent {
			result.Rejected = append(result.Rejected, RejectedStudent{StudentID: id, Reason: domain.RejectReasonNotAStudent})
			continue
		}
		enrollment, found := byUser[id]
		if !found {
			created = append(created, domain.Enrollment{
				ClassID: classID, UserID: id, Status: domain.EnrollmentActive, Origin: domain.OriginDirectByTeacher,
				RequestedAt: now, DecidedAt: &now,
			})
			result.Enrolled = append(result.Enrolled, id)
			continue
		}
		switch enrollment.Status {
		case domain.EnrollmentActive:
			result.AlreadyEnrolled = append(result.AlreadyEnrolled, id)
		case domain.EnrollmentTransferred:
			result.Rejected = append(result.Rejected, RejectedStudent{StudentID: id, Reason: domain.RejectReasonTransferred})
		default: // PENDING_MODERATION, REJECTED, UNENROLLED (D-10)
			decided := now
			enrollment.Status = domain.EnrollmentActive
			enrollment.Origin = domain.OriginDirectByTeacher
			enrollment.RejectionReason = nil
			enrollment.DecidedAt = &decided
			updated = append(updated, enrollment)
			result.Enrolled = append(result.Enrolled, id)
		}
	}

	if len(created) > 0 || len(updated) > 0 {
		if err := s.repo.SaveEnrollments(ctx, created, updated); err != nil {
			return EnrollStudentsResult{}, err
		}
	}
	return result, nil
}

// GetMyClass returns the class to a student with an ACTIVE enrollment in it; anyone else gets ErrClassNotFound,
// so the class is not revealed (SPEC-041 RN-08).
func (s *Service) GetMyClass(ctx context.Context, studentID, classID uuid.UUID) (StudentClassView, error) {
	class, err := s.repo.FindClassByID(ctx, classID)
	if err != nil {
		return StudentClassView{}, err
	}
	enrollment, err := s.repo.FindEnrollment(ctx, classID, studentID)
	if err != nil || enrollment.Status != domain.EnrollmentActive {
		return StudentClassView{}, domain.ErrClassNotFound
	}
	teacherName, err := s.repo.FindUserName(ctx, class.TeacherID)
	if err != nil {
		return StudentClassView{}, err
	}
	return StudentClassView{Class: class, TeacherName: teacherName}, nil
}

// uniqueIDs keeps the first occurrence of each id, in order.
func uniqueIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
