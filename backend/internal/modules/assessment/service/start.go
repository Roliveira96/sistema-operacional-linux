package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Start is the teacher starting an exam, in person or online (SPEC-083 RN-01 to RN-03, SPEC-089 RN-01). It must be an exam, SCHEDULED and running by the clock of
// the server: not before its start time, not after its end. The start is stored once, with its author, and its event goes to the history in the same
// write. It is not a change of the assessment, so updated_by and updated_at stay.
func (s *Service) Start(ctx context.Context, actor Actor, classID, id uuid.UUID) (Summary, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Summary{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Summary{}, err
	}
	now := s.now()
	switch {
	case a.Type != domain.TypeExam: // every exam is started by the teacher, an assignment never (SPEC-089 RN-01)
		return Summary{}, domain.ErrInvalidAssessment
	case a.Status == domain.StatusCanceled:
		return Summary{}, domain.ErrAssessmentCanceled
	}
	switch a.PhaseAt(now) {
	case domain.PhaseEnded:
		return Summary{}, domain.ErrAssessmentEnded
	case domain.PhaseUpcoming:
		return Summary{}, domain.ErrAssessmentNotOpenYet
	}
	if a.StartedAt != nil {
		return Summary{}, domain.ErrAssessmentAlreadyStarted
	}
	a.StartedAt, a.StartedBy = &now, &actor.UserID
	event := domain.Event{Kind: domain.EventStarted, ActorID: actor.UserID, CreatedAt: now}
	if err := s.repo.Save(ctx, &a, Replacements{}, &event); err != nil {
		return Summary{}, err
	}
	return s.summarize(ctx, a)
}
