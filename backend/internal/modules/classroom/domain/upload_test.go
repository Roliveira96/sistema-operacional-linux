package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// The first bytes of each format the server accepts as a presentation (SPEC-068 RN-02).
var (
	pdfHead  = []byte("%PDF-1.7\n....")
	pngHead  = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13}
	jpegHead = []byte{0xff, 0xd8, 0xff, 0xe0, 0, 16, 'J', 'F', 'I', 'F', 0, 1}
	webpHead = []byte("RIFF\x24\x00\x00\x00WEBPVP8 ")
)

// Covers SPEC-068 CA-01, CA-02, RN-02, RN-04: the format is read from the content of the file, and an image is one slide whatever page count the
// browser sent.
func TestClassifyUpload_Formats(t *testing.T) {
	cases := []struct {
		name, kind, contentType, ext string
		head                         []byte
		pagesSent, pages             int
	}{
		{"pdf", domain.KindPDF, "application/pdf", ".pdf", pdfHead, 12, 12},
		{"png", domain.KindImage, "image/png", ".png", pngHead, 0, 1},
		{"jpeg", domain.KindImage, "image/jpeg", ".jpg", jpegHead, 7, 1},
		{"webp", domain.KindImage, "image/webp", ".webp", webpHead, 0, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			up, err := domain.ClassifyUpload(" Esquema ", tc.pagesSent, 1024, tc.head)
			require.NoError(t, err)
			assert.Equal(t, "Esquema", up.Title)
			assert.Equal(t, tc.kind, up.Kind)
			assert.Equal(t, tc.contentType, up.ContentType)
			assert.Equal(t, tc.ext, up.Extension)
			assert.Equal(t, tc.pages, up.PageCount)
		})
	}
}

// Covers SPEC-068 CA-03 (RN-02): what is not a PDF or a PNG, JPEG or WebP image is refused as invalid-file, even when it looks like one by the name;
// the same for a RIFF file that is not WebP, a ZIP (which is what a PowerPoint file is) and an empty file.
func TestClassifyUpload_RefusesOtherFormats(t *testing.T) {
	for name, head := range map[string][]byte{
		"gif":          []byte("GIF89a......."),
		"powerpoint":   []byte("PK\x03\x04\x14\x00\x06\x00"),
		"riff, wav":    []byte("RIFF\x24\x00\x00\x00WAVEfmt "),
		"text":         []byte("just some text"),
		"short png":    pngHead[:4],
		"short webp":   webpHead[:10],
		"empty":        {},
		"almost a pdf": []byte("%PD"),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := domain.ClassifyUpload("x", 3, 10, head)
			require.ErrorIs(t, err, domain.ErrInvalidFile)
			assert.Equal(t, "file", fieldOf(err))
		})
	}
}

// Covers SPEC-068 CA-03, CA-04 (RN-03): the title is checked first; the size has the limit of the format (25 MB for the PDF, 10 MB for the image),
// and only the PDF has pages to count.
func TestClassifyUpload_LimitsOfEachFormat(t *testing.T) {
	_, err := domain.ClassifyUpload("", 3, 10, pdfHead)
	require.ErrorIs(t, err, domain.ErrInvalidTitle)
	assert.Equal(t, "title", fieldOf(err))
	_, err = domain.ClassifyUpload("", 3, 10, []byte("GIF89a"))
	assert.ErrorIs(t, err, domain.ErrInvalidTitle, "the title comes before the format")

	_, err = domain.ClassifyUpload("x", 3, domain.MaxDeckBytes+1, pdfHead)
	assert.ErrorIs(t, err, domain.ErrFileTooLarge)
	_, err = domain.ClassifyUpload("x", 3, domain.MaxDeckBytes, pdfHead)
	assert.NoError(t, err, "25 MB is the limit of the PDF")

	for name, head := range map[string][]byte{"png": pngHead, "jpeg": jpegHead, "webp": webpHead} {
		_, err = domain.ClassifyUpload("x", 0, domain.MaxImageBytes+1, head)
		assert.ErrorIs(t, err, domain.ErrFileTooLarge, name+" over 10 MB")
		_, err = domain.ClassifyUpload("x", 0, domain.MaxImageBytes, head)
		assert.NoError(t, err, name+": 10 MB is the limit of the image")
	}

	for _, pages := range []int{0, 101} {
		_, err = domain.ClassifyUpload("x", pages, 10, pdfHead)
		require.ErrorIs(t, err, domain.ErrInvalidPDF)
		assert.Equal(t, "pageCount", fieldOf(err))
	}
	_, err = domain.ClassifyUpload("x", 100, 10, pdfHead)
	assert.NoError(t, err)
}
