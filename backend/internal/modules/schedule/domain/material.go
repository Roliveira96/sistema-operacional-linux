package domain

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Limits of the materials of a lesson (SPEC-074 RN-01, RN-02).
const (
	MaxMaterialsPerSession    = 50
	MaxMaterialTitleLength    = 120
	MaxMaterialFileNameLength = 255
)

// Errors of the materials of a lesson.
var (
	ErrInvalidMaterial       = errors.New("invalid class session material")
	ErrInvalidMaterialFile   = errors.New("the file must be a PDF or a PNG, JPEG or WebP image")
	ErrMaterialFileTooLarge  = errors.New("the file is larger than the limit of its format (25 MB for a PDF, 10 MB for an image)")
	ErrMaterialNotFound      = errors.New("material not found")
	ErrMaterialLimitExceeded = errors.New("a lesson has at most 50 materials")
	ErrNotAFile              = errors.New("the material is a link: it has no file to download")
	ErrAlreadyVisible        = errors.New("the material is already visible")
)

// MaterialKind is what a material is: the slides, the exercises, the resolution of the exercises or a reference (SPEC-074 RN-01).
type MaterialKind string

// The kinds of material.
const (
	MaterialSlides           MaterialKind = "SLIDES"
	MaterialExercises        MaterialKind = "EXERCISES"
	MaterialExerciseSolution MaterialKind = "EXERCISE_SOLUTION"
	MaterialReference        MaterialKind = "REFERENCE"
)

// MaterialVisibility is the phase of the lesson in which the class sees a material (SPEC-074 RN-04).
type MaterialVisibility string

// The phases of visibility.
const (
	VisibilityAlways         MaterialVisibility = "ALWAYS"
	VisibilityDuringClass    MaterialVisibility = "DURING_CLASS"
	VisibilityAfterClass     MaterialVisibility = "AFTER_CLASS"
	VisibilityDuringAndAfter MaterialVisibility = "DURING_AND_AFTER"
)

// ClassSessionMaterial is a file or a link of a lesson of the schedule, with its kind and its phase of visibility (SPEC-074, section 4).
type ClassSessionMaterial struct {
	database.Model
	SessionID  uuid.UUID
	Position   int
	Title      string
	Kind       MaterialKind
	Visibility MaterialVisibility
	ReleaseAt  *time.Time
	URL        *string `gorm:"column:url"`
	// The file, when the material is not a link: the key in the bucket is made by the server, and the name is only to show.
	ObjectKey   *string
	ContentType *string
	SizeBytes   *int64
	FileName    *string
	PageCount   *int
	CreatedBy   uuid.UUID
}

// TableName maps ClassSessionMaterial to its table.
func (ClassSessionMaterial) TableName() string { return "class_session_materials" }

// IsFile tells a material that is a file in the bucket from one that is a link.
func (m ClassSessionMaterial) IsFile() bool { return m.ObjectKey != nil }

// MaterialInput is what the teacher says of a material: the title, the kind, the phase and, optionally, the release.
type MaterialInput struct {
	Title      string
	Kind       MaterialKind
	Visibility MaterialVisibility
	ReleaseAt  *time.Time
}

// MaterialFile is a file already in the bucket, as the material keeps it.
type MaterialFile struct {
	ObjectKey   string
	ContentType string
	FileName    string
	Size        int64
	PageCount   int
}

// NormalizeMaterialTitle trims the title and checks its length (SPEC-074 RN-01).
func NormalizeMaterialTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if n := utf8.RuneCountInString(title); n < 1 || n > MaxMaterialTitleLength {
		return "", fieldError("title", ErrInvalidMaterial)
	}
	return title, nil
}

// ValidMaterialKind tells a kind that exists.
func ValidMaterialKind(k MaterialKind) bool {
	switch k {
	case MaterialSlides, MaterialExercises, MaterialExerciseSolution, MaterialReference:
		return true
	}
	return false
}

// ValidMaterialVisibility tells a phase that exists.
func ValidMaterialVisibility(v MaterialVisibility) bool {
	switch v {
	case VisibilityAlways, VisibilityDuringClass, VisibilityAfterClass, VisibilityDuringAndAfter:
		return true
	}
	return false
}

func newMaterial(sessionID, createdBy uuid.UUID, in MaterialInput) (ClassSessionMaterial, error) {
	title, err := NormalizeMaterialTitle(in.Title)
	if err != nil {
		return ClassSessionMaterial{}, err
	}
	if !ValidMaterialKind(in.Kind) {
		return ClassSessionMaterial{}, fieldError("kind", ErrInvalidMaterial)
	}
	if !ValidMaterialVisibility(in.Visibility) {
		return ClassSessionMaterial{}, fieldError("visibility", ErrInvalidMaterial)
	}
	id, err := uuid.NewV7()
	if err != nil {
		return ClassSessionMaterial{}, err
	}
	return ClassSessionMaterial{Model: database.Model{ID: id}, SessionID: sessionID, Title: title, Kind: in.Kind, Visibility: in.Visibility,
		ReleaseAt: in.ReleaseAt, CreatedBy: createdBy}, nil
}

// NewLinkMaterial builds a material that is a link; the address must be https (SPEC-074 RN-01).
func NewLinkMaterial(sessionID, createdBy uuid.UUID, in MaterialInput, address string) (ClassSessionMaterial, error) {
	m, err := newMaterial(sessionID, createdBy, in)
	if err != nil {
		return ClassSessionMaterial{}, err
	}
	address = strings.TrimSpace(address)
	if !httpsAddress(address) {
		return ClassSessionMaterial{}, fieldError("url", ErrInvalidMaterial)
	}
	m.URL = &address
	return m, nil
}

// NewFileMaterial builds a material that is a file already put in the bucket. The name of the file is only to show, so one that is too long
// is cut and not refused (SPEC-074 RN-02).
func NewFileMaterial(sessionID, createdBy uuid.UUID, in MaterialInput, file MaterialFile) (ClassSessionMaterial, error) {
	m, err := newMaterial(sessionID, createdBy, in)
	if err != nil {
		return ClassSessionMaterial{}, err
	}
	name := file.FileName
	if runes := []rune(name); len(runes) > MaxMaterialFileNameLength {
		name = string(runes[:MaxMaterialFileNameLength])
	}
	key, contentType, size, pages := file.ObjectKey, file.ContentType, file.Size, file.PageCount
	m.ObjectKey, m.ContentType, m.SizeBytes, m.FileName, m.PageCount = &key, &contentType, &size, &name, &pages
	return m, nil
}

// LiveState is what the rooms of the live classroom linked to a lesson say of it (SPEC-074 RN-04): one of them is open, or one of them was
// closed.
type LiveState struct {
	Active bool
	Ended  bool
}

// lessonPhase is where a lesson stands at an instant, as far as the materials care: under way, or over.
type lessonPhase struct {
	inProgress bool
	ended      bool
}

// phaseAt tells where the lesson stands (SPEC-074 RN-04). An open room linked to the lesson keeps it under way, whatever the hour; else it is
// over when a linked room was closed or its end by the clock passed; else it is under way from 15 minutes before its start (SPEC-073 D-04). A
// canceled lesson is neither.
func phaseAt(s ClassSession, live LiveState, now time.Time) lessonPhase {
	switch {
	case s.Status == SessionCanceled:
		return lessonPhase{}
	case live.Active:
		return lessonPhase{inProgress: true}
	case live.Ended, !now.Before(s.EndsAt()):
		return lessonPhase{ended: true}
	case !now.Before(s.WindowOpensAt()):
		return lessonPhase{inProgress: true}
	}
	return lessonPhase{}
}

// VisibleAt tells whether the class sees the material at now (SPEC-074 RN-04): always, when it is of the phase of ALWAYS; during the lesson,
// when it is under way; after, when it is over; during and after, when it is either; and in any phase from the release on.
func (m ClassSessionMaterial) VisibleAt(s ClassSession, live LiveState, now time.Time) bool {
	if m.ReleaseAt != nil && !now.Before(*m.ReleaseAt) {
		return true
	}
	p := phaseAt(s, live, now)
	switch m.Visibility {
	case VisibilityAlways:
		return true
	case VisibilityDuringClass:
		return p.inProgress
	case VisibilityAfterClass:
		return p.ended
	case VisibilityDuringAndAfter:
		return p.inProgress || p.ended
	}
	return false
}

// HiddenReason is why a material is not visible yet, as the teacher is told (SPEC-074 RN-05).
type HiddenReason string

// The reasons.
const (
	HiddenUntilClassStart    HiddenReason = "CLASS_START"
	HiddenUntilClassEnd      HiddenReason = "CLASS_END"
	HiddenUntilClassOver     HiddenReason = "CLASS_OVER"
	HiddenUntilClassCanceled HiddenReason = "CLASS_CANCELED"
	HiddenUntilRelease       HiddenReason = "RELEASE_AT"
)

// HiddenUntil is the reason a material is hidden and, for a release, the instant.
type HiddenUntil struct {
	Reason HiddenReason
	At     *time.Time
}

// HiddenUntil tells why the material is not visible at now; false when it is visible. The release is the reason when it comes before the moment
// of the phase by the clock, or when the phase does not come back (a material of the lesson alone, once over, and any phase of a lesson that
// was canceled).
func (m ClassSessionMaterial) HiddenUntil(s ClassSession, live LiveState, now time.Time) (HiddenUntil, bool) {
	if m.VisibleAt(s, live, now) {
		return HiddenUntil{}, false
	}
	p := phaseAt(s, live, now)
	var reason HiddenReason
	var phaseMoment *time.Time // by the clock; nil when the phase will not come
	switch {
	case s.Status == SessionCanceled:
		reason = HiddenUntilClassCanceled
	case m.Visibility == VisibilityAfterClass:
		reason, phaseMoment = HiddenUntilClassEnd, ptrTime(s.EndsAt())
	case p.ended:
		reason = HiddenUntilClassOver
	default:
		reason, phaseMoment = HiddenUntilClassStart, ptrTime(s.WindowOpensAt())
	}
	if m.ReleaseAt != nil && (phaseMoment == nil || m.ReleaseAt.Before(*phaseMoment)) {
		return HiddenUntil{Reason: HiddenUntilRelease, At: m.ReleaseAt}, true
	}
	return HiddenUntil{Reason: reason}, true
}

func ptrTime(t time.Time) *time.Time { return &t }
