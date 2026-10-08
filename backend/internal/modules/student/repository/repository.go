// Package repository handles persistence for student profiles, batch CSV onboarding, and listings (SPEC-002).
package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Repository persists student domain data using GORM.
type Repository struct {
	db *database.DB
}

// New creates a new student repository.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

// DB returns the underlying database instance for transaction coordination.
func (r *Repository) DB() *database.DB {
	return r.db
}

// GetProfileByUserID finds the student profile for a specific user ID.
func (r *Repository) GetProfileByUserID(ctx context.Context, userID uuid.UUID) (*domain.StudentProfile, error) {
	var profile domain.StudentProfile
	err := r.db.Conn(ctx).Where("user_id = ?", userID).First(&profile).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

// UpsertProfile inserts or updates a student profile.
func (r *Repository) UpsertProfile(ctx context.Context, p *domain.StudentProfile) error {
	existing, err := r.GetProfileByUserID(ctx, p.UserID)
	if err != nil {
		return err
	}
	if existing == nil {
		return r.db.Conn(ctx).Create(p).Error
	}
	updates := map[string]any{
		"whatsapp":          p.Whatsapp,
		"discord":           p.Discord,
		"avatar_object_key": p.AvatarObjectKey,
	}
	return r.db.Conn(ctx).Model(&domain.StudentProfile{}).Where("user_id = ?", p.UserID).Updates(updates).Error
}

type studentListRow struct {
	ID                   uuid.UUID  `gorm:"column:id"`
	AcademicID           *string    `gorm:"column:academic_id"`
	Email                string     `gorm:"column:email"`
	Name                 *string    `gorm:"column:name"`
	Whatsapp             *string    `gorm:"column:whatsapp"`
	Discord              *string    `gorm:"column:discord"`
	AvatarObjectKey      *string    `gorm:"column:avatar_object_key"`
	TotalClassesEnrolled int64      `gorm:"column:total_classes_enrolled"`
	CreatedAt            time.Time  `gorm:"column:created_at"`
}

// ListStudents returns a paginated list of student users with profile details and enrolled class counts.
func (r *Repository) ListStudents(ctx context.Context, page, perPage int, search string) ([]domain.StudentSummary, int64, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	db := r.db.Conn(ctx).Table("users u").
		Joins("LEFT JOIN student_profiles sp ON sp.user_id = u.id AND sp.deleted_at IS NULL").
		Where("u.role = ? AND u.deleted_at IS NULL", userdomain.RoleStudent)

	if search = strings.TrimSpace(search); search != "" {
		term := "%" + strings.ToLower(search) + "%"
		db = db.Where("(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR u.academic_id LIKE ?)", term, term, "%"+search+"%")
	}

	var totalCount int64
	if err := db.Count(&totalCount).Error; err != nil {
		return nil, 0, fmt.Errorf("count students: %w", err)
	}

	var rows []studentListRow
	selectQuery := `
		u.id,
		u.academic_id,
		u.email,
		u.name,
		sp.whatsapp,
		sp.discord,
		sp.avatar_object_key,
		u.created_at,
		(SELECT COUNT(*) FROM class_enrollments ce WHERE ce.user_id = u.id AND ce.status = 'ACTIVE' AND ce.deleted_at IS NULL) as total_classes_enrolled
	`
	offset := (page - 1) * perPage
	err := db.Select(selectQuery).
		Order("u.created_at DESC").
		Offset(offset).
		Limit(perPage).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, fmt.Errorf("select students: %w", err)
	}

	items := make([]domain.StudentSummary, len(rows))
	for i, row := range rows {
		academicID := ""
		if row.AcademicID != nil {
			academicID = *row.AcademicID
		}
		name := ""
		if row.Name != nil {
			name = *row.Name
		}
		items[i] = domain.StudentSummary{
			ID:                   row.ID,
			AcademicID:           academicID,
			Email:                row.Email,
			Name:                 name,
			Whatsapp:             row.Whatsapp,
			Discord:              row.Discord,
			AvatarURL:            row.AvatarObjectKey,
			TotalClassesEnrolled: row.TotalClassesEnrolled,
			CreatedAt:            row.CreatedAt,
		}
	}

	return items, totalCount, nil
}

// FindUserByAcademicID finds a user by academic_id.
func (r *Repository) FindUserByAcademicID(ctx context.Context, academicID string) (*userdomain.User, error) {
	var u userdomain.User
	err := r.db.Conn(ctx).Where("academic_id = ? AND deleted_at IS NULL", academicID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// FindUserByEmail finds a user by email.
func (r *Repository) FindUserByEmail(ctx context.Context, email string) (*userdomain.User, error) {
	var u userdomain.User
	err := r.db.Conn(ctx).Where("email = ? AND deleted_at IS NULL", email).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// FindClassByID finds a class by ID.
func (r *Repository) FindClassByID(ctx context.Context, classID uuid.UUID) (*classdomain.ClassGroup, error) {
	var c classdomain.ClassGroup
	err := r.db.Conn(ctx).Where("id = ? AND deleted_at IS NULL", classID).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrClassNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindClassByInviteToken finds a class by its invite link token.
func (r *Repository) FindClassByInviteToken(ctx context.Context, token string) (*classdomain.ClassGroup, error) {
	var c classdomain.ClassGroup
	err := r.db.Conn(ctx).Where("invite_link_token = ? AND deleted_at IS NULL", token).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrInviteNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindEnrollment finds an active or pending enrollment for class and student.
func (r *Repository) FindEnrollment(ctx context.Context, classID, userID uuid.UUID) (*classdomain.Enrollment, error) {
	var enr classdomain.Enrollment
	err := r.db.Conn(ctx).Where("class_id = ? AND user_id = ? AND deleted_at IS NULL", classID, userID).First(&enr).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &enr, nil
}

// CreateEnrollment creates a class enrollment entry.
func (r *Repository) CreateEnrollment(ctx context.Context, enrollment *classdomain.Enrollment) error {
	return r.db.Conn(ctx).Create(enrollment).Error
}

// UpdateEnrollment updates an existing enrollment.
func (r *Repository) UpdateEnrollment(ctx context.Context, enrollment *classdomain.Enrollment) error {
	return r.db.Conn(ctx).Save(enrollment).Error
}
