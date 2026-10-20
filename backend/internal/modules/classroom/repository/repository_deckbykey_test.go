package repository_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-074 RN-08: the presentation of a class that points to a file is found by the class and the key of the object; one of another class,
// another file or one that was deleted is not found.
func TestFindDeckByObjectKey(t *testing.T) {
	e := newEnv(t)
	key := "classes/x/sessions/y/materials/slides.pdf"
	deck := domain.SlideDeck{ClassID: e.class.ID, UploadedBy: e.teacher.ID, Title: "Slides 01", ObjectKey: key, PageCount: 12}
	require.NoError(t, e.repo.CreateDeck(e.ctx, &deck))

	got, err := e.repo.FindDeckByObjectKey(e.ctx, e.class.ID, key)
	require.NoError(t, err)
	assert.Equal(t, deck.ID, got.ID)

	_, err = e.repo.FindDeckByObjectKey(e.ctx, uuid.New(), key)
	assert.ErrorIs(t, err, domain.ErrDeckNotFound, "of another class")
	_, err = e.repo.FindDeckByObjectKey(e.ctx, e.class.ID, "classes/x/other.pdf")
	assert.ErrorIs(t, err, domain.ErrDeckNotFound, "another file")

	require.NoError(t, e.db.Conn(e.ctx).Exec("UPDATE slide_decks SET deleted_at = NOW() WHERE id = ?", deck.ID).Error)
	_, err = e.repo.FindDeckByObjectKey(e.ctx, e.class.ID, key)
	assert.ErrorIs(t, err, domain.ErrDeckNotFound, "deleted")
}
