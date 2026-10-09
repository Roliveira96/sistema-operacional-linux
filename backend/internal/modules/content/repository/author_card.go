package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// sameJSON reports whether two payloads hold the same document, whatever their spacing.
func sameJSON(a, b []byte) bool {
	var x, y bytes.Buffer
	if json.Compact(&x, a) != nil || json.Compact(&y, b) != nil {
		return false
	}
	return bytes.Equal(x.Bytes(), y.Bytes())
}

// ReplaceCard applies a whole card (SPEC-019 RN-13): blocks of the card that are not in the new
// list are deleted (with their reading progress), the ones that stay keep their identity and are
// updated or moved, the new ones are inserted, and the blocks after the card are shifted.
func (r *Repository) ReplaceCard(ctx context.Context, in service.ReplaceCardInput) ([]domain.ContentBlock, error) {
	var result []domain.ContentBlock
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)

		var old []domain.ContentBlock
		if len(in.ReplaceIDs) > 0 {
			if err := conn.Where("module_id = ? AND id IN ?", in.ModuleID, in.ReplaceIDs).Order("position").Find(&old).Error; err != nil {
				return err
			}
		}
		oldByID := make(map[uuid.UUID]domain.ContentBlock, len(old))
		for _, b := range old {
			oldByID[b.ID] = b
		}

		// Where the card starts and the last position it takes today.
		var start, end int
		switch {
		case len(old) > 0:
			start, end = old[0].Position, old[len(old)-1].Position
		case in.AfterID != nil:
			var after domain.ContentBlock
			if err := conn.Where("id = ? AND module_id = ?", *in.AfterID, in.ModuleID).First(&after).Error; err != nil {
				return notFound(err)
			}
			start, end = after.Position+1, after.Position
		default:
			var last int
			if err := conn.Model(&domain.ContentBlock{}).Where("module_id = ?", in.ModuleID).
				Select("COALESCE(MAX(position), 0)").Scan(&last).Error; err != nil {
				return err
			}
			start, end = last+1, last
		}

		kept := make(map[uuid.UUID]bool, len(in.Entries))
		for _, e := range in.Entries {
			if e.ID != nil {
				kept[*e.ID] = true
			}
		}
		for _, b := range old {
			if !kept[b.ID] {
				if err := conn.Delete(&domain.ContentBlock{}, "id = ?", b.ID).Error; err != nil {
					return err
				}
			}
		}

		// The blocks after the card move by how much the card grew or shrank.
		if delta := len(in.Entries) - len(old); delta != 0 {
			if err := conn.Model(&domain.ContentBlock{}).
				Where("module_id = ? AND position > ?", in.ModuleID, end).
				UpdateColumn("position", gorm.Expr("position + ?", delta)).Error; err != nil {
				return err
			}
		}

		result = make([]domain.ContentBlock, 0, len(in.Entries))
		for i, e := range in.Entries {
			position := start + i
			if e.ID == nil {
				b := domain.ContentBlock{ID: uuid.New(), ModuleID: in.ModuleID, BlockType: e.Type, Position: position,
					Payload: e.Payload, EditedByTeacherAt: &in.Now, CreatedAt: in.Now, UpdatedAt: in.Now}
				if err := conn.Create(&b).Error; err != nil {
					return err
				}
				result = append(result, b)
				continue
			}

			prev := oldByID[*e.ID]
			if sameJSON(prev.Payload, e.Payload) {
				// The content did not change: only its place, so nobody gets a conflict for nothing.
				if prev.Position != position {
					if err := conn.Model(&domain.ContentBlock{}).Where("id = ?", prev.ID).UpdateColumn("position", position).Error; err != nil {
						return err
					}
					prev.Position = position
				}
				result = append(result, prev)
				continue
			}

			q := conn.Model(&domain.ContentBlock{}).Where("id = ?", prev.ID)
			if e.ExpectedUpdatedAt != nil {
				q = q.Where("updated_at = ?", e.ExpectedUpdatedAt.UTC())
			}
			res := q.Updates(map[string]any{"payload": e.Payload, "position": position, "edited_by_teacher_at": in.Now, "updated_at": in.Now})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				return service.ErrBlockConflict
			}
			prev.Payload, prev.Position, prev.UpdatedAt, prev.EditedByTeacherAt = e.Payload, position, in.Now, &in.Now
			result = append(result, prev)
		}
		return protectModule(conn, in.ModuleID, in.Now)
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// SetActiveMany inactivates or reactivates blocks of one module and marks them as edited.
func (r *Repository) SetActiveMany(ctx context.Context, moduleID uuid.UUID, ids []uuid.UUID, active bool, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	var inactiveAt any
	if !active {
		inactiveAt = now
	}
	return r.db.Conn(ctx).Model(&domain.ContentBlock{}).Where("module_id = ? AND id IN ?", moduleID, ids).
		UpdateColumns(map[string]any{"inactive_at": inactiveAt, "edited_by_teacher_at": now}).Error
}
