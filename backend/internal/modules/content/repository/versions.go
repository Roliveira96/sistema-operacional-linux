package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// draftSQL builds the content of the draft: the blocks in order and the snapshot of the module.
// It is the same expression the migration 00013 uses for the first versions.
const draftSQL = `SELECT jsonb_build_object(
    'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'type', b.block_type, 'position', b.position,
                                                            'payload', b.payload, 'active', b.inactive_at IS NULL)
                                         ORDER BY b.position)
                        FROM content_blocks b WHERE b.module_id = m.id), '[]'::jsonb),
    'setup', m.setup)::text AS content
FROM course_modules m WHERE m.id = ?`

// draft returns the content of the draft as jsonb text, and its hash.
func (r *Repository) draft(ctx context.Context, moduleID uuid.UUID) (content, hash string, err error) {
	var row struct{ Content, Hash string }
	res := r.db.Conn(ctx).Raw("SELECT d.content, encode(sha256(convert_to(d.content, 'UTF8')), 'hex') AS hash FROM ("+draftSQL+") d", moduleID).Scan(&row)
	if res.Error != nil {
		return "", "", res.Error
	}
	if res.RowsAffected == 0 {
		return "", "", service.ErrNotFound
	}
	return row.Content, row.Hash, nil
}

// LatestVersion returns the version students read.
func (r *Repository) LatestVersion(ctx context.Context, moduleID uuid.UUID) (domain.ModuleVersion, error) {
	var v domain.ModuleVersion
	res := r.db.Conn(ctx).Where("module_id = ?", moduleID).Order("number DESC").Limit(1).Find(&v)
	if res.Error != nil {
		return v, res.Error
	}
	if res.RowsAffected == 0 {
		return v, service.ErrNotFound
	}
	return v, nil
}

// FindVersion returns one version of the module.
func (r *Repository) FindVersion(ctx context.Context, moduleID uuid.UUID, number int) (domain.ModuleVersion, error) {
	var v domain.ModuleVersion
	res := r.db.Conn(ctx).Where("module_id = ? AND number = ?", moduleID, number).Limit(1).Find(&v)
	if res.Error != nil {
		return v, res.Error
	}
	if res.RowsAffected == 0 {
		return v, service.ErrNotFound
	}
	return v, nil
}

// ListVersions returns the versions, the newest first, and whether the draft differs from the latest.
func (r *Repository) ListVersions(ctx context.Context, moduleID uuid.UUID) ([]service.VersionSummary, bool, error) {
	var out []service.VersionSummary
	err := r.db.Conn(ctx).Raw(`SELECT v.number, v.note, v.created_at, COALESCE(NULLIF(u.name, ''), u.email, '') AS created_by,
        jsonb_array_length(v.content->'blocks') AS block_count
        FROM module_versions v LEFT JOIN users u ON u.id = v.created_by
        WHERE v.module_id = ? ORDER BY v.number DESC`, moduleID).Scan(&out).Error
	if err != nil {
		return nil, false, err
	}
	_, hash, err := r.draft(ctx, moduleID)
	if err != nil {
		return nil, false, err
	}
	latest, err := r.LatestVersion(ctx, moduleID)
	if err != nil {
		return nil, false, err
	}
	return out, latest.ContentHash != hash, nil
}

// PublishVersion stores the draft as the next version, or returns service.ErrNoChanges.
func (r *Repository) PublishVersion(ctx context.Context, moduleID, by uuid.UUID, note string) (domain.ModuleVersion, error) {
	var published domain.ModuleVersion
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		content, hash, err := r.draft(ctx, moduleID)
		if err != nil {
			return err
		}
		next := 1
		latest, err := r.LatestVersion(ctx, moduleID)
		switch {
		case err == nil:
			if latest.ContentHash == hash {
				return service.ErrNoChanges
			}
			next = latest.Number + 1
		case !errors.Is(err, service.ErrNotFound):
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		published = domain.ModuleVersion{ID: id, ModuleID: moduleID, Number: next, Note: note, Content: json.RawMessage(content), ContentHash: hash, CreatedBy: &by, CreatedAt: time.Now().UTC()}
		return r.db.Conn(ctx).Create(&published).Error
	})
	return published, err
}

// RestoreVersion copies a version into the draft keeping the identity of the blocks that exist in both
// (so their reading progress stays), recreating the ones only the version has and removing the rest (RN-07).
func (r *Repository) RestoreVersion(ctx context.Context, moduleID uuid.UUID, number int, now time.Time) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		v, err := r.FindVersion(ctx, moduleID, number)
		if err != nil {
			return err
		}
		var content domain.VersionContent
		if err := json.Unmarshal(v.Content, &content); err != nil {
			return err
		}
		conn := r.db.Conn(ctx)
		ids := make([]uuid.UUID, 0, len(content.Blocks))
		for _, b := range content.Blocks {
			ids = append(ids, b.ID)
		}
		del := conn.Where("module_id = ?", moduleID)
		if len(ids) > 0 {
			del = del.Where("id NOT IN ?", ids)
		}
		if err := del.Delete(&domain.ContentBlock{}).Error; err != nil {
			return err
		}
		for _, b := range content.Blocks {
			var inactive *time.Time
			if !b.Active {
				inactive = &now
			}
			// The position constraint is deferred, so blocks can swap places inside this transaction.
			err := conn.Exec(`INSERT INTO content_blocks (id, module_id, block_type, position, payload, inactive_at, edited_by_teacher_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET block_type = EXCLUDED.block_type, position = EXCLUDED.position, payload = EXCLUDED.payload,
                    inactive_at = EXCLUDED.inactive_at, edited_by_teacher_at = EXCLUDED.edited_by_teacher_at, updated_at = EXCLUDED.updated_at
                WHERE content_blocks.module_id = EXCLUDED.module_id`,
				b.ID, moduleID, string(b.Type), b.Position, string(b.Payload), inactive, now, now, now).Error
			if err != nil {
				return err
			}
		}
		var setup any
		if s := content.SetupOrNil(); s != nil {
			setup = string(s)
		}
		return conn.Exec("UPDATE course_modules SET setup = ?::jsonb WHERE id = ?", setup, moduleID).Error
	})
}
