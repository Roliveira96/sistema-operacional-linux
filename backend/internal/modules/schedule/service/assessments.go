package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// CalendarAssessment is an assessment on the calendar (SPEC-075 RN-17): the public form of the assessment and, only when the actor is the teacher
// or an administrator, how many students are eligible and how the questions were chosen.
type CalendarAssessment struct {
	ID, ClassID        uuid.UUID
	ClassSessionID     *uuid.UUID
	Title, Description string
	Type, Status       string
	Phase              string
	StartsAt, EndsAt   time.Time
	DurationMinutes    *int
	MaxScore           float64
	CancelReason       *string
	EligibleStudents   *int
	Composition        *string
}

// AssessmentSource is what the calendar needs from the assessments; the assessment module implements it, in the composition root. It decides what
// each role sees, so a student never gets what is not hers (SPEC-075 D-08).
type AssessmentSource interface {
	CalendarAssessments(ctx context.Context, actor Actor, classIDs []uuid.UUID, from, to time.Time) ([]CalendarAssessment, error)
}

// WithAssessments plugs in the assessments. Without them the calendars carry none.
func (s *Service) WithAssessments(source AssessmentSource) *Service {
	s.assess = source
	return s
}

// Lesson reads a lesson of the schedule by its id, whatever its class, with no one to authorize. It is for the modules that check the class and
// decide who may do what themselves (SPEC-075 RN-04).
func (s *Service) Lesson(ctx context.Context, id uuid.UUID) (domain.ClassSession, error) {
	return s.repo.FindSession(ctx, id)
}
