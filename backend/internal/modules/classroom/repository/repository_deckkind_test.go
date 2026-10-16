package repository_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-068 section 4: a presentation has a kind, PDF or IMAGE; one saved with none (the rows that were there before, and the uploads of the PDF
// that do not say it) is a PDF, and both kinds count for the limit of the class.
func TestSlideDeck_Kind(t *testing.T) {
	e := newEnv(t)
	pdf := domain.SlideDeck{ClassID: e.class.ID, UploadedBy: e.teacher.ID, Title: "Slides", ObjectKey: "classes/x/decks/a.pdf", PageCount: 10}
	picture := domain.SlideDeck{ClassID: e.class.ID, UploadedBy: e.teacher.ID, Title: "Esquema", ObjectKey: "classes/x/decks/b.png", PageCount: 1, Kind: domain.KindImage}
	require.NoError(t, e.repo.CreateDeck(e.ctx, &pdf))
	require.NoError(t, e.repo.CreateDeck(e.ctx, &picture))

	got, err := e.repo.FindDeck(e.ctx, pdf.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.KindPDF, got.Kind, "the default of the database")
	got, err = e.repo.FindDeck(e.ctx, picture.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.KindImage, got.Kind)

	list, err := e.repo.ListDecks(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, list, 2)
	kinds := map[string]string{}
	for _, d := range list {
		kinds[d.Title] = d.Kind
	}
	assert.Equal(t, map[string]string{"Slides": domain.KindPDF, "Esquema": domain.KindImage}, kinds)

	n, err := e.repo.CountDecks(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n, "an image takes one of the presentations of the class")
}

// Covers SPEC-068 section 4: only the two kinds exist, kept by the database.
func TestSlideDeck_KindIsKeptByTheDatabase(t *testing.T) {
	e := newEnv(t)
	bad := domain.SlideDeck{ClassID: e.class.ID, UploadedBy: e.teacher.ID, Title: "x", ObjectKey: "classes/x/decks/c.gif", PageCount: 1, Kind: "GIF"}
	assert.Error(t, e.repo.CreateDeck(e.ctx, &bad))
}
