package repository

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ListNoteBlocks returns the active note blocks of the student in the room, ordered chronologically (SPEC-071 RN-02).
func (r *Repository) ListNoteBlocks(ctx context.Context, sessionID, studentID uuid.UUID) ([]domain.LiveClassroomNoteBlock, error) {
	blocks := []domain.LiveClassroomNoteBlock{}
	err := r.db.Conn(ctx).
		Where("session_id = ? AND student_id = ?", sessionID, studentID).
		Order("created_at ASC, id ASC").
		Find(&blocks).Error
	return blocks, err
}

// CreateNoteBlock inserts a new atomic note block (SPEC-071 RN-02).
func (r *Repository) CreateNoteBlock(ctx context.Context, b *domain.LiveClassroomNoteBlock) error {
	return r.db.Conn(ctx).Create(b).Error
}

// FindNoteBlock returns a note block by ID, or ErrNoteBlockNotFound.
func (r *Repository) FindNoteBlock(ctx context.Context, id uuid.UUID) (domain.LiveClassroomNoteBlock, error) {
	var b domain.LiveClassroomNoteBlock
	err := r.db.Conn(ctx).First(&b, "id = ?", id).Error
	return b, notFound(err, domain.ErrNoteBlockNotFound)
}

// SaveNoteBlock updates an existing note block (SPEC-071 RN-03).
func (r *Repository) SaveNoteBlock(ctx context.Context, b *domain.LiveClassroomNoteBlock) error {
	return r.db.Conn(ctx).Save(b).Error
}

// DeleteNoteBlock soft-deletes a note block and revokes all private note images associated with it (SPEC-071 RN-04).
func (r *Repository) DeleteNoteBlock(ctx context.Context, id uuid.UUID, now time.Time) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := conn.Model(&domain.LiveClassroomNoteImage{}).
			Where("note_block_id = ? AND deleted_at IS NULL", id).
			Updates(map[string]any{"deleted_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		res := conn.Model(&domain.LiveClassroomNoteBlock{}).
			Where("id = ? AND deleted_at IS NULL", id).
			Updates(map[string]any{"deleted_at": now, "updated_at": now})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return domain.ErrNoteBlockNotFound
		}
		return nil
	})
}

// CreateNoteImage inserts the metadata of a private note image uploaded by the student (SPEC-071 RN-05).
func (r *Repository) CreateNoteImage(ctx context.Context, img *domain.LiveClassroomNoteImage) error {
	return r.db.Conn(ctx).Create(img).Error
}

// FindNoteImage returns an active note image by ID, or ErrNoteImageNotFound (SPEC-071 RN-07).
func (r *Repository) FindNoteImage(ctx context.Context, id uuid.UUID) (domain.LiveClassroomNoteImage, error) {
	var img domain.LiveClassroomNoteImage
	err := r.db.Conn(ctx).First(&img, "id = ?", id).Error
	return img, notFound(err, domain.ErrNoteImageNotFound)
}

// LinkNoteImages associates uploaded note images of the student in the session with the given note block (SPEC-071 RN-06).
func (r *Repository) LinkNoteImages(ctx context.Context, sessionID, studentID, blockID uuid.UUID, imageIDs []uuid.UUID) error {
	if len(imageIDs) == 0 {
		return nil
	}
	return r.db.Conn(ctx).Model(&domain.LiveClassroomNoteImage{}).
		Where("session_id = ? AND student_id = ? AND id IN ?", sessionID, studentID, imageIDs).
		Update("note_block_id", blockID).Error
}
