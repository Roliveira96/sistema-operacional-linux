package service

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// CheckQuestion tells the teacher whether the machine of the simulator meets the conditions of a question of command Linux of the assessment (SPEC-085
// RN-01 to RN-04). The correction is the server's, with the engine and the conditions of the practice, and gives only yes or no. It writes nothing:
// no attempt, no progress of the user, no event of the history. The question has to be of the assessment, as for its scenario.
func (s *Service) CheckQuestion(ctx context.Context, actor Actor, classID, id, questionID uuid.UUID, snapshot json.RawMessage) (bool, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return false, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return false, err
	}
	belongs, err := s.belongsTo(ctx, a, questionID)
	if err != nil {
		return false, err
	}
	if !belongs {
		return false, domain.ErrQuestionNotFound
	}
	if len(snapshot) == 0 || string(snapshot) == "null" {
		return false, domain.ErrSnapshotRequired
	}
	return s.ports.Questions.Check(ctx, questionID, snapshot)
}
