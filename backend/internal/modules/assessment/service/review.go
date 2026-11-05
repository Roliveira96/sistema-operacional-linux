package service

import (
	"context"
	"math"
	"strings"
	"unicode/utf8"

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
	var out Review
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

// AdjustItem changes the points of a question in the correction, from 0 to its weight with two decimals and the reason, or undoes the change with
// nil points; the first grade of a written question needs no reason (SPEC-097 RN-03, D-01, D-05). A review already done refuses it (D-04).
func (s *Service) AdjustItem(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID, position int, points *float64, reason string) (Review, error) {
	attempt, err := s.reviewable(ctx, actor, classID, id, attemptID)
	if err != nil {
		return Review{}, err
	}
	if attempt.ReviewedAt != nil {
		return Review{}, domain.ErrReviewDone
	}
	items, err := s.repo.AttemptItems(ctx, attemptID)
	if err != nil {
		return Review{}, err
	}
	var item *domain.AttemptItem
	for i := range items {
		if items[i].Position == position {
			item = &items[i]
		}
	}
	if item == nil {
		return Review{}, domain.ErrAttemptNotFound
	}
	var stored *domain.Score
	var why *string
	if points != nil {
		v := *points
		p := domain.Points(v)
		if v < 0 || p > item.Weight || math.Abs(v*100-math.Round(v*100)) > 1e-9 {
			return Review{}, domain.ErrInvalidPoints
		}
		reason = strings.TrimSpace(reason)
		firstGrade := item.Kind == kindWritten && item.Points == nil && item.AdjustedPoints == nil
		if utf8.RuneCountInString(reason) > domain.MaxAdjustReason || (reason == "" && !firstGrade) {
			return Review{}, domain.ErrInvalidPoints
		}
		stored = &p
		if reason != "" {
			why = &reason
		}
	}
	if err := s.repo.AdjustItem(ctx, attemptID, position, stored, why, s.now(), actor.UserID); err != nil {
		return Review{}, err
	}
	return s.ReviewOf(ctx, actor, classID, id, attemptID)
}

// reviewable is the delivered attempt of the exam the actor owns, once the exam ended (SPEC-097 RN-01).
func (s *Service) reviewable(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID) (domain.Attempt, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return domain.Attempt{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return domain.Attempt{}, err
	}
	attempt, err := s.repo.FindAttemptByID(ctx, attemptID)
	if err != nil {
		return domain.Attempt{}, err
	}
	switch {
	case attempt.AssessmentID != a.ID:
		return domain.Attempt{}, domain.ErrAttemptNotFound
	case a.PhaseAt(s.now()) != domain.PhaseEnded:
		return domain.Attempt{}, domain.ErrAssessmentNotEnded
	case attempt.Status == domain.AttemptInProgress:
		return domain.Attempt{}, domain.ErrAttemptInProgress
	}
	return attempt, nil
}

// SaveReviewNotes keeps the private note and the note to the student, plain text up to 2,000 characters each; an empty one is cleared (SPEC-097 RN-04).
func (s *Service) SaveReviewNotes(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID, teacherNote, studentNote string) error {
	if _, err := s.reviewable(ctx, actor, classID, id, attemptID); err != nil {
		return err
	}
	note := func(text string) (*string, error) {
		text = strings.TrimSpace(text)
		if utf8.RuneCountInString(text) > domain.MaxReviewNote {
			return nil, domain.ErrInvalidNote
		}
		if text == "" {
			return nil, nil
		}
		return &text, nil
	}
	teacher, err := note(teacherNote)
	if err != nil {
		return err
	}
	student, err := note(studentNote)
	if err != nil {
		return err
	}
	return s.repo.SaveReviewNotes(ctx, attemptID, teacher, student)
}

// FinishReview concludes the review of the attempt with the final score, once every written question has points (SPEC-097 RN-05, D-03).
func (s *Service) FinishReview(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID) (Review, error) {
	attempt, err := s.reviewable(ctx, actor, classID, id, attemptID)
	if err != nil {
		return Review{}, err
	}
	if attempt.ReviewedAt != nil {
		return Review{}, domain.ErrReviewDone
	}
	items, err := s.repo.AttemptItems(ctx, attemptID)
	if err != nil {
		return Review{}, err
	}
	for _, it := range items {
		if it.Kind == kindWritten && it.Points == nil && it.AdjustedPoints == nil {
			return Review{}, domain.ErrWrittenPending
		}
	}
	if err := s.repo.FinishReview(ctx, attemptID, scoreOf(items), s.now(), actor.UserID); err != nil {
		return Review{}, err
	}
	return s.ReviewOf(ctx, actor, classID, id, attemptID)
}

// ReopenReview opens the review again, so the points can change (SPEC-097 RN-05, D-04).
func (s *Service) ReopenReview(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID) (Review, error) {
	attempt, err := s.reviewable(ctx, actor, classID, id, attemptID)
	if err != nil {
		return Review{}, err
	}
	if attempt.ReviewedAt != nil {
		if err := s.repo.ReopenReview(ctx, attemptID); err != nil {
			return Review{}, err
		}
	}
	return s.ReviewOf(ctx, actor, classID, id, attemptID)
}
