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
}

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

// SummaryMaxLength is the largest summary of a class, in characters (SPEC-041 RN-01, D-09).
const SummaryMaxLength = 300

// RichTextMaxLength is the largest syllabus or guidelines of a class after the HTML filter, in characters (SPEC-041 RN-02).
const RichTextMaxLength = 20000

// NormalizeSummary trims the summary and checks its length (SPEC-041 RN-01).
func NormalizeSummary(summary string) (string, error) {
	trimmed := strings.TrimSpace(summary)
	if utf8.RuneCountInString(trimmed) > SummaryMaxLength {
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
	ErrForbidden                  = errors.New("you are not authorized to manage this class")
	ErrInviteLinkExpired          = errors.New("invite link is inactive or outside its validity window")
	ErrAlreadyEnrolled            = errors.New("student is already enrolled or pending moderation in this class")
	ErrEnrollmentNotFound         = errors.New("enrollment not found")
	ErrInvalidStatusTransition   = errors.New("invalid status transition")
)
