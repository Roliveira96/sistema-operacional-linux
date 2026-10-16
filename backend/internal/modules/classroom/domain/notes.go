package domain

import (
	"bytes"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Limits and routes for dynamic student note blocks and private note images (SPEC-071).
const (
	MaxNoteImageBytes = 5 << 20
	MaxNoteImageWidth = 1220
	MaxNoteImageName  = 255
	NoteMediaPrefix   = "/api/v1/media/notes/"
)

// Domain errors for student note blocks and private note images (SPEC-071).
var (
	ErrEmptyNoteBlock    = errors.New("the note block must have at least 1 character")
	ErrNoteBlockNotFound = errors.New("note block not found")
	ErrNoteImageNotFound = errors.New("note image not found")
	ErrInvalidNoteImage  = errors.New("the note image dimensions must be between 0 and 1220 px wide")
)

var noteImageIDPattern = regexp.MustCompile(`/api/v1/media/notes/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`)

// LiveClassroomNoteBlock is an atomic chronological note block of a student in a live classroom (SPEC-071).
type LiveClassroomNoteBlock struct {
	database.Model
	SessionID       uuid.UUID
	StudentID       uuid.UUID
	ContentMarkdown string
}

// TableName maps LiveClassroomNoteBlock to its table.
func (LiveClassroomNoteBlock) TableName() string { return "live_classroom_note_blocks" }

// LiveClassroomNoteImage holds the metadata of a private image attached to a student's note block (SPEC-071).
type LiveClassroomNoteImage struct {
	database.Model
	SessionID    uuid.UUID
	NoteBlockID  *uuid.UUID
	StudentID    uuid.UUID
	ObjectKey    string
	OriginalName string
	MimeType     string
	Width        int
	Height       int
	SizeBytes    int64
}

// TableName maps LiveClassroomNoteImage to its table.
func (LiveClassroomNoteImage) TableName() string { return "live_classroom_note_images" }

// NoteImageUpload holds the validated metadata of a note image upload.
type NoteImageUpload struct {
	MimeType     string
	Extension    string
	OriginalName string
	Width        int
	Height       int
	SizeBytes    int64
}

// ValidateNoteBlock trims surrounding spaces and validates the Markdown length of an atomic note block (SPEC-071 RN-02).
func ValidateNoteBlock(content string) (string, error) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return "", &FieldError{Field: "contentMarkdown", Err: ErrEmptyNoteBlock}
	}
	if utf8.RuneCountInString(trimmed) > MaxNoteLength {
		return "", ErrContentTooLong
	}
	return trimmed, nil
}

// ExtractNoteImageIDs returns the unique UUIDs referenced via /api/v1/media/notes/{id} inside a Markdown note block (SPEC-071 RN-06).
func ExtractNoteImageIDs(markdown string) []uuid.UUID {
	matches := noteImageIDPattern.FindAllStringSubmatch(markdown, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[uuid.UUID]struct{}, len(matches))
	out := make([]uuid.UUID, 0, len(matches))
	for _, m := range matches {
		id, err := uuid.Parse(m[1])
		if err != nil {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// ClassifyNoteImage validates the binary signature (AVIF or WebP), byte size (<= 5 MB), and dimensions (<= 1220 px wide) of a note image (SPEC-071 RN-05).
func ClassifyNoteImage(originalName string, width, height int, size int64, header []byte) (NoteImageUpload, error) {
	if width < 0 || width > MaxNoteImageWidth || height < 0 {
		return NoteImageUpload{}, &FieldError{Field: "file", Err: ErrInvalidNoteImage}
	}
	if size <= 0 {
		return NoteImageUpload{}, &FieldError{Field: "file", Err: ErrInvalidFile}
	}
	if size > MaxNoteImageBytes {
		return NoteImageUpload{}, ErrFileTooLarge
	}

	mimeType, ext, ok := detectNoteImageSignature(header)
	if !ok {
		return NoteImageUpload{}, &FieldError{Field: "file", Err: ErrInvalidFile}
	}

	name := strings.TrimSpace(originalName)
	if name == "" {
		name = "capture" + ext
	} else if utf8.RuneCountInString(name) > MaxNoteImageName {
		runes := []rune(name)
		name = string(runes[:MaxNoteImageName])
	}

	return NoteImageUpload{
		MimeType:     mimeType,
		Extension:    ext,
		OriginalName: name,
		Width:        width,
		Height:       height,
		SizeBytes:    size,
	}, nil
}

func detectNoteImageSignature(header []byte) (string, string, bool) {
	if len(header) < 12 {
		return "", "", false
	}
	// ISO Base Media File Format (ftyp box) with AVIF brands.
	if bytes.Equal(header[4:8], []byte("ftyp")) {
		brand := string(header[8:12])
		if brand == "avif" || brand == "avis" || brand == "mif1" {
			return "image/avif", ".avif", true
		}
	}
	// WebP container (RIFF....WEBP).
	if bytes.Equal(header[:4], []byte("RIFF")) && bytes.Equal(header[8:12], []byte("WEBP")) {
		return "image/webp", ".webp", true
	}
	return "", "", false
}
