package service

import (
	"bufio"
	"context"
	"io"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// NoteImageInput is the multipart payload sent when uploading a private note image (SPEC-071 section 5.5).
type NoteImageInput struct {
	OriginalName string
	Width        int
	Height       int
	Size         int64
	File         io.Reader
}

// NoteImageCreated is returned after a note image is stored privately in MinIO (SPEC-071 section 5.5).
type NoteImageCreated struct {
	ImageID   uuid.UUID
	AccessURL string
}

// NoteImageStream holds the metadata and object stream of a private note image (SPEC-071 section 5.6).
type NoteImageStream struct {
	Image domain.LiveClassroomNoteImage
	Body  io.ReadCloser
}

// ListNoteBlocks returns the chronological note blocks of the student in the session (SPEC-071 RN-01, RN-02).
func (s *Service) ListNoteBlocks(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) ([]domain.LiveClassroomNoteBlock, error) {
	if _, err := s.studentRoom(ctx, actor, classID, sessionID); err != nil {
		return nil, err
	}
	return s.repo.ListNoteBlocks(ctx, sessionID, actor.UserID)
}

// CreateNoteBlock creates a new atomic note block with the server clock and links any referenced private images (SPEC-071 RN-02, RN-06).
func (s *Service) CreateNoteBlock(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, contentMarkdown string) (domain.LiveClassroomNoteBlock, error) {
	if _, err := s.studentRoom(ctx, actor, classID, sessionID); err != nil {
		return domain.LiveClassroomNoteBlock{}, err
	}
	cleaned, err := domain.ValidateNoteBlock(contentMarkdown)
	if err != nil {
		return domain.LiveClassroomNoteBlock{}, err
	}
	now := s.now().UTC()
	block := domain.LiveClassroomNoteBlock{
		Model:           database.Model{ID: uuid.New(), CreatedAt: now, UpdatedAt: now},
		SessionID:       sessionID,
		StudentID:       actor.UserID,
		ContentMarkdown: cleaned,
	}
	if err := s.repo.CreateNoteBlock(ctx, &block); err != nil {
		return domain.LiveClassroomNoteBlock{}, err
	}
	if ids := domain.ExtractNoteImageIDs(cleaned); len(ids) > 0 {
		if err := s.repo.LinkNoteImages(ctx, sessionID, actor.UserID, block.ID, ids); err != nil {
			return domain.LiveClassroomNoteBlock{}, err
		}
	}
	return block, nil
}

// UpdateNoteBlock updates an existing note block after verifying ownership and session membership (SPEC-071 RN-03, RN-06).
func (s *Service) UpdateNoteBlock(ctx context.Context, actor Actor, classID, sessionID, blockID uuid.UUID, contentMarkdown string) (domain.LiveClassroomNoteBlock, error) {
	if _, err := s.studentRoom(ctx, actor, classID, sessionID); err != nil {
		return domain.LiveClassroomNoteBlock{}, err
	}
	cleaned, err := domain.ValidateNoteBlock(contentMarkdown)
	if err != nil {
		return domain.LiveClassroomNoteBlock{}, err
	}
	block, err := s.repo.FindNoteBlock(ctx, blockID)
	if err != nil {
		return domain.LiveClassroomNoteBlock{}, err
	}
	if block.SessionID != sessionID {
		return domain.LiveClassroomNoteBlock{}, domain.ErrNoteBlockNotFound
	}
	if block.StudentID != actor.UserID {
		return domain.LiveClassroomNoteBlock{}, domain.ErrForbidden
	}
	block.ContentMarkdown = cleaned
	block.UpdatedAt = s.now().UTC()
	if err := s.repo.SaveNoteBlock(ctx, &block); err != nil {
		return domain.LiveClassroomNoteBlock{}, err
	}
	if ids := domain.ExtractNoteImageIDs(cleaned); len(ids) > 0 {
		if err := s.repo.LinkNoteImages(ctx, sessionID, actor.UserID, block.ID, ids); err != nil {
			return domain.LiveClassroomNoteBlock{}, err
		}
	}
	return block, nil
}

// DeleteNoteBlock soft-deletes an atomic note block and revokes its associated images after verifying ownership (SPEC-071 RN-04).
func (s *Service) DeleteNoteBlock(ctx context.Context, actor Actor, classID, sessionID, blockID uuid.UUID) error {
	if _, err := s.studentRoom(ctx, actor, classID, sessionID); err != nil {
		return err
	}
	block, err := s.repo.FindNoteBlock(ctx, blockID)
	if err != nil {
		return err
	}
	if block.SessionID != sessionID {
		return domain.ErrNoteBlockNotFound
	}
	if block.StudentID != actor.UserID {
		return domain.ErrForbidden
	}
	return s.repo.DeleteNoteBlock(ctx, block.ID, s.now().UTC())
}

// UploadNoteImage validates and stores a private note image in MinIO and records its metadata (SPEC-071 RN-05).
func (s *Service) UploadNoteImage(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, in NoteImageInput) (NoteImageCreated, error) {
	if _, err := s.studentRoom(ctx, actor, classID, sessionID); err != nil {
		return NoteImageCreated{}, err
	}
	if in.File == nil {
		return NoteImageCreated{}, &domain.FieldError{Field: "file", Err: domain.ErrInvalidFile}
	}
	br := bufio.NewReader(io.LimitReader(in.File, domain.MaxNoteImageBytes+1))
	header, _ := br.Peek(16)
	up, err := domain.ClassifyNoteImage(in.OriginalName, in.Width, in.Height, in.Size, header)
	if err != nil {
		return NoteImageCreated{}, err
	}

	now := s.now().UTC()
	imgID := uuid.New()
	key := "notes/" + actor.UserID.String() + "/" + imgID.String() + up.Extension
	if err := s.store.PutObject(ctx, key, io.LimitReader(br, up.SizeBytes), up.SizeBytes, up.MimeType); err != nil {
		return NoteImageCreated{}, err
	}

	img := domain.LiveClassroomNoteImage{
		Model:        database.Model{ID: imgID, CreatedAt: now, UpdatedAt: now},
		SessionID:    sessionID,
		StudentID:    actor.UserID,
		ObjectKey:    key,
		OriginalName: up.OriginalName,
		MimeType:     up.MimeType,
		Width:        up.Width,
		Height:       up.Height,
		SizeBytes:    up.SizeBytes,
	}
	if err := s.repo.CreateNoteImage(ctx, &img); err != nil {
		return NoteImageCreated{}, err
	}
	return NoteImageCreated{
		ImageID:   img.ID,
		AccessURL: domain.NoteMediaPrefix + img.ID.String(),
	}, nil
}

// OpenNoteImage verifies that the authenticated student owns the private note image and opens its stream from MinIO (SPEC-071 RN-07).
func (s *Service) OpenNoteImage(ctx context.Context, actor Actor, imageID uuid.UUID) (NoteImageStream, error) {
	img, err := s.repo.FindNoteImage(ctx, imageID)
	if err != nil {
		return NoteImageStream{}, err
	}
	if actor.Role != authn.RoleStudent || img.StudentID != actor.UserID {
		return NoteImageStream{}, domain.ErrForbidden
	}
	body, err := s.store.GetObject(ctx, img.ObjectKey)
	if err != nil {
		return NoteImageStream{}, err
	}
	return NoteImageStream{Image: img, Body: body}, nil
}
