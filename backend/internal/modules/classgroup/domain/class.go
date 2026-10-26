// Package domain defines the ClassGroup and Enrollment entities and business rules (SPEC-009).
package domain

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/htmlsafe"
)

// ClassStatus is the lifecycle state of a class.
type ClassStatus string

const (
	ClassStatusDraft    ClassStatus = "DRAFT"
	ClassStatusActive   ClassStatus = "ACTIVE"
	ClassStatusArchived ClassStatus = "ARCHIVED"
)

// Relations between a user and a class listed by GET /me/classes (SPEC-026).
const (
	RelationTeacher = "TEACHER"
	RelationStudent = "STUDENT"
)

// MyClassesLimit is the maximum number of classes returned to the account menu (SPEC-026 RN-08).
const MyClassesLimit = 20

// ClassGroup is the offering of an academic course in a given semester.
type ClassGroup struct {
	database.Model
	TeacherID                uuid.UUID
	Name                     string
	CourseCode               string
	Semester                 string
	Summary                  string
	Color                    string `gorm:"default:orange"`
	Syllabus                 string
	InstitutionalGuidelines  string
	StartDate                time.Time
	EndDate                  time.Time
	ScheduleDescription      string
	EnableVirtualClassroom   bool
	EnableInviteLink         bool
	InviteLinkToken          *string
	InviteLinkStart          *time.Time
	InviteLinkEnd            *time.Time
	Status                   ClassStatus
	ArchiveReason            *string
	// Who and when (SPEC-049): the author of the creation and of the last update, and the archiving.
	CreatedBy  uuid.UUID
	UpdatedBy  uuid.UUID
	ArchivedAt *time.Time
	ArchivedBy *uuid.UUID
	// DeletedBy is who deleted the class (SPEC-050); the date is the soft delete of the model.
	DeletedBy *uuid.UUID
}

// ArchiveRetentionDays is how long a class stays archived before it can be deleted (SPEC-050 RN-01).
const ArchiveRetentionDays = 30

// DeletableAfter is the instant from which an archived class can be deleted, or nil when it cannot be (not archived, or archived
// without the date). SPEC-050 RN-01.
func (c ClassGroup) DeletableAfter() *time.Time {
	if c.Status != ClassStatusArchived || c.ArchivedAt == nil {
		return nil
	}
	after := c.ArchivedAt.Add(ArchiveRetentionDays * 24 * time.Hour)
	return &after
}

// CanDelete tells whether the class can be deleted at the given instant (SPEC-050 RN-01).
func (c ClassGroup) CanDelete(now time.Time) bool {
	after := c.DeletableAfter()
	return after != nil && !now.Before(*after)
}

// NotDeletableError is the refusal to delete a class; After is the date from which it can be, when there is one (SPEC-050 RN-04).
type NotDeletableError struct {
	After *time.Time
}

func (e *NotDeletableError) Error() string { return ErrClassNotDeletable.Error() }

// Unwrap makes the error match ErrClassNotDeletable.
func (e *NotDeletableError) Unwrap() error { return ErrClassNotDeletable }

// TableName maps ClassGroup to the "classes" table.
func (ClassGroup) TableName() string { return "classes" }

// IsExpiringSoon checks if the class is active and within 15 days of ending.
func (c *ClassGroup) IsExpiringSoon(now time.Time) bool {
	if c.Status != ClassStatusActive {
		return false
	}
	if !c.EndDate.After(now) {
		return false
	}
	return c.EndDate.Sub(now) <= 15*24*time.Hour
}

// IsInviteLinkValid checks if the invite link is active and currently within its validity window.
func (c *ClassGroup) IsInviteLinkValid(now time.Time) bool {
	if !c.EnableInviteLink || c.InviteLinkToken == nil || *c.InviteLinkToken == "" {
		return false
	}
	if c.Status != ClassStatusActive {
		return false
	}
	if c.InviteLinkStart == nil || c.InviteLinkEnd == nil {
		return false
	}
	return !now.Before(*c.InviteLinkStart) && !now.After(*c.InviteLinkEnd)
}

// ValidateDates checks that the start date is before or equal to the end date.
func ValidateDates(start, end time.Time) error {
	if start.After(end) {
		return ErrInvalidDateRange
	}
	return nil
}

// ValidateInviteLink checks invite link dates when enabled.
func ValidateInviteLink(enabled bool, start, end *time.Time) error {
	if !enabled {
		return nil
	}
	if start == nil || end == nil {
		return ErrInviteLinkConfigRequired
	}
	if start.After(*end) {
		return ErrInvalidInviteRange
	}
	return nil
}

// GenerateInviteToken creates a secure random token for invite links.
func GenerateInviteToken() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// ClassColors are the palette keys of a class (SPEC-042 RN-12); the colors themselves are frontend tokens.
var ClassColors = []string{"orange", "blue", "green", "purple", "pink", "teal", "yellow", "red"}

// DefaultClassColor is the color of a class created without one.
const DefaultClassColor = "orange"

// NormalizeColor returns the color, the default one when empty, or ErrInvalidColor (SPEC-042 RN-12).
func NormalizeColor(color string) (string, error) {
	color = strings.TrimSpace(color)
	if color == "" {
		return DefaultClassColor, nil
	}
	for _, c := range ClassColors {
		if c == color {
			return color, nil
		}
	}
	return "", ErrInvalidColor
}

// SummaryMaxLength is the largest summary of a class, in characters of visible text (SPEC-041 RN-01, D-09; SPEC-078 RN-01).
const SummaryMaxLength = 300

// SummaryHTMLMaxLength is the largest summary of a class after the HTML filter, in characters (SPEC-078 RN-01, D-05).
const SummaryHTMLMaxLength = 5000

// RichTextMaxLength is the largest syllabus or guidelines of a class after the HTML filter, in characters (SPEC-041 RN-02).
const RichTextMaxLength = 20000

// NormalizeSummary trims a summary that was already filtered as html and checks it (SPEC-078 RN-01): its visible text has at most
// SummaryMaxLength characters and the html at most SummaryHTMLMaxLength. A summary with nothing visible is empty.
func NormalizeSummary(filtered string) (string, error) {
	trimmed := strings.TrimSpace(filtered)
	visible := htmlsafe.PlainText(trimmed)
	if visible == "" {
		return "", nil
	}
	if utf8.RuneCountInString(visible) > SummaryMaxLength || utf8.RuneCountInString(trimmed) > SummaryHTMLMaxLength {
		return "", ErrSummaryTooLong
	}
	return trimmed, nil
}

// ContentTooLongError tells which formatted field of a class is over RichTextMaxLength. It matches ErrContentTooLong.
type ContentTooLongError struct {
	Field string
}

func (e *ContentTooLongError) Error() string { return e.Field + ": " + ErrContentTooLong.Error() }

// Is makes errors.Is(err, ErrContentTooLong) true.
func (e *ContentTooLongError) Is(target error) bool { return target == ErrContentTooLong }

// Domain errors.
var (
	ErrInvalidColor              = errors.New("color must be one of the palette keys")
	ErrSummaryTooLong            = errors.New("summary must have at most 300 characters")
	ErrContentTooLong            = errors.New("formatted content must have at most 20000 characters")
	ErrClassArchived             = errors.New("an archived class does not take new enrollments")
	ErrInvalidEnrollmentBatch    = errors.New("the batch must have from 1 to 200 student ids")
	ErrInvalidDateRange          = errors.New("start date must be before or equal to end date")
	ErrInvalidInviteRange         = errors.New("invite link start must be before or equal to end date")
	ErrInviteLinkConfigRequired   = errors.New("invite link start and end dates are required when invite link is enabled")
	ErrArchiveReasonRequired      = errors.New("archive reason is required for active classes")
	ErrClassConflict              = errors.New("a class with the same course code and semester already exists for this teacher")
	ErrClassNotFound              = errors.New("class not found")
	ErrClassNotDeletable          = errors.New("only a class archived for 30 days or more can be deleted")
	ErrForbidden                  = errors.New("you are not authorized to manage this class")
	ErrInviteLinkExpired          = errors.New("invite link is inactive or outside its validity window")
	ErrAlreadyEnrolled            = errors.New("student is already enrolled or pending moderation in this class")
	ErrEnrollmentNotFound         = errors.New("enrollment not found")
	ErrInvalidStatusTransition   = errors.New("invalid status transition")
)
