package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// PublishGrades publishes the grades of the exam, once it ended and every delivered attempt is reviewed (SPEC-098 RN-01, RN-02, D-01). Publishing
// again changes nothing (D-05).
func (s *Service) PublishGrades(ctx context.Context, actor Actor, classID, id uuid.UUID) (Summary, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Summary{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Summary{}, err
	}
	if a.Type != domain.TypeExam {
		return Summary{}, domain.ErrInvalidAssessment
	}
	if a.PhaseAt(s.now()) != domain.PhaseEnded {
		return Summary{}, domain.ErrAssessmentNotEnded
	}
	if a.GradesPublishedAt != nil {
		return s.summarize(ctx, a)
	}
	list, err := s.repo.ListAttempts(ctx, a.ID)
	if err != nil {
		return Summary{}, err
	}
	for _, at := range list {
		if at.ReviewedAt == nil { // an attempt still in progress is not reviewed either
			return Summary{}, domain.ErrReviewsPending
		}
	}
	now := s.now()
	a.GradesPublishedAt, a.GradesPublishedBy = &now, &actor.UserID
	if err := s.repo.Save(ctx, &a, Replacements{}, nil); err != nil {
		return Summary{}, err
	}
	return s.summarize(ctx, a)
}
