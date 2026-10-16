package main

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	scheduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// ---- SPEC-074: the validation of the files of the materials of a lesson, by the one of the presentations of the live classroom ----

// Covers SPEC-074 CA-01 and RN-02: a PDF and an image are accepted by their first bytes, with the extension of the key and the pages; the
// rest is told in the terms of the schedule.
func TestScheduleFiles_Classify(t *testing.T) {
	files := scheduleFiles{}
	pdf := []byte("%PDF-1.7\n%âãÏÓ\n")

	got, err := files.Classify(12, 2048, pdf)
	require.NoError(t, err)
	assert.Equal(t, "application/pdf", got.ContentType)
	assert.Equal(t, ".pdf", got.Extension)
	assert.Equal(t, 12, got.PageCount)

	got, err = files.Classify(0, 2048, []byte("\x89PNG\r\n\x1a\n...."))
	require.NoError(t, err, "an image has no page count to send")
	assert.Equal(t, "image/png", got.ContentType)
	assert.Equal(t, ".png", got.Extension)
	assert.Equal(t, 1, got.PageCount)

	got, err = files.Classify(0, 2048, append([]byte{0xff, 0xd8, 0xff}, bytes.Repeat([]byte{0}, 9)...))
	require.NoError(t, err)
	assert.Equal(t, ".jpg", got.Extension)
	got, err = files.Classify(0, 2048, []byte("RIFF....WEBPVP8 "))
	require.NoError(t, err)
	assert.Equal(t, "image/webp", got.ContentType)

	invalid := func(err error, field string) {
		t.Helper()
		require.ErrorIs(t, err, scheduledomain.ErrInvalidMaterialFile)
		var fe *scheduledomain.FieldError
		require.ErrorAs(t, err, &fe)
		assert.Equal(t, field, fe.Field)
	}
	_, err = files.Classify(1, 100, []byte("GIF89a not a pdf"))
	invalid(err, "file")
	_, err = files.Classify(0, 2048, pdf)
	invalid(err, "pageCount")
	_, err = files.Classify(101, 2048, pdf)
	invalid(err, "pageCount")

	_, err = files.Classify(3, 25<<20+1, pdf)
	assert.ErrorIs(t, err, scheduledomain.ErrMaterialFileTooLarge, "a PDF over 25 MB")
	_, err = files.Classify(0, 10<<20+1, []byte("\x89PNG\r\n\x1a\n...."))
	assert.ErrorIs(t, err, scheduledomain.ErrMaterialFileTooLarge, "an image over 10 MB")
}
