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
	"gorm.io/gorm/clause"

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
		// The service sets the author (SPEC-049 RN-01); a class saved without one is authored by its teacher.
		if class.CreatedBy == uuid.Nil {
			class.CreatedBy = class.TeacherID
		}
		if class.UpdatedBy == uuid.Nil {
			class.UpdatedBy = class.TeacherID
		}
		if err := conn.Create(class).Error; err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
				return domain.ErrClassConflict
			}
			return err
		}

		enrollments := make([]domain.Enrollment, 0, len(initialStudentIDs))
		for _, studentID := range initialStudentIDs {
			enrollments = append(enrollments, domain.Enrollment{
				ClassID:     class.ID,
				UserID:      studentID,
				Status:      domain.EnrollmentActive,
				Origin:      domain.OriginDirectByTeacher,
				RequestedAt: now,
				DecidedAt:   &now,
			})
		}
		// A repeated initial student is skipped by the database, never by catching the error: in PostgreSQL an
		// error aborts the transaction (SPEC-041 RN-06, D-08).
		return insertEnrollmentsSkippingDuplicates(conn, enrollments)
	})
}

// insertEnrollmentsSkippingDuplicates inserts each enrollment, leaving out those whose class and user already have one.
func insertEnrollmentsSkippingDuplicates(conn *gorm.DB, enrollments []domain.Enrollment) error {
	for i := range enrollments {
		err := conn.Clauses(clause.OnConflict{
			Columns:     []clause.Column{{Name: "class_id"}, {Name: "user_id"}},
			TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "deleted_at IS NULL"}}},
			DoNothing:   true,
		}).Create(&enrollments[i]).Error
		if err != nil {
			return err
		}
	}
	return nil
}

// SaveEnrollments writes a batch of new and changed enrollments in one transaction (SPEC-041 RN-06).
// A new enrollment whose class and user already have one is left out.
func (r *Repository) SaveEnrollments(ctx context.Context, created, updated []domain.Enrollment) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := insertEnrollmentsSkippingDuplicates(conn, created); err != nil {
			return err
		}
		for i := range updated {
			if err := conn.Save(&updated[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// FindUserRoles returns the role of each existing user among ids; missing or removed users are left out (SPEC-041 RN-05).
func (r *Repository) FindUserRoles(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	roles := make(map[uuid.UUID]string, len(ids))
	if len(ids) == 0 {
		return roles, nil
	}
	var rows []struct {
		ID   uuid.UUID `gorm:"column:id"`
		Role string    `gorm:"column:role"`
	}
	if err := r.db.Conn(ctx).Table("users").Select("id, role").
		Where("id IN ? AND deleted_at IS NULL", ids).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		roles[row.ID] = row.Role
	}
	return roles, nil
}

// ListEnrollmentsByUsers returns the enrollments of the given users in the class.
func (r *Repository) ListEnrollmentsByUsers(ctx context.Context, classID uuid.UUID, userIDs []uuid.UUID) ([]domain.Enrollment, error) {
	var enrollments []domain.Enrollment
	if len(userIDs) == 0 {
		return enrollments, nil
	}
	err := r.db.Conn(ctx).Where("class_id = ? AND user_id IN ? AND deleted_at IS NULL", classID, userIDs).Find(&enrollments).Error
	return enrollments, err
}

// FindUserName returns the display name of a user, or nil when the user has none or does not exist.
func (r *Repository) FindUserName(ctx context.Context, id uuid.UUID) (*string, error) {
	var rows []struct {
		Name *string `gorm:"column:name"`
	}
	if err := r.db.Conn(ctx).Table("users").Select("name").
		Where("id = ? AND deleted_at IS NULL", id).Limit(1).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0].Name, nil
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

// MyClass is the minimal view of a class for its teacher or an enrolled student (SPEC-026).
// It intentionally carries no member data and no invite token.
type MyClass struct {
	ID               uuid.UUID `gorm:"column:id"`
	Name             string    `gorm:"column:name"`
	CourseCode       string    `gorm:"column:course_code"`
	Semester         string    `gorm:"column:semester"`
	StartDate        time.Time `gorm:"column:start_date"`
	Relation         string    `gorm:"-"`
	EnrollmentStatus *string   `gorm:"column:enrollment_status"`
}

// MyClassesResult holds at most limit classes and the real total.
type MyClassesResult struct {
	Items []MyClass
	Total int64
}

// ListTeacherClassesForMenu returns the non-archived classes owned by the teacher,
// newest start date first, capped at limit, with the real total.
func (r *Repository) ListTeacherClassesForMenu(ctx context.Context, teacherID uuid.UUID, limit int) (MyClassesResult, error) {
	query := r.db.Conn(ctx).Table("classes").
		Where("classes.teacher_id = ? AND classes.deleted_at IS NULL AND classes.status <> ?", teacherID, domain.ClassStatusArchived)
	return scanMyClasses(query, domain.RelationTeacher, limit)
}

// ListStudentClassesForMenu returns the classes where the student has an ACTIVE or
// PENDING_MODERATION enrollment, newest start date first, capped at limit, with the real total.
func (r *Repository) ListStudentClassesForMenu(ctx context.Context, studentID uuid.UUID, limit int) (MyClassesResult, error) {
	query := r.db.Conn(ctx).Table("classes").
		Joins("INNER JOIN class_enrollments ce ON ce.class_id = classes.id AND ce.deleted_at IS NULL").
		Where("ce.user_id = ? AND ce.status IN ? AND classes.deleted_at IS NULL",
			studentID, []domain.EnrollmentStatus{domain.EnrollmentActive, domain.EnrollmentPendingModeration})
	return scanMyClasses(query, domain.RelationStudent, limit)
}

func scanMyClasses(query *gorm.DB, relation string, limit int) (MyClassesResult, error) {
	query = query.Session(&gorm.Session{}) // makes the base query safely reusable for Count and Scan
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return MyClassesResult{}, err
	}

	selectCols := "classes.id, classes.name, classes.course_code, classes.semester, classes.start_date"
	if relation == domain.RelationStudent {
		selectCols += ", ce.status AS enrollment_status"
	}
	var items []MyClass
	if err := query.Select(selectCols).
		Order("classes.start_date DESC, classes.id ASC").Limit(limit).Scan(&items).Error; err != nil {
		return MyClassesResult{}, err
	}
	for i := range items {
		items[i].Relation = relation
	}
	return MyClassesResult{Items: items, Total: total}, nil
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

// DeleteClass soft deletes the class and records who did it, in one transaction (SPEC-050 RN-03). The enrollments and the other
// records of the class stay as they are.
func (r *Repository) DeleteClass(ctx context.Context, class *domain.ClassGroup, actorID uuid.UUID) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := conn.Model(&domain.ClassGroup{}).Where("id = ?", class.ID).Update("deleted_by", actorID).Error; err != nil {
			return err
		}
		return conn.Delete(&domain.ClassGroup{}, "id = ?", class.ID).Error
	})
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
