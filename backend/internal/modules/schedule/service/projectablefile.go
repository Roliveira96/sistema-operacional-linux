package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// ProjectableFile is the file of a material of a lesson, as the live classroom reads it to put it on the stage (SPEC-074 RN-08).
type ProjectableFile struct {
	Title       string
	ObjectKey   string
	ContentType string
	PageCount   int
}

// ProjectableFile gives the file of a material of any lesson of the class, hidden from the students or not: who projects is the teacher, and
// projecting does not change what the class sees. The authorization is the classroom's. A material of another class, deleted or unknown is
// domain.ErrMaterialNotFound; a link is domain.ErrNotAFile.
func (s *Service) ProjectableFile(ctx context.Context, classID, materialID uuid.UUID) (ProjectableFile, error) {
	m, err := s.repo.FindMaterial(ctx, materialID)
	if err != nil {
		return ProjectableFile{}, err
	}
	if _, err := s.sessionOfClass(ctx, classID, m.SessionID); err != nil {
		return ProjectableFile{}, domain.ErrMaterialNotFound
	}
	if !m.IsFile() {
		return ProjectableFile{}, domain.ErrNotAFile
	}
	file := ProjectableFile{Title: m.Title, ObjectKey: *m.ObjectKey}
	if m.ContentType != nil {
		file.ContentType = *m.ContentType
	}
	if m.PageCount != nil {
		file.PageCount = *m.PageCount
	}
	return file, nil
}
