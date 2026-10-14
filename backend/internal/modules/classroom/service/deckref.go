package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// DeckOfClass returns a presentation of the class with a signed address, for the lessons of the schedule (SPEC-053 RN-04, RN-06). A presentation
// of another class is reported as missing.
func (s *Service) DeckOfClass(ctx context.Context, classID, deckID uuid.UUID) (DeckView, error) {
	deck, err := s.repo.FindDeck(ctx, deckID)
	if err != nil {
		return DeckView{}, err
	}
	if deck.ClassID != classID {
		return DeckView{}, domain.ErrDeckNotFound
	}
	return s.deckView(ctx, deck)
}
