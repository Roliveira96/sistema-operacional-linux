package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// TeacherAttemptItem is a question of the attempt as the teacher reads it in the room (SPEC-095 RN-01): what the student sees and answered, the title,
// and the key of the objective kinds (D-02). The machine of a practical question is not here: the terminal is in the tab Aluno.
type TeacherAttemptItem struct {
	AttemptItemView
	Title     string
	AnswerKey json.RawMessage
}

// TeacherAttempt is the attempt of one student as the teacher reads it in the room (SPEC-095 RN-01), never the points nor the score.
type TeacherAttempt struct {
	ID          uuid.UUID
	StudentID   uuid.UUID
	StudentName string
	Status      domain.AttemptStatus
	StartedAt   time.Time
	SubmittedAt *time.Time
	Items       []TeacherAttemptItem
}

// AttemptForTeacher gives the attempt of one student to the teacher who owns the class or to the administrator (SPEC-095 RN-01, RN-02). It only reads.
func (s *Service) AttemptForTeacher(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID) (TeacherAttempt, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return TeacherAttempt{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return TeacherAttempt{}, err
	}
	attempt, err := s.repo.FindAttemptByID(ctx, attemptID)
	if err != nil {
		return TeacherAttempt{}, err
	}
	if attempt.AssessmentID != a.ID {
		return TeacherAttempt{}, domain.ErrAttemptNotFound
	}
	items, err := s.repo.AttemptItems(ctx, attempt.ID)
	if err != nil {
		return TeacherAttempt{}, err
	}
	names, err := s.ports.Users.Names(ctx, []uuid.UUID{attempt.StudentID})
	if err != nil {
		return TeacherAttempt{}, err
	}
	if _, ok := names[attempt.StudentID]; !ok {
		students, err := s.ports.Students.ActiveStudents(ctx, classID)
		if err != nil {
			return TeacherAttempt{}, err
		}
		for _, st := range students {
			if st.ID == attempt.StudentID {
				names[st.ID] = st.Name
			}
		}
	}
	out := TeacherAttempt{ID: attempt.ID, StudentID: attempt.StudentID, StudentName: names[attempt.StudentID], Status: attempt.Status,
		StartedAt: attempt.StartedAt, SubmittedAt: attempt.SubmittedAt, Items: make([]TeacherAttemptItem, len(items))}
	for i, it := range items {
		var view attemptView
		_ = json.Unmarshal(it.StudentView, &view) // the view was written by the server at the entry; a broken one only loses the title
		key, err := s.ports.Questions.AnswerKey(ctx, it.Kind, it.AnswerKey)
		if err != nil {
			return TeacherAttempt{}, err
		}
		item := TeacherAttemptItem{AttemptItemView: AttemptItemView{Position: it.Position, Kind: it.Kind, Weight: it.Weight, StudentView: it.StudentView},
			Title: view.Title, AnswerKey: key}
		if it.Kind == kindPractical {
			solved := it.CheckedSolved != nil && *it.CheckedSolved
			item.CheckedSolved = &solved
		} else {
			item.Answer = it.Answer
		}
		out.Items[i] = item
	}
	return out, nil
}
