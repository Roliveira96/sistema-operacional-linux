package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// FinishResult is the exam finished by the teacher (SPEC-096 RN-04): when, who, the students whose attempt it ended and how many did not come.
type FinishResult struct {
	FinishedAt     time.Time
	FinishedBy     uuid.UUID
	FinishedByName string
	Ended          []uuid.UUID
	Absent         int
}

// waiting says whether the student waits in the room: before the start, and after it until the teacher admits her; who has an attempt is in
// (SPEC-096 RN-02, RN-03).
func (s *Service) waiting(ctx context.Context, a domain.Assessment, studentID uuid.UUID) (bool, error) {
	if a.StartedAt == nil {
		return true, nil
	}
	if _, err := s.repo.FindAttempt(ctx, a.ID, studentID); err == nil {
		return false, nil
	} else if !errors.Is(err, domain.ErrAttemptNotFound) {
		return false, err
	}
	admitted, err := s.repo.Admitted(ctx, a.ID)
	if err != nil {
		return false, err
	}
	return !admitted[studentID], nil
}

// Admit admits from 1 to 200 eligible students to the exam the teacher started, and gives back who was admitted now (SPEC-096 RN-01, D-03).
func (s *Service) Admit(ctx context.Context, actor Actor, classID, id uuid.UUID, studentIDs []uuid.UUID) ([]uuid.UUID, error) {
	a, err := s.runningExam(ctx, actor, classID, id)
	if err != nil {
		return nil, err
	}
	if len(studentIDs) == 0 || len(studentIDs) > domain.MaxAdmission {
		return nil, domain.ErrInvalidAdmission
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return nil, err
	}
	for _, st := range studentIDs {
		if !eligible[st] {
			return nil, domain.ErrInvalidAdmission
		}
	}
	return s.repo.Admit(ctx, a.ID, studentIDs, s.now(), actor.UserID)
}

// Finish finishes the whole exam (SPEC-096 RN-04, RN-05, D-02): it keeps when and who, ends the attempts in progress as ended by the teacher with
// the fixed reason and the preliminary score, and counts who did not come. Nobody enters nor is admitted after it.
func (s *Service) Finish(ctx context.Context, actor Actor, classID, id uuid.UUID) (FinishResult, error) {
	a, err := s.runningExam(ctx, actor, classID, id)
	if err != nil {
		return FinishResult{}, err
	}
	now := s.now()
	a.FinishedAt, a.FinishedBy = &now, &actor.UserID
	if err := s.repo.Save(ctx, &a, Replacements{}, nil); err != nil {
		return FinishResult{}, err
	}
	// ponytail: each attempt closes in its own transaction, as EndAttempt does; one that fails is closed by the sweep of the deadline (SPEC-090 RN-07)
	list, err := s.repo.ListAttempts(ctx, a.ID)
	if err != nil {
		return FinishResult{}, err
	}
	out := FinishResult{FinishedAt: now, FinishedBy: actor.UserID}
	reason := domain.FinishReason
	for i := range list {
		attempt := list[i]
		if attempt.Status != domain.AttemptInProgress {
			continue
		}
		attempt.EndedBy, attempt.EndReason = &actor.UserID, &reason
		if err := s.close(ctx, &attempt, domain.AttemptEndedByTeacher); err != nil && !errors.Is(err, domain.ErrAttemptAlreadySubmitted) {
			return FinishResult{}, err
		}
		out.Ended = append(out.Ended, attempt.StudentID)
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return FinishResult{}, err
	}
	took := make(map[uuid.UUID]bool, len(list))
	for _, at := range list {
		took[at.StudentID] = true
	}
	for st := range eligible {
		if !took[st] {
			out.Absent++
		}
	}
	names, err := s.ports.Users.Names(ctx, []uuid.UUID{actor.UserID})
	if err != nil {
		return FinishResult{}, err
	}
	out.FinishedByName = names[actor.UserID]
	return out, nil
}

// runningExam is the exam of the class the actor owns, started by the teacher and neither finished, canceled nor ended (SPEC-096).
func (s *Service) runningExam(ctx context.Context, actor Actor, classID, id uuid.UUID) (domain.Assessment, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return domain.Assessment{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return domain.Assessment{}, err
	}
	switch {
	case a.Type != domain.TypeExam:
		return domain.Assessment{}, domain.ErrInvalidAssessment
	case a.Status == domain.StatusCanceled:
		return domain.Assessment{}, domain.ErrAssessmentCanceled
	case a.FinishedAt != nil:
		return domain.Assessment{}, domain.ErrAssessmentFinished
	case a.StartedAt == nil:
		return domain.Assessment{}, domain.ErrAssessmentNotStarted
	case a.PhaseAt(s.now()) == domain.PhaseEnded:
		return domain.Assessment{}, domain.ErrAssessmentEnded
	}
	return a, nil
}
