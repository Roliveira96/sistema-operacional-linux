package service

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// QuestionScenario gives the teacher the machine a question of the assessment starts from, for the terminal of the simulator (SPEC-084 RN-01, RN-02).
// It is nil when the question has no scenario of its own and the default machine applies. The question has to be of the assessment: one of those
// chosen in a manual composition and, in a draw, which keeps no questions, one that is eligible in the module. Reading writes nothing.
func (s *Service) QuestionScenario(ctx context.Context, actor Actor, classID, id, questionID uuid.UUID) (json.RawMessage, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return nil, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return nil, err
	}
	belongs, err := s.belongsTo(ctx, a, questionID)
	if err != nil {
		return nil, err
	}
	if !belongs {
		return nil, domain.ErrQuestionNotFound
	}
	return s.ports.Questions.Scenario(ctx, questionID)
}

// belongsTo says whether a question is one of the assessment.
func (s *Service) belongsTo(ctx context.Context, a domain.Assessment, questionID uuid.UUID) (bool, error) {
	if a.Composition == domain.CompositionDraw {
		eligible, err := s.ports.Questions.Eligible(ctx, a.ModuleID, []uuid.UUID{questionID})
		return len(eligible) > 0, err
	}
	items, err := s.repo.Items(ctx, a.ID)
	if err != nil {
		return false, err
	}
	for _, it := range items {
		if it.QuestionID == questionID {
			return true, nil
		}
	}
	return false, nil
}
