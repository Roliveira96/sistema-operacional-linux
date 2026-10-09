package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// ModuleTeacher returns who created the module (SPEC-019 RN-01).
func (r *Repository) ModuleTeacher(ctx context.Context, moduleID uuid.UUID) (uuid.UUID, error) {
	var row struct{ TeacherID uuid.UUID }
	res := r.db.Conn(ctx).Raw("SELECT teacher_id FROM course_modules WHERE id = ? AND deleted_at IS NULL", moduleID).Scan(&row)
	if res.Error != nil {
		return uuid.Nil, res.Error
	}
	if res.RowsAffected == 0 {
		return uuid.Nil, service.ErrNotFound
	}
	owner := row.TeacherID
	return owner, nil
}

// FindBlock returns a block by id.
func (r *Repository) FindBlock(ctx context.Context, id uuid.UUID) (domain.ContentBlock, error) {
	var b domain.ContentBlock
	err := r.db.Conn(ctx).Where("id = ?", id).First(&b).Error
	return b, notFound(err)
}

// protectModule marks every loaded block of the module as edited after a change of
// structure (insert, delete, reorder). The initial load would otherwise put the
// untouched blocks back at their original positions and collide with the new order.
// updated_at stays as it is, so conflict detection is not disturbed.
func protectModule(conn *gorm.DB, moduleID uuid.UUID, now time.Time) error {
	return conn.Model(&domain.ContentBlock{}).
		Where("module_id = ? AND source_key IS NOT NULL AND edited_by_teacher_at IS NULL", moduleID).
		UpdateColumn("edited_by_teacher_at", now).Error
}

// InsertBlock puts the block after afterID (or at the end), shifting the next ones.
// The position constraint is deferred, so the shift and the insert share one transaction.
func (r *Repository) InsertBlock(ctx context.Context, b *domain.ContentBlock, afterID *uuid.UUID) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		position := 0
		if afterID != nil {
			var after domain.ContentBlock
			if err := conn.Where("id = ? AND module_id = ?", *afterID, b.ModuleID).First(&after).Error; err != nil {
				return notFound(err)
			}
			position = after.Position + 1
			if err := conn.Model(&domain.ContentBlock{}).
				Where("module_id = ? AND position >= ?", b.ModuleID, position).
				UpdateColumn("position", gorm.Expr("position + 1")).Error; err != nil {
				return err
			}
		} else {
			var last int
			if err := conn.Model(&domain.ContentBlock{}).Where("module_id = ?", b.ModuleID).
				Select("COALESCE(MAX(position), 0)").Scan(&last).Error; err != nil {
				return err
			}
			position = last + 1
		}
		b.Position = position
		if err := conn.Create(b).Error; err != nil {
			return err
		}
		return protectModule(conn, b.ModuleID, b.UpdatedAt)
	})
}

// UpdateBlock replaces the payload; expected guards against a concurrent change.
func (r *Repository) UpdateBlock(ctx context.Context, id uuid.UUID, payload json.RawMessage, expected *time.Time, now time.Time) (domain.ContentBlock, error) {
	q := r.db.Conn(ctx).Model(&domain.ContentBlock{}).Where("id = ?", id)
	if expected != nil {
		q = q.Where("updated_at = ?", expected.UTC())
	}
	res := q.Updates(map[string]any{"payload": payload, "edited_by_teacher_at": now, "updated_at": now})
	if res.Error != nil {
		return domain.ContentBlock{}, res.Error
	}
	if res.RowsAffected == 0 {
		// Either the block is gone or somebody changed it first.
		if _, err := r.FindBlock(ctx, id); err != nil {
			return domain.ContentBlock{}, err
		}
		return domain.ContentBlock{}, service.ErrBlockConflict
	}
	return r.FindBlock(ctx, id)
}

// DeleteBlock removes the block and renumbers the next ones. Reading progress
// goes with it (ON DELETE CASCADE).
func (r *Repository) DeleteBlock(ctx context.Context, b domain.ContentBlock) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		if err := conn.Delete(&domain.ContentBlock{}, "id = ?", b.ID).Error; err != nil {
			return err
		}
		if err := conn.Model(&domain.ContentBlock{}).
			Where("module_id = ? AND position > ?", b.ModuleID, b.Position).
			UpdateColumn("position", gorm.Expr("position - 1")).Error; err != nil {
			return err
		}
		return protectModule(conn, b.ModuleID, time.Now().UTC())
	})
}

// ReorderBlocks writes the positions 1..N in one transaction.
func (r *Repository) ReorderBlocks(ctx context.Context, moduleID uuid.UUID, ids []uuid.UUID, now time.Time) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		for i, id := range ids {
			err := conn.Model(&domain.ContentBlock{}).
				Where("id = ? AND module_id = ? AND position <> ?", id, moduleID, i+1).
				Updates(map[string]any{"position": i + 1, "edited_by_teacher_at": now, "updated_at": now}).Error
			if err != nil {
				return err
			}
		}
		return protectModule(conn, moduleID, now)
	})
}
