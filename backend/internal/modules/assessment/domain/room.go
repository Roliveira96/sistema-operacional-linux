package domain

import (
	"time"

	"github.com/google/uuid"
)

// AttemptEndedByTeacher is the attempt the teacher ended during the exam, graded as it stood (SPEC-091 RN-08, SPEC-090 D-02).
const AttemptEndedByTeacher AttemptStatus = "ENDED_BY_TEACHER"

// The limits of the room (SPEC-091 RN-06 to RN-08).
const (
	MaxCommandLength = 1000
	MaxOutputLength  = 4000
	MaxHelpLength    = 300
	MaxEndReason     = 500
)

// AttemptCommand is a command the student ran in the terminal of the exam, with a short output (SPEC-091 RN-06).
type AttemptCommand struct {
	ID         uuid.UUID
	AttemptID  uuid.UUID
	Position   int
	Command    string
	Output     string
	ExecutedAt time.Time
}

// HelpStatus is the situation of a request for help.
type HelpStatus string

// A request is open until the student lowers the hand or the teacher answers it (SPEC-091 RN-07).
const (
	HelpOpen     HelpStatus = "OPEN"
	HelpAnswered HelpStatus = "ANSWERED"
	HelpCanceled HelpStatus = "CANCELED"
)

// HelpRequest is the raised hand of a student during the exam, with the optional question and the optional answer of the teacher (RN-07, D-03).
// AssessmentID and StudentID come from its attempt.
type HelpRequest struct {
	ID           uuid.UUID
	AttemptID    uuid.UUID
	AssessmentID uuid.UUID
	StudentID    uuid.UUID
	Position     *int
	Question     string
	Status       HelpStatus
	CreatedAt    time.Time
	ClosedAt     *time.Time
	ClosedBy     *uuid.UUID
	Answer       string
}
