package domain

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// MaxClearanceReasonLength is the longest reason of a refusal (SPEC-076 RN-06).
const MaxClearanceReasonLength = 300

// ClearanceStatus is the state of a student for an in-person assessment that requires the clearance (SPEC-076 RN-04).
type ClearanceStatus string

const (
	// ClearancePending is waiting: it is derived from the lack of a decision and is never stored (D-06).
	ClearancePending  ClearanceStatus = "PENDING"
	ClearanceApproved ClearanceStatus = "APPROVED"
	ClearanceRejected ClearanceStatus = "REJECTED"
)

// Clearance is the decision of the teacher about a student: the last one only, with who made it and when (RN-11).
type Clearance struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey"`
	AssessmentID    uuid.UUID
	StudentID       uuid.UUID
	Status          ClearanceStatus
	RejectionReason *string
	ClearedBy       uuid.UUID
	ClearedAt       time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// TableName pins the table name.
func (Clearance) TableName() string { return "assessment_clearances" }

// CleanClearanceReason checks a decision and its reason (RN-06): only approving and refusing are decisions; the reason belongs to the refusal, is
// optional, trimmed, plain text of at most 300 characters, and a blank one is stored as none.
func CleanClearanceReason(status ClearanceStatus, raw string) (*string, error) {
	if status != ClearanceApproved && status != ClearanceRejected {
		return nil, ErrInvalidClearance
	}
	reason := strings.TrimSpace(raw)
	if reason == "" {
		return nil, nil
	}
	if status == ClearanceApproved || utf8.RuneCountInString(reason) > MaxClearanceReasonLength {
		return nil, ErrInvalidClearance
	}
	return &reason, nil
}
