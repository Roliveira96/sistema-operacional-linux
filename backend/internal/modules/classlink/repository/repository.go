// Package repository persists the links of a class with GORM (SPEC-048).
package repository

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Repository implements service.Repository.
type Repository struct {
	db *database.DB
}

// New creates the repository.
func New(db *database.DB) *Repository { return &Repository{db: db} }

var _ service.Repository = (*Repository)(nil)

type classRow struct {
	ID        uuid.UUID `gorm:"column:id"`
	TeacherID uuid.UUID `gorm:"column:teacher_id"`
	Status    string    `gorm:"column:status"`
}

// FindClass returns the class, or ErrClassNotFound.
func (r *Repository) FindClass(ctx context.Context, id uuid.UUID) (service.ClassInfo, error) {
	var rows []classRow
	if err := r.db.Conn(ctx).Table("classes").Select("id, teacher_id, status").
		Where("id = ? AND deleted_at IS NULL", id).Limit(1).Scan(&rows).Error; err != nil {
		return service.ClassInfo{}, err
	}
	if len(rows) == 0 {
		return service.ClassInfo{}, domain.ErrClassNotFound
	}
	return service.ClassInfo{ID: rows[0].ID, TeacherID: rows[0].TeacherID, Archived: rows[0].Status == "ARCHIVED"}, nil
}

// IsActiveStudent tells whether the user has an ACTIVE enrollment in the class.
func (r *Repository) IsActiveStudent(ctx context.Context, classID, userID uuid.UUID) (bool, error) {
	var n int64
	err := r.db.Conn(ctx).Table("class_enrollments").
		Where("class_id = ? AND user_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL", classID, userID).
		Count(&n).Error
	return n > 0, err
}

// List returns the links of the class, in order.
func (r *Repository) List(ctx context.Context, classID uuid.UUID) ([]domain.ClassLink, error) {
	links := []domain.ClassLink{}
	err := r.db.Conn(ctx).Where("class_id = ?", classID).Order("position").Find(&links).Error
	return links, err
}

// Replace soft deletes the current links and inserts the new ones, in one transaction.
func (r *Repository) Replace(ctx context.Context, classID uuid.UUID, links []domain.ClassLink) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := conn.Where("class_id = ?", classID).Delete(&domain.ClassLink{}).Error; err != nil {
			return err
		}
		for i := range links {
			links[i].ClassID = classID
			if err := conn.Create(&links[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
