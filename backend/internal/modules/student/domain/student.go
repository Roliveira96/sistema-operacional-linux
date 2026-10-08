package domain

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Limits specified by SPEC-002 (P-06).
const (
	MaxCSVFileSize     = 2 * 1024 * 1024 // 2 MB
	MaxCSVRows         = 2000
	MaxAvatarFileSize  = 5 * 1024 * 1024 // 5 MB
	MinAvatarDimension = 128
	MaxAvatarDimension = 4096
	TargetAvatarSize   = 512
)

// Domain errors for student onboarding and profile management (SPEC-002).
var (
	ErrEmailAlreadyRegistered      = errors.New("email already registered")
	ErrAcademicIDAlreadyRegistered = errors.New("academic id already registered")
	ErrInvalidAcademicID          = errors.New("academic id must have exactly 7 digits, optionally prefixed by 'a'")
	ErrInvalidEmail               = errors.New("invalid email address")
	ErrStudentNotFound            = errors.New("student not found")
	ErrClassNotFound              = errors.New("class not found")
	ErrInviteNotFound             = errors.New("invite not found or invalid")
	ErrInviteExpired              = errors.New("invite link expired")
	ErrAlreadyEnrolled            = errors.New("student already enrolled in class")
	ErrInvalidCSV                 = errors.New("invalid or empty CSV file")
	ErrCSVFileTooLarge            = errors.New("csv file exceeds 2 MB limit")
	ErrUnsupportedImageFormat     = errors.New("unsupported image format (must be JPEG, PNG or WEBP)")
	ErrImageTooLarge              = errors.New("image exceeds 5 MB limit")
	ErrImageDimensions            = errors.New("image dimensions must be between 128x128 and 4096x4096")
	ErrNotAStudent                = errors.New("user is not a student")
)

// StudentProfile represents additional metadata for a student user.
type StudentProfile struct {
	database.Model
	UserID          uuid.UUID
	Whatsapp        *string
	Discord         *string
	AvatarObjectKey *string
}

// TableName maps StudentProfile to the "student_profiles" table.
func (StudentProfile) TableName() string { return "student_profiles" }

// StudentSummary represents a student in teacher/admin listings.
type StudentSummary struct {
	ID                   uuid.UUID
	AcademicID           string
	Email                string
	Name                 string
	Whatsapp             *string
	Discord              *string
	AvatarURL            *string
	TotalClassesEnrolled int64
	CreatedAt            time.Time
}

// StudentProfileResponse represents the self profile view of a student.
type StudentProfileResponse struct {
	ID         uuid.UUID
	AcademicID string
	Email      string
	Name       string
	Whatsapp   *string
	Discord    *string
	AvatarURL  *string
	CreatedAt  time.Time
}

// CSVRowError records a skipped/invalid row during batch CSV import.
type CSVRowError struct {
	Line   int    `json:"line"`
	Reason string `json:"reason"`
}

// CSVImportResult consolidates stats from a batch import operation.
type CSVImportResult struct {
	TotalRows       int           `json:"totalRows"`
	Created         int           `json:"created"`
	Enrolled        int           `json:"enrolled"`
	AlreadyEnrolled int           `json:"alreadyEnrolled"`
	Errors          []CSVRowError `json:"errors"`
}

// NormalizeAcademicID enforces RN-01: exactly 7 digits after discarding optional "a"/"A".
func NormalizeAcademicID(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if strings.HasPrefix(v, "a") || strings.HasPrefix(v, "A") {
		v = v[1:]
	}
	if len(v) != 7 {
		return "", ErrInvalidAcademicID
	}
	for _, c := range v {
		if c < '0' || c > '9' {
			return "", ErrInvalidAcademicID
		}
	}
	return v, nil
}

// NormalizeEmail enforces RN-02: trimmed and lowercase with at least one dot in domain.
func NormalizeEmail(raw string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	at := strings.LastIndex(v, "@")
	if at < 1 || at == len(v)-1 || strings.ContainsAny(v, " \t\r\n") || !strings.Contains(v[at+1:], ".") {
		return "", ErrInvalidEmail
	}
	return v, nil
}
