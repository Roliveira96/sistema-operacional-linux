package domain

import (
	"bytes"
	"errors"
)

// The kinds of presentation (SPEC-068): a PDF has its pages as slides; an image is one slide.
const (
	KindPDF   = "PDF"
	KindImage = "IMAGE"

	// MaxImageBytes is the largest image the teacher may send; the PDF has MaxDeckBytes.
	MaxImageBytes = 10 << 20
)

// ErrInvalidFile is a file that is none of the formats of a presentation: PDF, PNG, JPEG or WebP (SPEC-068 RN-02).
var ErrInvalidFile = errors.New("the file must be a PDF or a PNG, JPEG or WebP image")

// Upload is what the server learns of a file that was sent as a presentation.
type Upload struct {
	Title       string
	Kind        string
	ContentType string
	// Extension goes at the end of the key of the object in the bucket; the key is made by the server, never from the name of the file.
	Extension string
	// PageCount is the number of slides: the one the browser read for a PDF, and 1 for an image.
	PageCount int
}

// ClassifyUpload checks a file sent as a presentation, by its first bytes and not by its name or its declared type (SPEC-068 RN-02, RN-03): the
// title, the format and the size, which has the limit of the format, and the page count of the PDF. It needs at least 12 bytes of the file, when
// it has so many.
func ClassifyUpload(title string, pageCount int, size int64, header []byte) (Upload, error) {
	switch {
	case bytes.HasPrefix(header, pdfHeader):
		title, err := ValidateDeck(title, pageCount, size, header)
		return Upload{Title: title, Kind: KindPDF, ContentType: "application/pdf", Extension: ".pdf", PageCount: pageCount}, err
	case bytes.HasPrefix(header, pngHeader):
		return image(title, size, "image/png", ".png")
	case bytes.HasPrefix(header, jpegHeader):
		return image(title, size, "image/jpeg", ".jpg")
	case len(header) >= 12 && bytes.HasPrefix(header, []byte("RIFF")) && bytes.Equal(header[8:12], []byte("WEBP")):
		return image(title, size, "image/webp", ".webp")
	}
	if _, err := NormalizeTitle(title); err != nil {
		return Upload{}, err
	}
	return Upload{}, &FieldError{Field: "file", Err: ErrInvalidFile}
}

var (
	pngHeader  = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	jpegHeader = []byte{0xff, 0xd8, 0xff}
)

func image(title string, size int64, contentType, ext string) (Upload, error) {
	title, err := NormalizeTitle(title)
	if err != nil {
		return Upload{}, err
	}
	if size > MaxImageBytes {
		return Upload{}, ErrFileTooLarge
	}
	return Upload{Title: title, Kind: KindImage, ContentType: contentType, Extension: ext, PageCount: 1}, nil
}
