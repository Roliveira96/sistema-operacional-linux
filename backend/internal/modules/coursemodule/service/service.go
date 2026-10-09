// Package service coordinates business operations and access rules for course modules (SPEC-010).
package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
)

var (
	ErrTitleRequired       = errors.New("module title is required")
	ErrDescriptionRequired = errors.New("module description is required")
)

// ModuleRepository defines required persistence methods.
type ModuleRepository interface {
	CreateModule(ctx context.Context, module *domain.CourseModule, classIDs []uuid.UUID, assignedBy uuid.UUID) error
	FindModuleByID(ctx context.Context, id uuid.UUID) (domain.CourseModule, error)
	FindModuleWithDetails(ctx context.Context, id uuid.UUID) (repository.ModuleDetails, error)
	ListTeacherModules(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error)
	ListAllModules(ctx context.Context, filter repository.ListFilter) (repository.ListResult, error)
	ListPublicModules(ctx context.Context, now time.Time, filter repository.ListFilter) (repository.ListResult, error)
	ListStudentModules(ctx context.Context, studentID uuid.UUID, now time.Time, filter repository.ListFilter) (repository.ListResult, error)
	UpdateModule(ctx context.Context, module *domain.CourseModule, classIDs []uuid.UUID, assignedBy uuid.UUID) error
	UpdateExerciseOrder(ctx context.Context, moduleID uuid.UUID, orderedExerciseIDs []uuid.UUID) error
	ValidateTeacherClasses(ctx context.Context, teacherID uuid.UUID, classIDs []uuid.UUID) (bool, error)
	IsStudentEnrolledInAnyClass(ctx context.Context, studentID uuid.UUID, classIDs []uuid.UUID) (bool, error)
}

// Service implements the business logic for course modules.
type Service struct {
	repo ModuleRepository
	now  func() time.Time
}

// New creates a new course module service.
func New(repo ModuleRepository) *Service {
	return &Service{
		repo: repo,
		now:  time.Now,
	}
}

// SetNow overrides time generator for testing.
func (s *Service) SetNow(f func() time.Time) {
	s.now = f
}

// CreateModuleInput input for creating a module.
type CreateModuleInput struct {
	TeacherID       uuid.UUID
	Title           string
	Description     string
	Visibility      domain.Visibility
	ActivationStart *time.Time
	ActivationEnd   *time.Time
	ClassIDs        []uuid.UUID
}

// CreateModule creates a new course module.
func (s *Service) CreateModule(ctx context.Context, input CreateModuleInput) (domain.CourseModule, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return domain.CourseModule{}, ErrTitleRequired
	}
	desc := strings.TrimSpace(input.Description)
	if desc == "" {
		return domain.CourseModule{}, ErrDescriptionRequired
	}

	if !domain.ValidateVisibility(input.Visibility) {
		return domain.CourseModule{}, domain.ErrInvalidVisibility
	}

	if err := domain.ValidateDates(input.ActivationStart, input.ActivationEnd); err != nil {
		return domain.CourseModule{}, err
	}

	if input.Visibility == domain.VisibilityPrivate {
		if len(input.ClassIDs) == 0 {
			return domain.CourseModule{}, domain.ErrPrivateRequiresClass
		}
		valid, err := s.repo.ValidateTeacherClasses(ctx, input.TeacherID, input.ClassIDs)
		if err != nil {
			return domain.CourseModule{}, err
		}
		if !valid {
			return domain.CourseModule{}, domain.ErrForbidden
		}
	}

	module := domain.CourseModule{
		TeacherID:       input.TeacherID,
		Title:           title,
		Description:     desc,
		Visibility:      input.Visibility,
		Status:          domain.ModuleStatusActive,
		ActivationStart: input.ActivationStart,
		ActivationEnd:   input.ActivationEnd,
	}

	if err := s.repo.CreateModule(ctx, &module, input.ClassIDs, input.TeacherID); err != nil {
		return domain.CourseModule{}, err
	}

	return module, nil
}

// UpdateModuleInput input for modifying a module.
type UpdateModuleInput struct {
	ModuleID        uuid.UUID
	CallerID        uuid.UUID
	IsAdmin         bool
	Title           *string
	Description     *string
	Visibility      *domain.Visibility
	Status          *domain.ModuleStatus
	ActivationStart *time.Time
	ActivationEnd   *time.Time
	ClassIDs        []uuid.UUID
}

// UpdateModule updates existing module metadata and associations.
func (s *Service) UpdateModule(ctx context.Context, input UpdateModuleInput) (domain.CourseModule, error) {
	module, err := s.repo.FindModuleByID(ctx, input.ModuleID)
	if err != nil {
		return domain.CourseModule{}, err
	}

	if !input.IsAdmin && module.TeacherID != input.CallerID {
		return domain.CourseModule{}, domain.ErrForbidden
	}

	if input.Title != nil {
		t := strings.TrimSpace(*input.Title)
		if t == "" {
			return domain.CourseModule{}, ErrTitleRequired
		}
		module.Title = t
	}

	if input.Description != nil {
		d := strings.TrimSpace(*input.Description)
		if d == "" {
			return domain.CourseModule{}, ErrDescriptionRequired
		}
		module.Description = d
	}

	if input.Visibility != nil {
		if !domain.ValidateVisibility(*input.Visibility) {
			return domain.CourseModule{}, domain.ErrInvalidVisibility
		}
		module.Visibility = *input.Visibility
	}

	if input.Status != nil {
		switch *input.Status {
		case domain.ModuleStatusActive, domain.ModuleStatusInactive, domain.ModuleStatusArchived:
			module.Status = *input.Status
		default:
			return domain.CourseModule{}, domain.ErrInvalidStatus
		}
	}

	start := module.ActivationStart
	if input.ActivationStart != nil {
		start = input.ActivationStart
	}
	end := module.ActivationEnd
	if input.ActivationEnd != nil {
		end = input.ActivationEnd
	}

	if err := domain.ValidateDates(start, end); err != nil {
		return domain.CourseModule{}, err
	}

	module.ActivationStart = start
	module.ActivationEnd = end
	// A teacher edit protects the module from content reloads (SPEC-011 RN-04).
	editedAt := s.now()
	module.EditedByTeacherAt = &editedAt

	if module.Visibility == domain.VisibilityPrivate && input.ClassIDs != nil {
		if len(input.ClassIDs) == 0 {
			return domain.CourseModule{}, domain.ErrPrivateRequiresClass
		}
		if !input.IsAdmin {
			valid, err := s.repo.ValidateTeacherClasses(ctx, input.CallerID, input.ClassIDs)
			if err != nil {
				return domain.CourseModule{}, err
			}
			if !valid {
				return domain.CourseModule{}, domain.ErrForbidden
			}
		}
	}

	if err := s.repo.UpdateModule(ctx, &module, input.ClassIDs, input.CallerID); err != nil {
		return domain.CourseModule{}, err
	}

	return module, nil
}

// UserAccessContext encapsulates the requesting user credentials.
type UserAccessContext struct {
	UserID    *uuid.UUID
	Role      string // TEACHER, ADMIN, STUDENT, or empty
	IsTeacher bool
	IsAdmin   bool
	IsStudent bool
}

// GetModuleByID retrieves module details enforcing visibility and activation rules.
func (s *Service) GetModuleByID(ctx context.Context, moduleID uuid.UUID, userCtx UserAccessContext) (repository.ModuleDetails, error) {
	details, err := s.repo.FindModuleWithDetails(ctx, moduleID)
	if err != nil {
		return repository.ModuleDetails{}, err
	}

	// Teacher owners and Admins can always inspect their modules
	if userCtx.IsAdmin || (userCtx.IsTeacher && userCtx.UserID != nil && details.Module.TeacherID == *userCtx.UserID) {
		return details, nil
	}

	now := s.now()

	// For student or public access, check manual status and date window
	if !details.Module.IsActiveNow(now) {
		if details.Module.Status != domain.ModuleStatusActive {
			return repository.ModuleDetails{}, domain.ErrModuleInactive
		}
		return repository.ModuleDetails{}, domain.ErrModuleExpired
	}

	switch details.Module.Visibility {
	case domain.VisibilityPublic:
		return details, nil

	case domain.VisibilityAuthenticated:
		if userCtx.UserID == nil {
			return repository.ModuleDetails{}, domain.ErrForbidden
		}
		return details, nil

	case domain.VisibilityPrivate:
		if userCtx.UserID == nil || !userCtx.IsStudent {
			return repository.ModuleDetails{}, domain.ErrForbidden
		}
		enrolled, err := s.repo.IsStudentEnrolledInAnyClass(ctx, *userCtx.UserID, details.AssignedClassIDs)
		if err != nil {
			return repository.ModuleDetails{}, err
		}
		if !enrolled {
			return repository.ModuleDetails{}, domain.ErrForbidden
		}
		return details, nil
	}

	return details, nil
}

// ListModules lists modules according to caller's role.
func (s *Service) ListModules(ctx context.Context, userCtx UserAccessContext, filter repository.ListFilter) (repository.ListResult, error) {
	// An administrator manages every module, whoever created it; a teacher only their own (RN-01).
	if userCtx.IsAdmin {
		return s.repo.ListAllModules(ctx, filter)
	}
	if userCtx.IsTeacher {
		if userCtx.UserID == nil {
			return repository.ListResult{}, domain.ErrForbidden
		}
		return s.repo.ListTeacherModules(ctx, *userCtx.UserID, filter)
	}

	if userCtx.IsStudent && userCtx.UserID != nil {
		return s.repo.ListStudentModules(ctx, *userCtx.UserID, s.now(), filter)
	}

	return s.repo.ListPublicModules(ctx, s.now(), filter)
}

// ListPublicModules retrieves active unexpired public modules.
func (s *Service) ListPublicModules(ctx context.Context, filter repository.ListFilter) (repository.ListResult, error) {
	return s.repo.ListPublicModules(ctx, s.now(), filter)
}

// ReorderExercises updates the order of exercises inside the module.
func (s *Service) ReorderExercises(ctx context.Context, moduleID, callerID uuid.UUID, isAdmin bool, exerciseIDs []uuid.UUID) error {
	if len(exerciseIDs) == 0 {
		return domain.ErrInvalidExerciseSequence
	}

	// Check duplicates
	seen := make(map[uuid.UUID]bool, len(exerciseIDs))
	for _, id := range exerciseIDs {
		if seen[id] {
			return domain.ErrDuplicateExerciseOrder
		}
		seen[id] = true
	}

	module, err := s.repo.FindModuleByID(ctx, moduleID)
	if err != nil {
		return err
	}

	if !isAdmin && module.TeacherID != callerID {
		return domain.ErrForbidden
	}

	return s.repo.UpdateExerciseOrder(ctx, moduleID, exerciseIDs)
}
