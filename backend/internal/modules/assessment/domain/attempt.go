package domain

import (
	"encoding/json"
	"math"
	"time"

	"github.com/google/uuid"
)

// AttemptStatus is the situation of an attempt (SPEC-090 D-02).
type AttemptStatus string

// The situations of an attempt: being done, delivered by the student, or delivered by the server when the time ran out.
const (
	AttemptInProgress  AttemptStatus = "IN_PROGRESS"
	AttemptSubmitted   AttemptStatus = "SUBMITTED"
	AttemptTimeExpired AttemptStatus = "TIME_EXPIRED"
)

// AttemptTolerance is how long after the deadline the server still takes the answers and the delivery, for the latency of the network (SPEC-090 D-04).
const AttemptTolerance = time.Minute

// Attempt is the exam of one student (SPEC-090 section 4).
type Attempt struct {
	ID               uuid.UUID
	AssessmentID     uuid.UUID
	StudentID        uuid.UUID
	Status           AttemptStatus
	StartedAt        time.Time
	DeadlineAt       time.Time
	SubmittedAt      *time.Time
	PreliminaryScore *Score
	PendingItems     *int
	// EndedBy and EndReason are only there when the teacher ended the attempt (SPEC-091 RN-08).
	EndedBy   *uuid.UUID
	EndReason *string
	// the correction by the teacher (SPEC-097): the notes, the final score and the review
	TeacherNote *string
	StudentNote *string
	FinalScore  *Score
	ReviewedAt  *time.Time
	ReviewedBy  *uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Overdue tells whether an attempt in progress passed its deadline and the tolerance, and so must be closed as TIME_EXPIRED (RN-07).
func (a Attempt) Overdue(now time.Time) bool {
	return a.Status == AttemptInProgress && now.After(a.DeadlineAt.Add(AttemptTolerance))
}

// AttemptItem is a question of an attempt, frozen at the entry with what the student sees and the key (RN-02).
type AttemptItem struct {
	AttemptID     uuid.UUID
	Position      int
	QuestionID    uuid.UUID
	Kind          string
	Weight        Score
	StudentView   json.RawMessage
	AnswerKey     json.RawMessage
	Answer        json.RawMessage
	AnsweredAt    *time.Time
	CheckedSolved *bool
	Points        *Score
	// AdjustedPoints and AdjustReason are the teacher changing the points in the correction (SPEC-097 RN-03); nil keeps the automatic ones.
	AdjustedPoints *Score
	AdjustReason   *string
}

// AttemptDeadline is the start plus the individual duration, or the end of the assessment when it comes first or there is no duration (RN-03).
func AttemptDeadline(start time.Time, durationMinutes *int, endsAt time.Time) time.Time {
	if durationMinutes == nil {
		return endsAt
	}
	if d := start.Add(time.Duration(*durationMinutes) * time.Minute); d.Before(endsAt) {
		return d
	}
	return endsAt
}

// ScoreOf is the weight times the share that is right, rounded to the hundredth (RN-08, D-01).
func ScoreOf(weight Score, fraction float64) Score {
	return Score(math.Round(float64(weight) * fraction))
}
