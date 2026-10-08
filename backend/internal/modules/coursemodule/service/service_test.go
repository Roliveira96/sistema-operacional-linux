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
	listPublicRes   repository.ListResult
	listStudentRes  repository.ListResult
	reorderedCalled bool
}

func newMockRepository() *mockRepository {
	return &mockRepository{
		modules:        make(map[uuid.UUID]domain.CourseModule),
		details:        make(map[uuid.UUID]repository.ModuleDetails),
		teacherClasses: make(map[uuid.UUID][]uuid.UUID),
		studentClasses: make(map[uuid.UUID][]uuid.UUID),
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
			ActivationStart: &start,
			ActivationEnd:   &end,
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
