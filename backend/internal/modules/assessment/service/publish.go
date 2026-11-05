package service

import (
	"context"
	"encoding/json"
	"errors"

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

// ResultItem is a question of the result the student reads (SPEC-098 RN-03): what she saw and answered, the key of the objective kinds, the points
// that counted and the reason of an adjustment. Never the machine of a practical question nor the expected answer of a written one.
type ResultItem struct {
	TeacherAttemptItem
	Points       *domain.Score
	AdjustReason string
}

// StudentResult is the published result of the exam of one student (SPEC-098 RN-03).
type StudentResult struct {
	FinalScore  domain.Score
	MaxScore    domain.Score
	StudentNote string
	Items       []ResultItem
}

// MyResult gives the student her published result: once the grades are published and her review is done; who did not come has none (SPEC-098
// RN-03, RN-04, D-03).
func (s *Service) MyResult(ctx context.Context, actor Actor, classID, id uuid.UUID) (StudentResult, error) {
	a, err := s.examOf(ctx, actor, classID, id)
	if err != nil {
		return StudentResult{}, err
	}
	if a.GradesPublishedAt == nil {
		return StudentResult{}, domain.ErrResultNotPublished
	}
	attempt, err := s.repo.FindAttempt(ctx, a.ID, actor.UserID)
	if errors.Is(err, domain.ErrAttemptNotFound) {
		return StudentResult{}, domain.ErrResultNotPublished
	}
	if err != nil {
		return StudentResult{}, err
	}
	if attempt.ReviewedAt == nil || attempt.FinalScore == nil {
		return StudentResult{}, domain.ErrResultNotPublished
	}
	items, err := s.repo.AttemptItems(ctx, attempt.ID)
	if err != nil {
		return StudentResult{}, err
	}
	out := StudentResult{FinalScore: *attempt.FinalScore, MaxScore: a.MaxScore, Items: make([]ResultItem, len(items))}
	if attempt.StudentNote != nil {
		out.StudentNote = *attempt.StudentNote
	}
	for i, it := range items {
		var view attemptView
		_ = json.Unmarshal(it.StudentView, &view) // written by the server at the entry; a broken one only loses the title
		key, err := s.ports.Questions.AnswerKey(ctx, it.Kind, it.AnswerKey)
		if err != nil {
			return StudentResult{}, err
		}
		item := ResultItem{TeacherAttemptItem: TeacherAttemptItem{AttemptItemView: AttemptItemView{Position: it.Position, Kind: it.Kind, Weight: it.Weight,
			StudentView: it.StudentView}, Title: view.Title, AnswerKey: key}, Points: it.Points}
		if it.Kind == kindPractical {
			solved := it.CheckedSolved != nil && *it.CheckedSolved
			item.CheckedSolved = &solved
		} else {
			item.Answer = it.Answer
		}
		if it.AdjustedPoints != nil {
			item.Points = it.AdjustedPoints
			if it.AdjustReason != nil {
				item.AdjustReason = *it.AdjustReason
			}
		}
		out.Items[i] = item
	}
	return out, nil
}
