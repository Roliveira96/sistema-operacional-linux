package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// ReviewItem is a question of the attempt in the correction (SPEC-097 RN-02): what the teacher reads in the room, plus the automatic points, the
// adjustment, the answer expected in a written question and the commands of a practical one.
type ReviewItem struct {
	TeacherAttemptItem
	Points         *domain.Score
	AdjustedPoints *domain.Score
	AdjustReason   string
	ExpectedAnswer string
	Commands       []domain.AttemptCommand
}

// Review is the delivered attempt of one student as the teacher corrects it (SPEC-097 RN-02): the line of the list, the score now (the adjustments
// over the automatic points), the review, the notes, the questions and the requests for help.
type Review struct {
	AttemptRow
	Score       domain.Score
	Reviewed    bool
	TeacherNote string
	StudentNote string
	Items       []ReviewItem
	Helps       []domain.HelpRequest
}

// ReviewOf gives the delivered attempt for the correction, to the teacher who owns the class or to the administrator, once the exam ended
// (SPEC-097 RN-01, RN-02, D-06). It only reads.
func (s *Service) ReviewOf(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID) (Review, error) {
	read, err := s.AttemptForTeacher(ctx, actor, classID, id, attemptID)
	if err != nil {
		return Review{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Review{}, err
	}
	if a.PhaseAt(s.now()) != domain.PhaseEnded {
		return Review{}, domain.ErrAssessmentNotEnded
	}
	if read.Status == domain.AttemptInProgress {
		return Review{}, domain.ErrAttemptInProgress
	}
	attempt, err := s.repo.FindAttemptByID(ctx, attemptID)
	if err != nil {
		return Review{}, err
	}
	rows, err := s.Attempts(ctx, actor, classID, id)
	if err != nil {
		return Review{}, err
	}
	out := Review{Reviewed: attempt.ReviewedAt != nil}
	for _, r := range rows {
		if r.AttemptID == attemptID {
			out.AttemptRow = r
		}
	}
	if attempt.TeacherNote != nil {
		out.TeacherNote = *attempt.TeacherNote
	}
	if attempt.StudentNote != nil {
		out.StudentNote = *attempt.StudentNote
	}
	items, err := s.repo.AttemptItems(ctx, attemptID)
	if err != nil {
		return Review{}, err
	}
	commands, err := s.repo.Commands(ctx, attemptID)
	if err != nil {
		return Review{}, err
	}
	out.Items = make([]ReviewItem, len(items))
	for i, it := range items {
		item := ReviewItem{TeacherAttemptItem: read.Items[i], Points: it.Points, AdjustedPoints: it.AdjustedPoints}
		if it.AdjustReason != nil {
			item.AdjustReason = *it.AdjustReason
		}
		if item.ExpectedAnswer, err = s.ports.Questions.ExpectedAnswer(ctx, it.Kind, it.AnswerKey); err != nil {
			return Review{}, err
		}
		for _, c := range commands {
			if c.Position == it.Position {
				item.Commands = append(item.Commands, c)
			}
		}
		out.Items[i] = item
	}
	out.Score = scoreOf(items)
	if out.Helps, err = s.repo.AttemptHelps(ctx, attemptID); err != nil {
		return Review{}, err
	}
	return out, nil
}

// scoreOf is the score of an attempt in the correction: for each question, the adjustment when there is one, otherwise the automatic points (SPEC-097
// section 4).
func scoreOf(items []domain.AttemptItem) domain.Score {
	var total domain.Score
	for _, it := range items {
		switch {
		case it.AdjustedPoints != nil:
			total += *it.AdjustedPoints
		case it.Points != nil:
			total += *it.Points
		}
	}
	return total
}
