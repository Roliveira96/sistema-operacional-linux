package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

type mockRepository struct {
	modules         map[uuid.UUID]domain.CourseModule
	details         map[uuid.UUID]repository.ModuleDetails
	teacherClasses  map[uuid.UUID][]uuid.UUID
	studentClasses  map[uuid.UUID][]uuid.UUID
	createErr       error
	updateErr       error
	validateErr     error
	reorderErr      error
	enrolledErr     error
	listTeacherRes  repository.ListResult
	listAllRes      repository.ListResult
	listPublicRes   repository.ListResult
	listStudentRes  repository.ListResult
	reorderedCalled bool
	slugOwners      map[string]uuid.UUID
}

func newMockRepository() *mockRepository {
	return &mockRepository{
		modules:        make(map[uuid.UUID]domain.CourseModule),
		details:        make(map[uuid.UUID]repository.ModuleDetails),
		teacherClasses: make(map[uuid.UUID][]uuid.UUID),
		studentClasses: make(map[uuid.UUID][]uuid.UUID),
		slugOwners:     make(map[string]uuid.UUID),
	}
}

func (m *mockRepository) CreateModule(ctx context.Context, module *domain.CourseModule, classIDs []uuid.UUID, assignedBy uuid.UUID) error {
	if m.createErr != nil {
		return m.createErr
	}
	if module.ID == uuid.Nil {
		module.ID = uuid.New()
	}
	m.modules[module.ID] = *module
	m.details[module.ID] = repository.ModuleDetails{
		Module:           *module,
		AssignedClassIDs: classIDs,
	}
	return nil
}

func (m *mockRepository) FindModuleByID(ctx context.Context, id uuid.UUID) (domain.CourseModule, error) {
	mod, ok := m.modules[id]
	if !ok {
		return domain.CourseModule{}, domain.ErrModuleNotFound
	}
	return mod, nil
}

func (m *mockRepository) FindModuleWithDetails(ctx context.Context, id uuid.UUID) (repository.ModuleDetails, error) {
	det, ok := m.details[id]
	if !ok {
		return repository.ModuleDetails{}, domain.ErrModuleNotFound
	}
	return det, nil
}

func (m *mockRepository) ListTeacherModules(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error) {
	return m.listTeacherRes, nil
}

func (m *mockRepository) SlugTaken(ctx context.Context, slug string, excludeID uuid.UUID) (bool, error) {
	owner, ok := m.slugOwners[slug]
	return ok && owner != excludeID, nil
}

func (m *mockRepository) ListAllModules(ctx context.Context, filter repository.ListFilter) (repository.ListResult, error) {
	return m.listAllRes, nil
}

func (m *mockRepository) ListPublicModules(ctx context.Context, now time.Time, filter repository.ListFilter) (repository.ListResult, error) {
	return m.listPublicRes, nil
}

func (m *mockRepository) ListStudentModules(ctx context.Context, studentID uuid.UUID, now time.Time, filter repository.ListFilter) (repository.ListResult, error) {
	return m.listStudentRes, nil
}

func (m *mockRepository) UpdateModule(ctx context.Context, module *domain.CourseModule, classIDs []uuid.UUID, assignedBy uuid.UUID) error {
	if m.updateErr != nil {
		return m.updateErr
	}
	m.modules[module.ID] = *module
	det := m.details[module.ID]
	det.Module = *module
	if classIDs != nil {
		det.AssignedClassIDs = classIDs
	}
	m.details[module.ID] = det
	return nil
}

func (m *mockRepository) UpdateExerciseOrder(ctx context.Context, moduleID uuid.UUID, orderedExerciseIDs []uuid.UUID) error {
	if m.reorderErr != nil {
		return m.reorderErr
	}
	m.reorderedCalled = true
	return nil
}

func (m *mockRepository) ReorderModules(ctx context.Context, moduleIDs []uuid.UUID) error {
	if m.reorderErr != nil {
		return m.reorderErr
	}
	m.reorderedCalled = true
	return nil
}

func (m *mockRepository) ValidateTeacherClasses(ctx context.Context, teacherID uuid.UUID, classIDs []uuid.UUID) (bool, error) {
	if m.validateErr != nil {
		return false, m.validateErr
	}
	validClasses, ok := m.teacherClasses[teacherID]
	if !ok {
		return false, nil
	}
	validMap := make(map[uuid.UUID]bool)
	for _, id := range validClasses {
		validMap[id] = true
	}
	for _, id := range classIDs {
		if !validMap[id] {
			return false, nil
		}
	}
	return true, nil
}

func (m *mockRepository) IsStudentEnrolledInAnyClass(ctx context.Context, studentID uuid.UUID, classIDs []uuid.UUID) (bool, error) {
	if m.enrolledErr != nil {
		return false, m.enrolledErr
	}
	enrolled, ok := m.studentClasses[studentID]
	if !ok {
		return false, nil
	}
	enrolledMap := make(map[uuid.UUID]bool)
	for _, id := range enrolled {
		enrolledMap[id] = true
	}
	for _, id := range classIDs {
		if enrolledMap[id] {
			return true, nil
		}
	}
	return false, nil
}

func TestService_CreateModule(t *testing.T) {
	teacherID := uuid.New()
	classID := uuid.New()

	fixedTime := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	start := fixedTime.Add(-1 * time.Hour)
	end := fixedTime.Add(24 * time.Hour)
	invertedEnd := fixedTime.Add(-2 * time.Hour)

	t.Run("fails when title is empty", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "   ",
			Description: "desc",
			Visibility:  domain.VisibilityPublic,
		})
		assert.Equal(t, service.ErrTitleRequired, err)
	})

	t.Run("fails when description is empty", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "Title",
			Description: "   ",
			Visibility:  domain.VisibilityPublic,
		})
		assert.Equal(t, service.ErrDescriptionRequired, err)
	})

	t.Run("fails on invalid visibility", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "Title",
			Description: "desc",
			Visibility:  "INVALID",
		})
		assert.Equal(t, domain.ErrInvalidVisibility, err)
	})

	t.Run("fails on inverted dates", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:       teacherID,
			Title:           "Title",
			Description:     "desc",
			Visibility:      domain.VisibilityPublic,
			ActivationStart: &start,
			ActivationEnd:   &invertedEnd,
		})
		assert.Equal(t, domain.ErrInvalidDateRange, err)
	})

	t.Run("fails when private has no classes", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "Title",
			Description: "desc",
			Visibility:  domain.VisibilityPrivate,
			ClassIDs:    []uuid.UUID{},
		})
		assert.Equal(t, domain.ErrPrivateRequiresClass, err)
	})

	t.Run("fails when private class does not belong to teacher", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "Title",
			Description: "desc",
			Visibility:  domain.VisibilityPrivate,
			ClassIDs:    []uuid.UUID{classID},
		})
		assert.Equal(t, domain.ErrForbidden, err)
	})

	t.Run("fails when class validation returns error", func(t *testing.T) {
		repo := newMockRepository()
		repo.validateErr = errors.New("db error")
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "Title",
			Description: "desc",
			Visibility:  domain.VisibilityPrivate,
			ClassIDs:    []uuid.UUID{classID},
		})
		assert.Error(t, err)
	})

	t.Run("succeeds for public module with valid dates", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		mod, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:       teacherID,
			Title:           "Operating Systems",
			Description:     "Concurrency and Processes",
			Visibility:      domain.VisibilityPublic,
			ActivationStart: &start,
			ActivationEnd:   &end,
		})
		require.NoError(t, err)
		assert.Equal(t, "Operating Systems", mod.Title)
		assert.Equal(t, domain.ModuleStatusActive, mod.Status)
	})

	t.Run("succeeds for private module when teacher owns the class", func(t *testing.T) {
		repo := newMockRepository()
		repo.teacherClasses[teacherID] = []uuid.UUID{classID}
		svc := service.New(repo)
		mod, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "Class Module",
			Description: "Private notes",
			Visibility:  domain.VisibilityPrivate,
			ClassIDs:    []uuid.UUID{classID},
		})
		require.NoError(t, err)
		assert.Equal(t, domain.VisibilityPrivate, mod.Visibility)
	})

	t.Run("propagates repo create error", func(t *testing.T) {
		repo := newMockRepository()
		repo.createErr = errors.New("cannot insert")
		svc := service.New(repo)
		_, err := svc.CreateModule(context.Background(), service.CreateModuleInput{
			TeacherID:   teacherID,
			Title:       "Title",
			Description: "desc",
			Visibility:  domain.VisibilityPublic,
		})
		assert.Error(t, err)
	})
}

func TestService_UpdateModule(t *testing.T) {
	teacherID := uuid.New()
	otherTeacherID := uuid.New()
	classID := uuid.New()
	moduleID := uuid.New()

	existing := domain.CourseModule{
		TeacherID:   teacherID,
		Title:       "Original Title",
		Description: "Original Desc",
		Visibility:  domain.VisibilityPublic,
		Status:      domain.ModuleStatusActive,
	}
	existing.ID = moduleID

	t.Run("not found", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID: uuid.New(),
			CallerID: teacherID,
		})
		assert.Equal(t, domain.ErrModuleNotFound, err)
	})

	t.Run("forbidden if caller is not owner and not admin", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID: moduleID,
			CallerID: otherTeacherID,
			IsAdmin:  false,
		})
		assert.Equal(t, domain.ErrForbidden, err)
	})

	t.Run("fails on empty title update", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		empty := "   "
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID: moduleID,
			CallerID: teacherID,
			Title:    &empty,
		})
		assert.Equal(t, service.ErrTitleRequired, err)
	})

	t.Run("fails on empty description update", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		empty := "   "
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID:    moduleID,
			CallerID:    teacherID,
			Description: &empty,
		})
		assert.Equal(t, service.ErrDescriptionRequired, err)
	})

	t.Run("fails on invalid visibility", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		inv := domain.Visibility("UNKNOWN")
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID:   moduleID,
			CallerID:   teacherID,
			Visibility: &inv,
		})
		assert.Equal(t, domain.ErrInvalidVisibility, err)
	})

	t.Run("fails on invalid status", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		inv := domain.ModuleStatus("UNKNOWN")
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID: moduleID,
			CallerID: teacherID,
			Status:   &inv,
		})
		assert.Equal(t, domain.ErrInvalidStatus, err)
	})

	t.Run("fails on inverted dates", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		start := time.Now().Add(2 * time.Hour)
		end := time.Now().Add(1 * time.Hour)
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID:        moduleID,
			CallerID:        teacherID,
			ActivationStart: service.Patch[time.Time]{Set: true, Value: &start},
			ActivationEnd:   service.Patch[time.Time]{Set: true, Value: &end},
		})
		assert.Equal(t, domain.ErrInvalidDateRange, err)
	})

	t.Run("fails when updating to private with empty classes", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		priv := domain.VisibilityPrivate
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID:   moduleID,
			CallerID:   teacherID,
			Visibility: &priv,
			ClassIDs:   []uuid.UUID{},
		})
		assert.Equal(t, domain.ErrPrivateRequiresClass, err)
	})

	t.Run("fails when updating to private with class not owned by teacher", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		priv := domain.VisibilityPrivate
		_, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID:   moduleID,
			CallerID:   teacherID,
			Visibility: &priv,
			ClassIDs:   []uuid.UUID{classID},
		})
		assert.Equal(t, domain.ErrForbidden, err)
	})

	t.Run("succeeds for admin even with different teacher", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		newTitle := "Updated by Admin"
		active := domain.ModuleStatusInactive
		mod, err := svc.UpdateModule(context.Background(), service.UpdateModuleInput{
			ModuleID: moduleID,
			CallerID: otherTeacherID,
			IsAdmin:  true,
			Title:    &newTitle,
			Status:   &active,
		})
		require.NoError(t, err)
		assert.Equal(t, "Updated by Admin", mod.Title)
		assert.Equal(t, domain.ModuleStatusInactive, mod.Status)
	})
}

func TestService_GetModuleByID(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	teacherID := uuid.New()
	studentID := uuid.New()
	classID := uuid.New()
	moduleID := uuid.New()

	activeMod := domain.CourseModule{
		TeacherID:   teacherID,
		Title:       "Active Public",
		Description: "Desc",
		Visibility:  domain.VisibilityPublic,
		Status:      domain.ModuleStatusActive,
	}
	activeMod.ID = moduleID

	t.Run("returns not found", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		_, err := svc.GetModuleByID(context.Background(), uuid.New(), service.UserAccessContext{})
		assert.Equal(t, domain.ErrModuleNotFound, err)
	})

	t.Run("teacher owner can view inactive or expired module", func(t *testing.T) {
		repo := newMockRepository()
		inactiveMod := activeMod
		inactiveMod.Status = domain.ModuleStatusInactive
		repo.modules[moduleID] = inactiveMod
		repo.details[moduleID] = repository.ModuleDetails{Module: inactiveMod}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		res, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{
			UserID:    &teacherID,
			Role:      "TEACHER",
			IsTeacher: true,
		})
		require.NoError(t, err)
		assert.Equal(t, moduleID, res.Module.ID)
	})

	t.Run("student cannot view inactive module", func(t *testing.T) {
		repo := newMockRepository()
		inactiveMod := activeMod
		inactiveMod.Status = domain.ModuleStatusInactive
		repo.modules[moduleID] = inactiveMod
		repo.details[moduleID] = repository.ModuleDetails{Module: inactiveMod}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		_, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{
			UserID:    &studentID,
			Role:      "STUDENT",
			IsStudent: true,
		})
		assert.Equal(t, domain.ErrModuleInactive, err)
	})

	t.Run("student cannot view expired module", func(t *testing.T) {
		repo := newMockRepository()
		past := now.Add(-1 * time.Hour)
		expiredMod := activeMod
		expiredMod.ActivationEnd = &past
		repo.modules[moduleID] = expiredMod
		repo.details[moduleID] = repository.ModuleDetails{Module: expiredMod}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		_, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{
			UserID:    &studentID,
			Role:      "STUDENT",
			IsStudent: true,
		})
		assert.Equal(t, domain.ErrModuleExpired, err)
	})

	t.Run("anonymous can view active public module", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = activeMod
		repo.details[moduleID] = repository.ModuleDetails{Module: activeMod}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		res, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{})
		require.NoError(t, err)
		assert.Equal(t, moduleID, res.Module.ID)
	})

	t.Run("anonymous cannot view authenticated module", func(t *testing.T) {
		repo := newMockRepository()
		authMod := activeMod
		authMod.Visibility = domain.VisibilityAuthenticated
		repo.modules[moduleID] = authMod
		repo.details[moduleID] = repository.ModuleDetails{Module: authMod}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		_, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{})
		assert.Equal(t, domain.ErrForbidden, err)
	})

	t.Run("student can view authenticated module", func(t *testing.T) {
		repo := newMockRepository()
		authMod := activeMod
		authMod.Visibility = domain.VisibilityAuthenticated
		repo.modules[moduleID] = authMod
		repo.details[moduleID] = repository.ModuleDetails{Module: authMod}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		res, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{
			UserID:    &studentID,
			Role:      "STUDENT",
			IsStudent: true,
		})
		require.NoError(t, err)
		assert.Equal(t, moduleID, res.Module.ID)
	})

	t.Run("student cannot view private module when not enrolled", func(t *testing.T) {
		repo := newMockRepository()
		privMod := activeMod
		privMod.Visibility = domain.VisibilityPrivate
		repo.modules[moduleID] = privMod
		repo.details[moduleID] = repository.ModuleDetails{
			Module:           privMod,
			AssignedClassIDs: []uuid.UUID{classID},
		}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		_, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{
			UserID:    &studentID,
			Role:      "STUDENT",
			IsStudent: true,
		})
		assert.Equal(t, domain.ErrForbidden, err)
	})

	t.Run("student can view private module when enrolled", func(t *testing.T) {
		repo := newMockRepository()
		privMod := activeMod
		privMod.Visibility = domain.VisibilityPrivate
		repo.modules[moduleID] = privMod
		repo.details[moduleID] = repository.ModuleDetails{
			Module:           privMod,
			AssignedClassIDs: []uuid.UUID{classID},
		}
		repo.studentClasses[studentID] = []uuid.UUID{classID}

		svc := service.New(repo)
		svc.SetNow(func() time.Time { return now })

		res, err := svc.GetModuleByID(context.Background(), moduleID, service.UserAccessContext{
			UserID:    &studentID,
			Role:      "STUDENT",
			IsStudent: true,
		})
		require.NoError(t, err)
		assert.Equal(t, moduleID, res.Module.ID)
	})
}

func TestService_ListModules(t *testing.T) {
	teacherID := uuid.New()
	studentID := uuid.New()
	repo := newMockRepository()
	repo.listTeacherRes = repository.ListResult{TotalCount: 3}
	repo.listAllRes = repository.ListResult{TotalCount: 9}
	repo.listStudentRes = repository.ListResult{TotalCount: 2}
	repo.listPublicRes = repository.ListResult{TotalCount: 1}

	svc := service.New(repo)

	t.Run("teacher listing", func(t *testing.T) {
		res, err := svc.ListModules(context.Background(), service.UserAccessContext{
			UserID:    &teacherID,
			Role:      "TEACHER",
			IsTeacher: true,
		}, repository.ListFilter{})
		require.NoError(t, err)
		assert.Equal(t, int64(3), res.TotalCount)
	})

	// SPEC-010: an administrator manages every module, so the listing is not limited to their own.
	t.Run("admin listing sees every module, not only their own", func(t *testing.T) {
		adminID := uuid.New()
		res, err := svc.ListModules(context.Background(), service.UserAccessContext{
			UserID:  &adminID,
			Role:    "ADMIN",
			IsAdmin: true,
		}, repository.ListFilter{})
		require.NoError(t, err)
		assert.Equal(t, int64(9), res.TotalCount)
	})

	t.Run("admin listing does not need a user id", func(t *testing.T) {
		res, err := svc.ListModules(context.Background(), service.UserAccessContext{Role: "ADMIN", IsAdmin: true}, repository.ListFilter{})
		require.NoError(t, err)
		assert.Equal(t, int64(9), res.TotalCount)
	})

	t.Run("teacher listing without user id is forbidden", func(t *testing.T) {
		_, err := svc.ListModules(context.Background(), service.UserAccessContext{
			Role:      "TEACHER",
			IsTeacher: true,
		}, repository.ListFilter{})
		assert.Equal(t, domain.ErrForbidden, err)
	})

	t.Run("student listing", func(t *testing.T) {
		res, err := svc.ListModules(context.Background(), service.UserAccessContext{
			UserID:    &studentID,
			Role:      "STUDENT",
			IsStudent: true,
		}, repository.ListFilter{})
		require.NoError(t, err)
		assert.Equal(t, int64(2), res.TotalCount)
	})

	t.Run("public listing", func(t *testing.T) {
		res, err := svc.ListModules(context.Background(), service.UserAccessContext{}, repository.ListFilter{})
		require.NoError(t, err)
		assert.Equal(t, int64(1), res.TotalCount)
	})

	t.Run("explicit public listing", func(t *testing.T) {
		res, err := svc.ListPublicModules(context.Background(), repository.ListFilter{})
		require.NoError(t, err)
		assert.Equal(t, int64(1), res.TotalCount)
	})
}

func TestService_ReorderExercises(t *testing.T) {
	teacherID := uuid.New()
	otherTeacherID := uuid.New()
	moduleID := uuid.New()
	ex1 := uuid.New()
	ex2 := uuid.New()

	existing := domain.CourseModule{TeacherID: teacherID}
	existing.ID = moduleID

	t.Run("fails on empty sequence", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		err := svc.ReorderExercises(context.Background(), moduleID, teacherID, false, []uuid.UUID{})
		assert.Equal(t, domain.ErrInvalidExerciseSequence, err)
	})

	t.Run("fails on duplicate exercise ids", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		err := svc.ReorderExercises(context.Background(), moduleID, teacherID, false, []uuid.UUID{ex1, ex1})
		assert.Equal(t, domain.ErrDuplicateExerciseOrder, err)
	})

	t.Run("fails when module not found", func(t *testing.T) {
		repo := newMockRepository()
		svc := service.New(repo)
		err := svc.ReorderExercises(context.Background(), moduleID, teacherID, false, []uuid.UUID{ex1, ex2})
		assert.Equal(t, domain.ErrModuleNotFound, err)
	})

	t.Run("fails when caller is not owner and not admin", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		err := svc.ReorderExercises(context.Background(), moduleID, otherTeacherID, false, []uuid.UUID{ex1, ex2})
		assert.Equal(t, domain.ErrForbidden, err)
	})

	t.Run("succeeds when teacher owns the module", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		err := svc.ReorderExercises(context.Background(), moduleID, teacherID, false, []uuid.UUID{ex1, ex2})
		require.NoError(t, err)
		assert.True(t, repo.reorderedCalled)
	})

	t.Run("succeeds for admin", func(t *testing.T) {
		repo := newMockRepository()
		repo.modules[moduleID] = existing
		svc := service.New(repo)
		err := svc.ReorderExercises(context.Background(), moduleID, otherTeacherID, true, []uuid.UUID{ex1, ex2})
		require.NoError(t, err)
	})
}

// Covers SPEC-010: dates of a module can be only a start, only an end, or taken away again, and the
// range is always checked against what is stored when only one end is sent.
func TestService_UpdateModuleDates(t *testing.T) {
	teacherID := uuid.New()
	moduleID := uuid.New()
	base := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	s0, e0 := base, base.Add(24*time.Hour)

	setup := func(start, end *time.Time) (*service.Service, *mockRepository) {
		repo := newMockRepository()
		repo.modules[moduleID] = domain.CourseModule{
			Model: database.Model{ID: moduleID}, TeacherID: teacherID, Title: "T", Description: "D",
			Visibility: domain.VisibilityPublic, Status: domain.ModuleStatusActive, ActivationStart: start, ActivationEnd: end,
		}
		return service.New(repo), repo
	}
	set := func(t time.Time) service.Patch[time.Time] { return service.Patch[time.Time]{Set: true, Value: &t} }
	clear := service.Patch[time.Time]{Set: true}
	update := func(svc *service.Service, in service.UpdateModuleInput) (domain.CourseModule, error) {
		in.ModuleID, in.CallerID = moduleID, teacherID
		return svc.UpdateModule(context.Background(), in)
	}

	t.Run("keeps both dates when the patch is absent", func(t *testing.T) {
		svc, _ := setup(&s0, &e0)
		mod, err := update(svc, service.UpdateModuleInput{})
		require.NoError(t, err)
		assert.Equal(t, &s0, mod.ActivationStart)
		assert.Equal(t, &e0, mod.ActivationEnd)
	})

	t.Run("takes the end away and keeps only the start", func(t *testing.T) {
		svc, repo := setup(&s0, &e0)
		mod, err := update(svc, service.UpdateModuleInput{ActivationEnd: clear})
		require.NoError(t, err)
		assert.Equal(t, &s0, mod.ActivationStart)
		assert.Nil(t, mod.ActivationEnd)
		assert.Nil(t, repo.modules[moduleID].ActivationEnd, "the cleared date is what gets stored")
	})

	t.Run("takes the start away and keeps only the end", func(t *testing.T) {
		svc, _ := setup(&s0, &e0)
		mod, err := update(svc, service.UpdateModuleInput{ActivationStart: clear})
		require.NoError(t, err)
		assert.Nil(t, mod.ActivationStart)
		assert.Equal(t, &e0, mod.ActivationEnd)
	})

	t.Run("sets only a start, or only an end, on a module without dates", func(t *testing.T) {
		svc, _ := setup(nil, nil)
		mod, err := update(svc, service.UpdateModuleInput{ActivationStart: set(s0)})
		require.NoError(t, err)
		assert.Equal(t, &s0, mod.ActivationStart)
		assert.Nil(t, mod.ActivationEnd)

		svc, _ = setup(nil, nil)
		mod, err = update(svc, service.UpdateModuleInput{ActivationEnd: set(e0)})
		require.NoError(t, err)
		assert.Nil(t, mod.ActivationStart)
		assert.Equal(t, &e0, mod.ActivationEnd)
	})

	t.Run("rejects an end before the stored start when only the end is sent", func(t *testing.T) {
		svc, _ := setup(&s0, nil)
		_, err := update(svc, service.UpdateModuleInput{ActivationEnd: set(s0.Add(-time.Minute))})
		assert.ErrorIs(t, err, domain.ErrInvalidDateRange)
	})

	t.Run("rejects a start after the stored end when only the start is sent", func(t *testing.T) {
		svc, _ := setup(nil, &e0)
		_, err := update(svc, service.UpdateModuleInput{ActivationStart: set(e0.Add(time.Minute))})
		assert.ErrorIs(t, err, domain.ErrInvalidDateRange)
	})

	t.Run("rejects both dates sent inverted", func(t *testing.T) {
		svc, _ := setup(nil, nil)
		_, err := update(svc, service.UpdateModuleInput{ActivationStart: set(e0), ActivationEnd: set(s0)})
		assert.ErrorIs(t, err, domain.ErrInvalidDateRange)
	})

	t.Run("accepts the same instant at both ends", func(t *testing.T) {
		svc, _ := setup(nil, nil)
		_, err := update(svc, service.UpdateModuleInput{ActivationStart: set(s0), ActivationEnd: set(s0)})
		assert.NoError(t, err)
	})

	t.Run("an end before the stored start is accepted once the start is taken away in the same request", func(t *testing.T) {
		svc, _ := setup(&e0, nil)
		mod, err := update(svc, service.UpdateModuleInput{ActivationStart: clear, ActivationEnd: set(s0)})
		require.NoError(t, err)
		assert.Nil(t, mod.ActivationStart)
		assert.Equal(t, &s0, mod.ActivationEnd)
	})
}

// Covers SPEC-010 (slug): normalized, validated, unique, and possible to remove.
func TestService_Slug(t *testing.T) {
	teacherID := uuid.New()
	moduleID := uuid.New()
	otherID := uuid.New()
	stored := "historia-do-linux"

	setup := func() (*service.Service, *mockRepository) {
		repo := newMockRepository()
		repo.modules[moduleID] = domain.CourseModule{
			Model: database.Model{ID: moduleID}, TeacherID: teacherID, Title: "T", Description: "D",
			Visibility: domain.VisibilityPublic, Status: domain.ModuleStatusActive, Slug: &stored,
		}
		repo.slugOwners[stored] = moduleID
		repo.slugOwners["pacotes"] = otherID
		return service.New(repo), repo
	}
	slug := func(s string) service.Patch[string] { return service.Patch[string]{Set: true, Value: &s} }
	update := func(svc *service.Service, p service.Patch[string]) (domain.CourseModule, error) {
		return svc.UpdateModule(context.Background(), service.UpdateModuleInput{ModuleID: moduleID, CallerID: teacherID, Slug: p})
	}

	t.Run("keeps the slug when the patch is absent", func(t *testing.T) {
		svc, _ := setup()
		mod, err := update(svc, service.Patch[string]{})
		require.NoError(t, err)
		assert.Equal(t, &stored, mod.Slug)
	})

	t.Run("sets a normalized slug", func(t *testing.T) {
		svc, _ := setup()
		mod, err := update(svc, slug("  Linux-Basico "))
		require.NoError(t, err)
		assert.Equal(t, "linux-basico", *mod.Slug)
	})

	t.Run("accepts its own slug again", func(t *testing.T) {
		svc, _ := setup()
		_, err := update(svc, slug(stored))
		assert.NoError(t, err)
	})

	t.Run("takes the slug away with null or blank", func(t *testing.T) {
		svc, _ := setup()
		mod, err := update(svc, service.Patch[string]{Set: true})
		require.NoError(t, err)
		assert.Nil(t, mod.Slug)

		svc, _ = setup()
		mod, err = update(svc, slug("   "))
		require.NoError(t, err)
		assert.Nil(t, mod.Slug)
	})

	t.Run("rejects a slug with the wrong shape", func(t *testing.T) {
		for _, bad := range []string{"ab", "Meu Módulo!", "-x-", "a--b", "com_underscore"} {
			svc, _ := setup()
			_, err := update(svc, slug(bad))
			assert.ErrorIs(t, err, domain.ErrInvalidSlug, bad)
		}
	})

	t.Run("rejects a slug that another module already uses", func(t *testing.T) {
		svc, _ := setup()
		_, err := update(svc, slug("Pacotes"))
		assert.ErrorIs(t, err, domain.ErrSlugTaken)
	})

	t.Run("a rejected slug does not change the module", func(t *testing.T) {
		svc, repo := setup()
		_, err := update(svc, slug("pacotes"))
		require.Error(t, err)
		assert.Equal(t, &stored, repo.modules[moduleID].Slug)
	})

	t.Run("creates a module with a slug, rejecting the invalid and the taken ones", func(t *testing.T) {
		svc, _ := setup()
		in := service.CreateModuleInput{TeacherID: teacherID, Title: "T", Description: "D", Visibility: domain.VisibilityPublic}
		ok := "Novo-Modulo"
		in.Slug = &ok
		mod, err := svc.CreateModule(context.Background(), in)
		require.NoError(t, err)
		assert.Equal(t, "novo-modulo", *mod.Slug)

		bad := "Nao Pode"
		in.Slug = &bad
		_, err = svc.CreateModule(context.Background(), in)
		assert.ErrorIs(t, err, domain.ErrInvalidSlug)

		taken := "pacotes"
		in.Slug = &taken
		_, err = svc.CreateModule(context.Background(), in)
		assert.ErrorIs(t, err, domain.ErrSlugTaken)

		blank := " "
		in.Slug = &blank
		mod, err = svc.CreateModule(context.Background(), in)
		require.NoError(t, err)
		assert.Nil(t, mod.Slug)
	})
}

func TestReorderModules(t *testing.T) {
	repo := newMockRepository()
	svc := service.New(repo)
	teacherID := uuid.New()
	otherTeacherID := uuid.New()
	modID1 := uuid.New()
	modID2 := uuid.New()

	repo.modules[modID1] = domain.CourseModule{Model: database.Model{ID: modID1}, TeacherID: teacherID}
	repo.modules[modID2] = domain.CourseModule{Model: database.Model{ID: modID2}, TeacherID: teacherID}

	t.Run("allows owner teacher to reorder modules", func(t *testing.T) {
		err := svc.ReorderModules(context.Background(), teacherID, false, []uuid.UUID{modID1, modID2})
		assert.NoError(t, err)
		assert.True(t, repo.reorderedCalled)
	})

	t.Run("prevents non-owner teacher from reordering", func(t *testing.T) {
		err := svc.ReorderModules(context.Background(), otherTeacherID, false, []uuid.UUID{modID1, modID2})
		assert.ErrorIs(t, err, domain.ErrForbidden)
	})

	t.Run("allows admin to reorder modules", func(t *testing.T) {
		err := svc.ReorderModules(context.Background(), otherTeacherID, true, []uuid.UUID{modID1, modID2})
		assert.NoError(t, err)
	})
}
