package domain_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

func fieldOf(err error) string {
	var fe *domain.FieldError
	if errors.As(err, &fe) {
		return fe.Field
	}
	return ""
}

// Covers SPEC-051 section 5.1: the title is trimmed and has from 1 to 120 characters.
func TestNormalizeTitle(t *testing.T) {
	got, err := domain.NormalizeTitle("  Aula 3: processos  ")
	require.NoError(t, err)
	assert.Equal(t, "Aula 3: processos", got)

	for _, bad := range []string{"", "   ", strings.Repeat("a", 121)} {
		_, err := domain.NormalizeTitle(bad)
		assert.ErrorIs(t, err, domain.ErrInvalidTitle)
		assert.Equal(t, "title", fieldOf(err))
	}
	_, err = domain.NormalizeTitle(strings.Repeat("ã", 120))
	assert.NoError(t, err, "the limit counts characters, not bytes")
}

// Covers SPEC-051 CA-03 and section 5.3: what the server can check of an uploaded deck.
func TestValidateDeck(t *testing.T) {
	pdf := []byte("%PDF-1.7\n...")
	title, err := domain.ValidateDeck(" Slides ", 12, 1024, pdf)
	require.NoError(t, err)
	assert.Equal(t, "Slides", title)

	cases := []struct {
		name  string
		title string
		pages int
		size  int64
		head  []byte
		want  error
		field string
	}{
		{"empty title", "", 3, 10, pdf, domain.ErrInvalidTitle, "title"},
		{"not a pdf", "x", 3, 10, []byte("GIF89a"), domain.ErrInvalidPDF, "file"},
		{"short header", "x", 3, 10, []byte("%PD"), domain.ErrInvalidPDF, "file"},
		{"no pages", "x", 0, 10, pdf, domain.ErrInvalidPDF, "pageCount"},
		{"too many pages", "x", 101, 10, pdf, domain.ErrInvalidPDF, "pageCount"},
		{"too big", "x", 3, domain.MaxDeckBytes + 1, pdf, domain.ErrFileTooLarge, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := domain.ValidateDeck(tc.title, tc.pages, tc.size, tc.head)
			require.ErrorIs(t, err, tc.want)
			assert.Equal(t, tc.field, fieldOf(err))
		})
	}
	_, err = domain.ValidateDeck("x", 100, domain.MaxDeckBytes, pdf)
	assert.NoError(t, err, "100 pages and 25 MB are allowed")
}

// Covers SPEC-051 CA-10: at most 20,000 characters of notes.
func TestValidateNote(t *testing.T) {
	assert.NoError(t, domain.ValidateNote(strings.Repeat("a", 20000)))
	assert.NoError(t, domain.ValidateNote(""))
	assert.ErrorIs(t, domain.ValidateNote(strings.Repeat("a", 20001)), domain.ErrContentTooLong)
}

func TestModesAndSlides(t *testing.T) {
	assert.True(t, domain.ValidMode(domain.ModeSlides))
	assert.True(t, domain.ValidMode(domain.ModeModule))
	assert.False(t, domain.ValidMode("VIDEO"))
	assert.False(t, domain.ValidMode(""))

	assert.True(t, domain.ValidSlide(1, 0), "without a deck any slide number from 1 is accepted")
	assert.False(t, domain.ValidSlide(0, 0))
	assert.True(t, domain.ValidSlide(12, 12))
	assert.False(t, domain.ValidSlide(13, 12))
	assert.False(t, domain.ValidSlide(-1, 12))
}

// Covers SPEC-051 RN-02: an ended room is final and has a duration.
func TestSessionEnd(t *testing.T) {
	start := time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)
	s := domain.LiveClassroomSession{Status: domain.StatusActive, StartedAt: start}
	assert.True(t, s.IsActive())
	assert.Equal(t, 0, s.DurationMinutes(), "an open room has no duration yet")

	s.End(start.Add(95*time.Minute + 20*time.Second))
	assert.False(t, s.IsActive())
	assert.Equal(t, domain.StatusFinished, s.Status)
	require.NotNil(t, s.EndedAt)
	assert.Equal(t, 95, s.DurationMinutes())

	before := *s.EndedAt
	s.End(start.Add(5 * time.Hour))
	assert.Equal(t, before, *s.EndedAt, "ending twice keeps the first end")
}

func TestLimitsOfTheSpec(t *testing.T) {
	assert.Equal(t, 100, domain.MaxDecksPerClass) // SPEC-053 RN-07
	assert.Equal(t, 100, domain.MaxPages)
	assert.Equal(t, 12*time.Hour, domain.SafetyNet)
	assert.Equal(t, 15*time.Minute, domain.DownloadURLTTL)
	assert.Equal(t, 50, domain.MaxListedSessions)
}
