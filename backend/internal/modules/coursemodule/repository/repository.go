// Package repository handles persistence for course modules, assignments, and exercises (SPEC-010).
package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ListFilter defines search, status and pagination parameters.
type ListFilter struct {
	Status     string
	Visibility string
	ClassID    *uuid.UUID
	Search     string
	Page       int
	Limit      int
}

// ModuleSummary combines the module entity with computed counters.
type ModuleSummary struct {
	domain.CourseModule
	TotalExercises int64 `gorm:"column:total_exercises"`
	TotalMaterials int64 `gorm:"column:total_materials"`
}

// ModuleDetails contains the full module with associations.
type ModuleDetails struct {
	Module            domain.CourseModule
	AssignedClassIDs  []uuid.UUID
	ExerciseItems     []domain.ModuleExerciseItem
	Materials         []domain.ModuleMaterial
	TotalExercises    int64
	TotalMaterials    int64
}

// ListResult holds paginated results.
type ListResult struct {
	Items      []ModuleSummary
	TotalCount int64
	Page       int
	Limit      int
}

// Repository persists course module data using GORM.
type Repository struct {
	db *database.DB
}

// New creates a new course module repository.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

// CreateModule persists a new module and its optional class assignments within a transaction.
func (r *Repository) CreateModule(ctx context.Context, module *domain.CourseModule, classIDs []uuid.UUID, assignedBy uuid.UUID) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := conn.Create(module).Error; err != nil {
			return err
		}

		for _, classID := range classIDs {
			assignmentID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("generate assignment id: %w", err)
			}
			assignment := domain.ModuleClassAssignment{
				ID:         assignmentID,
				ModuleID:   module.ID,
				ClassID:    classID,
				AssignedBy: assignedBy,
				CreatedAt:  time.Now(),
			}
			if err := conn.Create(&assignment).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// FindModuleByID retrieves a module by its primary UUID.
func (r *Repository) FindModuleByID(ctx context.Context, id uuid.UUID) (domain.CourseModule, error) {
	var m domain.CourseModule
	err := r.db.Conn(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.CourseModule{}, domain.ErrModuleNotFound
	}
	if err != nil {
		return domain.CourseModule{}, err
	}
	return m, nil
}

// FindModuleWithDetails retrieves the module along with assigned classes, exercises, and materials.
func (r *Repository) FindModuleWithDetails(ctx context.Context, id uuid.UUID) (ModuleDetails, error) {
	module, err := r.FindModuleByID(ctx, id)
	if err != nil {
		return ModuleDetails{}, err
	}

	conn := r.db.Conn(ctx)

	// Fetch assigned class IDs
	var classIDs []uuid.UUID
	if err := conn.Model(&domain.ModuleClassAssignment{}).
		Where("module_id = ?", id).
		Pluck("class_id", &classIDs).Error; err != nil {
		return ModuleDetails{}, err
	}

	// Fetch exercises ordered by sequence_order ASC
	var exercises []domain.ModuleExerciseItem
	if err := conn.Where("module_id = ?", id).
		Order("sequence_order ASC").
		Find(&exercises).Error; err != nil {
		return ModuleDetails{}, err
	}

	// Fetch materials
	var materials []domain.ModuleMaterial
	if err := conn.Where("module_id = ? AND deleted_at IS NULL", id).
		Order("created_at ASC").
		Find(&materials).Error; err != nil {
		return ModuleDetails{}, err
	}

	return ModuleDetails{
		Module:           module,
		AssignedClassIDs: classIDs,
		ExerciseItems:    exercises,
		Materials:        materials,
		TotalExercises:   int64(len(exercises)),
		TotalMaterials:   int64(len(materials)),
	}, nil
}

// ListTeacherModules lists modules belonging to the specified teacher.
func (r *Repository) ListTeacherModules(ctx context.Context, teacherID uuid.UUID, filter ListFilter) (ListResult, error) {
	return r.listManaged(ctx, &teacherID, filter)
}

// ListAllModules lists the modules of every teacher: an administrator manages them all.
func (r *Repository) ListAllModules(ctx context.Context, filter ListFilter) (ListResult, error) {
	return r.listManaged(ctx, nil, filter)
}

// listManaged is the administrative listing; a nil teacher means every module.
func (r *Repository) listManaged(ctx context.Context, teacherID *uuid.UUID, filter ListFilter) (ListResult, error) {
	conn := r.db.Conn(ctx)

	query := conn.Model(&domain.CourseModule{}).Where("deleted_at IS NULL")
	if teacherID != nil {
		query = query.Where("teacher_id = ?", *teacherID)
	}

	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Visibility != "" {
		query = query.Where("visibility = ?", filter.Visibility)
	}
	if filter.Search != "" {
		s := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)", s, s)
	}

	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return ListResult{}, err
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	limit := filter.Limit
	if limit < 1 || limit > 50 {
		limit = 10
	}
	offset := (page - 1) * limit

	var items []ModuleSummary
	selectQuery := query.Select(
		"course_modules.*, " +
			"(SELECT COUNT(*) FROM module_exercise_items WHERE module_exercise_items.module_id = course_modules.id) AS total_exercises, " +
			"(SELECT COUNT(*) FROM module_materials WHERE module_materials.module_id = course_modules.id AND module_materials.deleted_at IS NULL) AS total_materials",
	).Order("course_modules.created_at DESC").Limit(limit).Offset(offset)

	if err := selectQuery.Find(&items).Error; err != nil {
		return ListResult{}, err
	}

	return ListResult{
		Items:      items,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
	}, nil
}

// ListPublicModules lists active, unexpired modules with public visibility.
func (r *Repository) ListPublicModules(ctx context.Context, now time.Time, filter ListFilter) (ListResult, error) {
	conn := r.db.Conn(ctx)

	query := conn.Model(&domain.CourseModule{}).
		Where("visibility = ? AND status = ? AND deleted_at IS NULL", domain.VisibilityPublic, domain.ModuleStatusActive).
		Where("(activation_start IS NULL OR activation_start <= ?)", now).
		Where("(activation_end IS NULL OR activation_end >= ?)", now)

	if filter.Search != "" {
		s := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)", s, s)
	}

	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return ListResult{}, err
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	limit := filter.Limit
	if limit < 1 || limit > 50 {
		limit = 10
	}
	offset := (page - 1) * limit

	var items []ModuleSummary
	selectQuery := query.Select(
		"course_modules.*, " +
			"(SELECT COUNT(*) FROM module_exercise_items WHERE module_exercise_items.module_id = course_modules.id) AS total_exercises, " +
			"(SELECT COUNT(*) FROM module_materials WHERE module_materials.module_id = course_modules.id AND module_materials.deleted_at IS NULL) AS total_materials",
	).Order("course_modules.display_order ASC NULLS LAST, course_modules.created_at DESC").Limit(limit).Offset(offset)

	if err := selectQuery.Find(&items).Error; err != nil {
		return ListResult{}, err
	}

	return ListResult{
		Items:      items,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
	}, nil
}

// ListStudentModules lists modules accessible to a student (public, authenticated, or enrolled private).
func (r *Repository) ListStudentModules(ctx context.Context, studentID uuid.UUID, now time.Time, filter ListFilter) (ListResult, error) {
	conn := r.db.Conn(ctx)

	query := conn.Model(&domain.CourseModule{}).
		Where("status = ? AND deleted_at IS NULL", domain.ModuleStatusActive).
		Where("(activation_start IS NULL OR activation_start <= ?)", now).
		Where("(activation_end IS NULL OR activation_end >= ?)", now).
		Where(
			"visibility IN (?, ?) OR (visibility = ? AND id IN ("+
				"SELECT mca.module_id FROM module_class_assignments mca "+
				"JOIN class_enrollments ce ON ce.class_id = mca.class_id "+
				"WHERE ce.user_id = ? AND ce.status = 'ACTIVE' AND ce.deleted_at IS NULL"+
				"))",
			domain.VisibilityPublic, domain.VisibilityAuthenticated, domain.VisibilityPrivate, studentID,
		)

	if filter.Search != "" {
		s := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)", s, s)
	}

	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return ListResult{}, err
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	limit := filter.Limit
	if limit < 1 || limit > 50 {
		limit = 10
	}
	offset := (page - 1) * limit

	var items []ModuleSummary
	selectQuery := query.Select(
		"course_modules.*, " +
			"(SELECT COUNT(*) FROM module_exercise_items WHERE module_exercise_items.module_id = course_modules.id) AS total_exercises, " +
			"(SELECT COUNT(*) FROM module_materials WHERE module_materials.module_id = course_modules.id AND module_materials.deleted_at IS NULL) AS total_materials",
	).Order("course_modules.display_order ASC NULLS LAST, course_modules.created_at DESC").Limit(limit).Offset(offset)

	if err := selectQuery.Find(&items).Error; err != nil {
		return ListResult{}, err
	}

	return ListResult{
		Items:      items,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
	}, nil
}

// UpdateModule updates module metadata and synchronizes class assignments if provided.
func (r *Repository) UpdateModule(ctx context.Context, module *domain.CourseModule, classIDs []uuid.UUID, assignedBy uuid.UUID) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)

		if err := conn.Save(module).Error; err != nil {
			return err
		}

		if classIDs != nil {
			// Delete existing assignments
			if err := conn.Where("module_id = ?", module.ID).Delete(&domain.ModuleClassAssignment{}).Error; err != nil {
				return err
			}

			// Insert new assignments
			for _, classID := range classIDs {
				assignmentID, err := uuid.NewV7()
				if err != nil {
					return fmt.Errorf("generate assignment id: %w", err)
				}
				assignment := domain.ModuleClassAssignment{
					ID:         assignmentID,
					ModuleID:   module.ID,
					ClassID:    classID,
					AssignedBy: assignedBy,
					CreatedAt:  time.Now(),
				}
				if err := conn.Create(&assignment).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// UpdateExerciseOrder atomic batch reorder for module exercises.
func (r *Repository) UpdateExerciseOrder(ctx context.Context, moduleID uuid.UUID, orderedExerciseIDs []uuid.UUID) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)

		// First, check that all exercises belong to this module
		var existingCount int64
		if err := conn.Model(&domain.ModuleExerciseItem{}).
			Where("module_id = ? AND exercise_id IN ?", moduleID, orderedExerciseIDs).
			Count(&existingCount).Error; err != nil {
			return err
		}
		if int(existingCount) != len(orderedExerciseIDs) {
			return domain.ErrInvalidExerciseSequence
		}

		// Stage 1: set temporary sequence orders with high offset to avoid unique constraint violations
		for i, exID := range orderedExerciseIDs {
			tempOrder := 1000000 + i + 1
			if err := conn.Model(&domain.ModuleExerciseItem{}).
				Where("module_id = ? AND exercise_id = ?", moduleID, exID).
				Updates(map[string]interface{}{
					"sequence_order": tempOrder,
					"updated_at":     time.Now(),
				}).Error; err != nil {
				return err
			}
		}

		// Stage 2: assign target positive ordinal sequence
		for i, exID := range orderedExerciseIDs {
			targetOrder := i + 1
			if err := conn.Model(&domain.ModuleExerciseItem{}).
				Where("module_id = ? AND exercise_id = ?", moduleID, exID).
				Updates(map[string]interface{}{
					"sequence_order": targetOrder,
					"updated_at":     time.Now(),
				}).Error; err != nil {
				return err
			}
		}

		return nil
	})
}

// ValidateTeacherClasses checks if all given classes exist and belong to the teacher.
func (r *Repository) ValidateTeacherClasses(ctx context.Context, teacherID uuid.UUID, classIDs []uuid.UUID) (bool, error) {
	if len(classIDs) == 0 {
		return true, nil
	}
	var count int64
	err := r.db.Conn(ctx).Table("classes").
		Where("id IN ? AND teacher_id = ? AND deleted_at IS NULL", classIDs, teacherID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return int(count) == len(classIDs), nil
}

// IsStudentEnrolledInAnyClass checks if a student is actively enrolled in any of the specified classes.
func (r *Repository) IsStudentEnrolledInAnyClass(ctx context.Context, studentID uuid.UUID, classIDs []uuid.UUID) (bool, error) {
	if len(classIDs) == 0 {
		return false, nil
	}
	var count int64
	err := r.db.Conn(ctx).Table("class_enrollments").
		Where("user_id = ? AND class_id IN ? AND status = 'ACTIVE' AND deleted_at IS NULL", studentID, classIDs).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// AddExerciseItem helper to insert an exercise item into a module.
func (r *Repository) AddExerciseItem(ctx context.Context, item *domain.ModuleExerciseItem) error {
	return r.db.Conn(ctx).Create(item).Error
}

// AddMaterial helper to insert a material into a module.
func (r *Repository) AddMaterial(ctx context.Context, material *domain.ModuleMaterial) error {
	return r.db.Conn(ctx).Create(material).Error
}

// FindModuleBySourceKey returns a seeded module, including soft-deleted ones,
// so a module removed by the teacher is not recreated by a reload.
func (r *Repository) FindModuleBySourceKey(ctx context.Context, sourceKey string) (domain.CourseModule, error) {
	var m domain.CourseModule
	err := r.db.Conn(ctx).Unscoped().Where("source_key = ?", sourceKey).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.CourseModule{}, domain.ErrModuleNotFound
	}
	if err != nil {
		return domain.CourseModule{}, err
	}
	if m.DeletedAt.Valid && m.EditedByTeacherAt == nil {
		// A deletion is a teacher decision: treat it as an edit.
		deletedAt := m.DeletedAt.Time
		m.EditedByTeacherAt = &deletedAt
	}
	return m, nil
}

// SaveSeededModule inserts or updates a seeded module.
func (r *Repository) SaveSeededModule(ctx context.Context, module *domain.CourseModule) error {
	return r.db.Conn(ctx).Save(module).Error
}

// ExerciseItemExists reports whether the question is already in the module path.
func (r *Repository) ExerciseItemExists(ctx context.Context, moduleID, exerciseID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Conn(ctx).Model(&domain.ModuleExerciseItem{}).
		Where("module_id = ? AND exercise_id = ?", moduleID, exerciseID).Count(&count).Error
	return count > 0, err
}

// NextExerciseOrder returns the order after the last item of the module path.
func (r *Repository) NextExerciseOrder(ctx context.Context, moduleID uuid.UUID) (int, error) {
	var last *int
	err := r.db.Conn(ctx).Model(&domain.ModuleExerciseItem{}).
		Where("module_id = ?", moduleID).Select("MAX(sequence_order)").Scan(&last).Error
	if err != nil || last == nil {
		return 1, err
	}
	return *last + 1, nil
}
