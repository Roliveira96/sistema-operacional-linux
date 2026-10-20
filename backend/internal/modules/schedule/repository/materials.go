package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// The materials of a lesson (SPEC-074).

// ListMaterials returns, in one reading, the materials not deleted of the lessons, each lesson's in the order of the teacher.
func (r *Repository) ListMaterials(ctx context.Context, sessionIDs []uuid.UUID) (map[uuid.UUID][]domain.ClassSessionMaterial, error) {
	out := map[uuid.UUID][]domain.ClassSessionMaterial{}
	if len(sessionIDs) == 0 {
		return out, nil
	}
	var rows []domain.ClassSessionMaterial
	if err := r.db.Conn(ctx).Where("session_id IN ?", sessionIDs).Order("session_id, position, created_at").Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, m := range rows {
		out[m.SessionID] = append(out[m.SessionID], m)
	}
	return out, nil
}

// FindMaterial returns a material that is not deleted.
func (r *Repository) FindMaterial(ctx context.Context, id uuid.UUID) (domain.ClassSessionMaterial, error) {
	var m domain.ClassSessionMaterial
	err := r.db.Conn(ctx).Where("id = ?", id).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.ClassSessionMaterial{}, domain.ErrMaterialNotFound
	}
	return m, err
}

// CreateMaterial saves a new material.
func (r *Repository) CreateMaterial(ctx context.Context, m *domain.ClassSessionMaterial) error {
	return r.db.Conn(ctx).Create(m).Error
}

// SaveMaterials updates what the teacher may change in the materials (title, kind, phase, release and position) in one transaction. The source
// of a material never changes, so it is not written.
func (r *Repository) SaveMaterials(ctx context.Context, list []domain.ClassSessionMaterial) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		for _, m := range list {
			err := conn.Model(&domain.ClassSessionMaterial{}).Where("id = ?", m.ID).Updates(map[string]any{
				"title": m.Title, "kind": m.Kind, "visibility": m.Visibility, "release_at": m.ReleaseAt, "position": m.Position,
			}).Error
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteMaterial removes a material (soft delete): the object stays in the bucket (SPEC-074 RN-06).
func (r *Repository) DeleteMaterial(ctx context.Context, id uuid.UUID) error {
	return r.db.Conn(ctx).Where("id = ?", id).Delete(&domain.ClassSessionMaterial{}).Error
}

// SetHasContent sets the flag of content of a lesson and nothing else of it.
func (r *Repository) SetHasContent(ctx context.Context, sessionID uuid.UUID, has bool) error {
	return r.db.Conn(ctx).Model(&domain.ClassSession{}).Where("id = ?", sessionID).UpdateColumn("has_content", has).Error
}
