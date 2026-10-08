// Package repository persists classes and enrollments using GORM (SPEC-009).
package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

const uniqueViolation = "23505"

// ListFilter specifies query filters for class listing.
type ListFilter struct {
	Status string
	Search string
	Page   int
	Limit  int
}

// ClassSummary combines the class entity with member counters.
type ClassSummary struct {
	Class                  domain.ClassGroup
	TotalActiveStudents    int64
	TotalPendingRequests   int64
}

// ListResult holds paginated class results.
type ListResult struct {
	Items      []ClassSummary
	TotalCount int64
	Page       int
	Limit      int
}

// EnrollmentWithUser combines enrollment and student information.
type EnrollmentWithUser struct {
	domain.Enrollment
	UserName       *string `gorm:"column:user_name"`
	UserEmail      string  `gorm:"column:user_email"`
	UserAcademicID *string `gorm:"column:user_academic_id"`
}

// Repository handles database persistence for the classgroup module.
type Repository struct {
	db *database.DB
}

// New creates a new classgroup repository.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

// CreateClass creates a new class and optionally enrolls initial students.
func (r *Repository) CreateClass(ctx context.Context, class *domain.ClassGroup, initialStudentIDs []uuid.UUID, now time.Time) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := conn.Create(class).Error; err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
				return domain.ErrClassConflict
			}
			return err
		}

		for _, studentID := range initialStudentIDs {
			enrollment := domain.Enrollment{
				ClassID:     class.ID,
				UserID:      studentID,
				Status:      domain.EnrollmentActive,
				Origin:      domain.OriginDirectByTeacher,
				RequestedAt: now,
				DecidedAt:   &now,
			}
			if err := conn.Create(&enrollment).Error; err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
					continue // Ignore duplicate initial enrollment
				}
				return err
			}
		}
		return nil
	})
}

// FindClassByID retrieves a class by its UUID.
func (r *Repository) FindClassByID(ctx context.Context, id uuid.UUID) (domain.ClassGroup, error) {
	var c domain.ClassGroup
	err := r.db.Conn(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.ClassGroup{}, domain.ErrClassNotFound
	}
	return c, err
}

// FindClassByInviteToken finds an active class by its invite link token.
func (r *Repository) FindClassByInviteToken(ctx context.Context, token string) (domain.ClassGroup, error) {
	var c domain.ClassGroup
	err := r.db.Conn(ctx).Where("invite_link_token = ? AND deleted_at IS NULL", token).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.ClassGroup{}, domain.ErrClassNotFound
	}
	return c, err
}

// ListClassesByTeacher returns paginated classes for a teacher with member counters.
func (r *Repository) ListClassesByTeacher(ctx context.Context, teacherID uuid.UUID, filter ListFilter) (ListResult, error) {
	conn := r.db.Conn(ctx)

	query := conn.Model(&domain.ClassGroup{}).Where("teacher_id = ? AND deleted_at IS NULL", teacherID)

	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Search != "" {
		searchTerm := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("(LOWER(name) LIKE ? OR LOWER(course_code) LIKE ?)", searchTerm, searchTerm)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return ListResult{}, err
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	limit := filter.Limit
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var classes []domain.ClassGroup
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&classes).Error; err != nil {
		return ListResult{}, err
	}

	items := make([]ClassSummary, len(classes))
	for i, c := range classes {
		var activeCount int64
		var pendingCount int64

		_ = conn.Model(&domain.Enrollment{}).
			Where("class_id = ? AND status = ? AND deleted_at IS NULL", c.ID, domain.EnrollmentActive).
			Count(&activeCount).Error

		_ = conn.Model(&domain.Enrollment{}).
			Where("class_id = ? AND status = ? AND deleted_at IS NULL", c.ID, domain.EnrollmentPendingModeration).
			Count(&pendingCount).Error

		items[i] = ClassSummary{
			Class:                c,
			TotalActiveStudents:  activeCount,
			TotalPendingRequests: pendingCount,
		}
	}

	return ListResult{
		Items:      items,
		TotalCount: total,
		Page:       page,
		Limit:      limit,
	}, nil
}

// UpdateClass updates class details.
func (r *Repository) UpdateClass(ctx context.Context, class *domain.ClassGroup) error {
	err := r.db.Conn(ctx).Save(class).Error
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return domain.ErrClassConflict
	}
	return err
}

// CreateEnrollment inserts a student enrollment record.
func (r *Repository) CreateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error {
	err := r.db.Conn(ctx).Create(enrollment).Error
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return domain.ErrAlreadyEnrolled
	}
	return err
}

// FindEnrollment retrieves an enrollment by class ID and user ID.
func (r *Repository) FindEnrollment(ctx context.Context, classID, userID uuid.UUID) (domain.Enrollment, error) {
	var e domain.Enrollment
	err := r.db.Conn(ctx).Where("class_id = ? AND user_id = ? AND deleted_at IS NULL", classID, userID).First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Enrollment{}, domain.ErrEnrollmentNotFound
	}
	return e, err
}

// FindEnrollmentByID retrieves an enrollment by its ID.
func (r *Repository) FindEnrollmentByID(ctx context.Context, id uuid.UUID) (domain.Enrollment, error) {
	var e domain.Enrollment
	err := r.db.Conn(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Enrollment{}, domain.ErrEnrollmentNotFound
	}
	return e, err
}

// ListEnrollmentsByClass lists members of a class optionally filtered by status, joining with user data.
func (r *Repository) ListEnrollmentsByClass(ctx context.Context, classID uuid.UUID, status string) ([]EnrollmentWithUser, error) {
	query := r.db.Conn(ctx).
		Table("class_enrollments").
		Select("class_enrollments.*, users.name as user_name, users.email as user_email, users.academic_id as user_academic_id").
		Joins("INNER JOIN users ON users.id = class_enrollments.user_id").
		Where("class_enrollments.class_id = ? AND class_enrollments.deleted_at IS NULL", classID)

	if status != "" {
		query = query.Where("class_enrollments.status = ?", status)
	}

	var results []EnrollmentWithUser
	if err := query.Order("class_enrollments.requested_at ASC").Scan(&results).Error; err != nil {
		return nil, err
	}
	return results, nil
}

// UpdateEnrollment updates status and deliberation details.
func (r *Repository) UpdateEnrollment(ctx context.Context, enrollment *domain.Enrollment) error {
	return r.db.Conn(ctx).Save(enrollment).Error
}
