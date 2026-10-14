// Package domain holds the live classroom: the room, the slide decks, the raised hands and the notes of the students (SPEC-051).
package domain

import (
	"bytes"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Statuses and modes (SPEC-051 section 4).
const (
	StatusActive   = "ACTIVE"
	StatusFinished = "FINISHED"

	ModeSlides = "SLIDES"
	ModeModule = "MODULE"

	HandPending  = "PENDING"
	HandAnswered = "ANSWERED"
	HandLowered  = "LOWERED"

	// The situation of a student in the waiting room of a live classroom (SPEC-054).
	AdmissionWaiting  = "WAITING"
	AdmissionAdmitted = "ADMITTED"
	AdmissionRemoved  = "REMOVED"
)

// Limits (SPEC-051 sections 3.2 and 5).
const (
	MaxTitleLength    = 120
	MaxDecksPerClass  = 100
	MaxPages          = 100
	MaxDeckBytes      = 25 << 20
	MaxNoteLength     = 20000
	MaxListedSessions = 50
	MaxBlockIDLength  = 64

	// SafetyNet is how long a room may stay open without its teacher before it is ended by itself (RN-03).
	SafetyNet = 12 * time.Hour
	// DownloadURLTTL is how long the signed address of a deck is valid.
	DownloadURLTTL = 15 * time.Minute
)

// pdfHeader starts every PDF file.
var pdfHeader = []byte("%PDF-")

// Errors of the domain.
var (
	ErrInvalidTitle         = errors.New("the title must have from 1 to 120 characters")
	ErrInvalidPDF           = errors.New("the file is not a valid presentation")
	ErrFileTooLarge         = errors.New("the file is larger than 25 MB")
	ErrContentTooLong       = errors.New("the notes have more than 20,000 characters")
	ErrInvalidSlide         = errors.New("the slide is out of the presentation")
	ErrInvalidMode          = errors.New("the mode must be SLIDES or MODULE")
	ErrForbidden            = errors.New("you are not allowed to do this in this class")
	ErrClassNotFound        = errors.New("class not found")
	ErrClassArchived        = errors.New("an archived class takes no live classroom")
	ErrSessionNotFound      = errors.New("live classroom not found")
	ErrDeckNotFound         = errors.New("presentation not found")
	ErrClassSessionNotFound = errors.New("lesson of the schedule not found")
	ErrModuleNotFound       = errors.New("teaching module not found")
	ErrNotesNotFound        = errors.New("no notes of the student in this live classroom")
	ErrDeckLimit            = errors.New("the class already has 100 presentations")
	ErrActiveSessionExists  = errors.New("the class already has a live classroom open")
	ErrInvalidBlock         = errors.New("the block must have an id of up to 64 characters")
	ErrNotAdmitted          = errors.New("the teacher has not admitted you to this live classroom")
	ErrAdmissionNotFound    = errors.New("the student is not waiting in this live classroom")
	ErrNoActiveSession      = errors.New("the class has no live classroom open")
	ErrModuleNotSelected    = errors.New("the live classroom has not chosen a module yet")
)

// FieldError tells which field broke a rule. It matches the sentinel it wraps.
type FieldError struct {
	Field string
	Err   error
}

func (e *FieldError) Error() string { return e.Field + ": " + e.Err.Error() }

// Unwrap returns the sentinel error.
func (e *FieldError) Unwrap() error { return e.Err }

// LiveClassroomSession is the live classroom ("sala ao vivo") of a class.
type LiveClassroomSession struct {
	database.Model
	ClassID        uuid.UUID
	TeacherID      uuid.UUID
	ClassSessionID *uuid.UUID
	DeckID         *uuid.UUID
	ActiveModuleID *uuid.UUID
	Title          string
	DisplayMode    string
	CurrentSlide   int
	Status         string
	StartedAt      time.Time
	EndedAt        *time.Time
}

// TableName maps LiveClassroomSession to its table.
func (LiveClassroomSession) TableName() string { return "live_classroom_sessions" }

// IsActive tells whether the room is open.
func (s LiveClassroomSession) IsActive() bool { return s.Status == StatusActive }

// End closes the room. Ending twice keeps the first end (SPEC-051 RN-02).
func (s *LiveClassroomSession) End(now time.Time) {
	if s.EndedAt != nil {
		return
	}
	s.Status = StatusFinished
	s.EndedAt = &now
}

// DurationMinutes is how long the room was open, in whole minutes; an open room has none yet.
func (s LiveClassroomSession) DurationMinutes() int {
	if s.EndedAt == nil {
		return 0
	}
	return int(s.EndedAt.Sub(s.StartedAt) / time.Minute)
}

// SlideDeck is a presentation (a PDF) uploaded for the class.
type SlideDeck struct {
	database.Model
	ClassID    uuid.UUID
	UploadedBy uuid.UUID
	Title      string
	ObjectKey  string
	PageCount  int
}

// TableName maps SlideDeck to its table.
func (SlideDeck) TableName() string { return "slide_decks" }

// LiveHandRaise is a request to speak of a student, in the queue of a room.
type LiveHandRaise struct {
	database.Model
	SessionID   uuid.UUID
	StudentID   uuid.UUID
	Status      string
	RequestedAt time.Time
	ResolvedAt  *time.Time
}

// TableName maps LiveHandRaise to its table.
func (LiveHandRaise) TableName() string { return "live_hand_raises" }

// HandRaiseEntry is a pending hand of the queue, with the name of the student.
type HandRaiseEntry struct {
	StudentID   uuid.UUID
	Name        string
	RequestedAt time.Time
}

// LiveClassroomNote is the private notebook of a student in a room.
type LiveClassroomNote struct {
	database.Model
	SessionID uuid.UUID
	StudentID uuid.UUID
	Content   string
}

// TableName maps LiveClassroomNote to its table.
func (LiveClassroomNote) TableName() string { return "live_classroom_notes" }

// LiveClassroomAdmission is the situation of a student in the waiting room of a room: the teacher decides, per room (SPEC-054 RN-02).
type LiveClassroomAdmission struct {
	database.Model
	SessionID   uuid.UUID
	StudentID   uuid.UUID
	Status      string
	RequestedAt time.Time
	DecidedAt   *time.Time
	DecidedBy   *uuid.UUID
}

// TableName maps LiveClassroomAdmission to its table.
func (LiveClassroomAdmission) TableName() string { return "live_classroom_admissions" }

// AdmissionEntry is a student of the waiting room or of the admitted, with his name.
type AdmissionEntry struct {
	StudentID   uuid.UUID
	Name        string
	Status      string
	RequestedAt time.Time
}

// NormalizeTitle trims the title and checks its length (SPEC-051 section 5.1).
func NormalizeTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if n := utf8.RuneCountInString(title); n < 1 || n > MaxTitleLength {
		return "", &FieldError{Field: "title", Err: ErrInvalidTitle}
	}
	return title, nil
}

// ValidateDeck checks what the server can know of an uploaded deck: the title, the size, the header of the file and the page count that
// the browser read (SPEC-051 section 5.3). It returns the title, trimmed.
func ValidateDeck(title string, pageCount int, size int64, header []byte) (string, error) {
	title, err := NormalizeTitle(title)
	if err != nil {
		return "", err
	}
	if size > MaxDeckBytes {
		return "", ErrFileTooLarge
	}
	if !bytes.HasPrefix(header, pdfHeader) {
		return "", &FieldError{Field: "file", Err: ErrInvalidPDF}
	}
	if pageCount < 1 || pageCount > MaxPages {
		return "", &FieldError{Field: "pageCount", Err: ErrInvalidPDF}
	}
	return title, nil
}

// ValidateNote checks the size of the notes.
func ValidateNote(content string) error {
	if utf8.RuneCountInString(content) > MaxNoteLength {
		return ErrContentTooLong
	}
	return nil
}

// ValidMode tells whether the mode is one of the two.
func ValidMode(mode string) bool { return mode == ModeSlides || mode == ModeModule }

// ValidSlide tells whether the slide number exists: from 1, and up to the last page when the room has a deck (pageCount 0 means no deck).
func ValidSlide(slide, pageCount int) bool {
	return slide >= 1 && (pageCount == 0 || slide <= pageCount)
}
