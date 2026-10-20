package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// LessonMaterial is the file of a material of a lesson, as the room needs it to put it on the stage (SPEC-074 RN-08).
type LessonMaterial struct {
	Title       string
	ObjectKey   string
	ContentType string
	PageCount   int
}

// LessonMaterials is what the room needs from the materials of the lessons of the schedule. It answers domain.ErrMaterialNotFound for a material
// that does not exist, was deleted or is of a lesson of another class, and domain.ErrMaterialNotProjectable for a link; the schedule service
// implements it, through an adapter in cmd/api.
type LessonMaterials interface {
	MaterialFile(ctx context.Context, classID, materialID uuid.UUID) (LessonMaterial, error)
}

// WithLessonMaterials plugs in the materials of the lessons the teacher can project.
func (s *Service) WithLessonMaterials(m LessonMaterials) *Service {
	s.lessonMaterials = m
	return s
}

// ProjectMaterial makes a presentation of the class out of a file material of one of its lessons (SPEC-074 RN-08): it points to the same object,
// so nothing is copied, and a file that is already a presentation of the class is reused, so asking again does not spend the limit of 100. The
// boolean tells that a new one was made. Only who runs the class does it. It does not touch the stage: the teacher puts the presentation there
// as with any other (SelectDeck).
func (s *Service) ProjectMaterial(ctx context.Context, actor Actor, classID, materialID uuid.UUID) (DeckView, bool, error) {
	if _, err := s.writable(ctx, actor, classID); err != nil {
		return DeckView{}, false, err
	}
	if s.lessonMaterials == nil {
		return DeckView{}, false, domain.ErrMaterialNotFound
	}
	file, err := s.lessonMaterials.MaterialFile(ctx, classID, materialID)
	if err != nil {
		return DeckView{}, false, err
	}
	found, err := s.repo.FindDeckByObjectKey(ctx, classID, file.ObjectKey)
	if err == nil {
		view, err := s.deckView(ctx, found)
		return view, false, err
	}
	if !errors.Is(err, domain.ErrDeckNotFound) {
		return DeckView{}, false, err
	}
	count, err := s.repo.CountDecks(ctx, classID)
	if err != nil {
		return DeckView{}, false, err
	}
	if count >= domain.MaxDecksPerClass {
		return DeckView{}, false, domain.ErrDeckLimit
	}

	deck := domain.SlideDeck{ClassID: classID, UploadedBy: actor.UserID, Title: file.Title, ObjectKey: file.ObjectKey, PageCount: file.PageCount, Kind: domain.KindPDF}
	if file.ContentType != "application/pdf" {
		deck.Kind, deck.PageCount = domain.KindImage, 1 // an image is one slide
	}
	deck.ID = uuid.New()
	if err := s.repo.CreateDeck(ctx, &deck); err != nil {
		return DeckView{}, false, err
	}
	view, err := s.deckView(ctx, deck)
	return view, true, err
}
