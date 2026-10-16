package domain_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

var (
	avifHead = []byte{0x00, 0x00, 0x00, 0x1c, 'f', 't', 'y', 'p', 'a', 'v', 'i', 'f', 0x00, 0x00, 0x00, 0x00}
	avisHead = []byte{0x00, 0x00, 0x00, 0x1c, 'f', 't', 'y', 'p', 'a', 'v', 'i', 's', 0x00, 0x00, 0x00, 0x00}
)

// Covers SPEC-071 CA-02, CA-03 (RN-02, RN-06): validates a note block markdown and extracts referenced proxy image IDs.
func TestValidateNoteBlock(t *testing.T) {
	text, err := domain.ValidateNoteBlock("  O comando `sudo` eleva privilégios.  ")
	require.NoError(t, err)
	assert.Equal(t, "O comando `sudo` eleva privilégios.", text)

	for _, empty := range []string{"", "   ", "\n\t "} {
		_, err = domain.ValidateNoteBlock(empty)
		require.ErrorIs(t, err, domain.ErrEmptyNoteBlock)
		assert.Equal(t, "contentMarkdown", fieldOf(err))
	}

	_, err = domain.ValidateNoteBlock(strings.Repeat("a", domain.MaxNoteLength))
	require.NoError(t, err)
	_, err = domain.ValidateNoteBlock(strings.Repeat("a", domain.MaxNoteLength+1))
	require.ErrorIs(t, err, domain.ErrContentTooLong)

	id1 := uuid.New()
	id2 := uuid.New()
	md := "Print 1: ![Tela](/api/v1/media/notes/" + id1.String() + ")\nRepetida: ![Tela](/api/v1/media/notes/" + id1.String() + ")\nPrint 2: ![Outra](/api/v1/media/notes/" + id2.String() + ")\nInvalida: ![X](/api/v1/media/notes/not-a-uuid)"
	got := domain.ExtractNoteImageIDs(md)
	assert.Equal(t, []uuid.UUID{id1, id2}, got)
}

// Covers SPEC-071 CA-08, CA-12 (RN-05): only AVIF and WebP up to 5 MB and 1220 px wide are accepted for note images.
func TestClassifyNoteImage(t *testing.T) {
	up, err := domain.ClassifyNoteImage("print terminal.png", 1220, 680, 4096, avifHead)
	require.NoError(t, err)
	assert.Equal(t, "image/avif", up.MimeType)
	assert.Equal(t, ".avif", up.Extension)
	assert.Equal(t, "print terminal.png", up.OriginalName)
	assert.Equal(t, 1220, up.Width)
	assert.Equal(t, 680, up.Height)
	assert.EqualValues(t, 4096, up.SizeBytes)

	up, err = domain.ClassifyNoteImage("", 0, 0, 1024, avisHead)
	require.NoError(t, err)
	assert.Equal(t, "image/avif", up.MimeType)
	assert.Equal(t, ".avif", up.Extension)
	assert.Equal(t, "capture.avif", up.OriginalName)

	up, err = domain.ClassifyNoteImage("fallback.webp", 800, 600, 2048, webpHead)
	require.NoError(t, err)
	assert.Equal(t, "image/webp", up.MimeType)
	assert.Equal(t, ".webp", up.Extension)

	// Over 5 MB is refused with ErrFileTooLarge.
	_, err = domain.ClassifyNoteImage("big.avif", 1220, 680, domain.MaxNoteImageBytes+1, avifHead)
	assert.ErrorIs(t, err, domain.ErrFileTooLarge)
	_, err = domain.ClassifyNoteImage("exact.avif", 1220, 680, domain.MaxNoteImageBytes, avifHead)
	assert.NoError(t, err)

	// Invalid dimensions (> 1220 px or negative) are refused.
	_, err = domain.ClassifyNoteImage("wide.avif", 1221, 680, 1024, avifHead)
	require.ErrorIs(t, err, domain.ErrInvalidNoteImage)
	assert.Equal(t, "file", fieldOf(err))
	_, err = domain.ClassifyNoteImage("neg.avif", -1, 680, 1024, avifHead)
	require.ErrorIs(t, err, domain.ErrInvalidNoteImage)
	_, err = domain.ClassifyNoteImage("negh.avif", 800, -1, 1024, avifHead)
	require.ErrorIs(t, err, domain.ErrInvalidNoteImage)

	// Non-AVIF/WebP formats are refused even if named .avif.
	for name, head := range map[string][]byte{
		"png":        pngHead,
		"jpeg":       jpegHead,
		"pdf":        pdfHead,
		"gif":        []byte("GIF89a123456"),
		"mp4 ftyp":   []byte{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2'},
		"short":      avifHead[:8],
		"empty":      {},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := domain.ClassifyNoteImage("fake.avif", 800, 600, 100, head)
			require.ErrorIs(t, err, domain.ErrInvalidFile)
			assert.Equal(t, "file", fieldOf(err))
		})
	}
}
