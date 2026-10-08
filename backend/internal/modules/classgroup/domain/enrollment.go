package domain

import (
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// EnrollmentStatus is the membership status of a student in a class.
type EnrollmentStatus string

const (
	EnrollmentPendingModeration EnrollmentStatus = "PENDING_MODERATION"
	EnrollmentActive            EnrollmentStatus = "ACTIVE"
	EnrollmentRejected          EnrollmentStatus = "REJECTED"
	EnrollmentTransferred       EnrollmentStatus = "TRANSFERRED"
	EnrollmentUnenrolled        EnrollmentStatus = "UNENROLLED"
)

// EnrollmentOrigin indicates how the student entered the class.
type EnrollmentOrigin string

const (
	OriginInviteLink       EnrollmentOrigin = "INVITE_LINK"
	OriginDirectByTeacher  EnrollmentOrigin = "DIRECT_BY_TEACHER"
	OriginCSVImport        EnrollmentOrigin = "CSV_IMPORT"
)

// Enrollment represents the link between a student and a class.
type Enrollment struct {
	database.Model
	ClassID         uuid.UUID
	UserID          uuid.UUID
	Status          EnrollmentStatus
	Origin          EnrollmentOrigin
	RejectionReason *string
	RequestedAt     time.Time
	DecidedAt       *time.Time
}

// TableName maps Enrollment to the "class_enrollments" table.
func (Enrollment) TableName() string { return "class_enrollments" }
