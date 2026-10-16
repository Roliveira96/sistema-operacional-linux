package service_test

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

var (
	avifBytes = append([]byte{0x00, 0x00, 0x00, 0x1c, 'f', 't', 'y', 'p', 'a', 'v', 'i', 'f', 0x00, 0x00, 0x00, 0x00}, bytes.Repeat([]byte{0x42}, 128)...)
)

// Covers SPEC-071 CA-02, CA-03, CA-04, CA-10 (RN-01 to RN-04, RN-08): atomic note blocks CRUD, chronological order, ownership privacy,
// soft deletion and hasNotes indicator in ListSessions.
func TestNoteBlocksCRUDAndPrivacy(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)

	friend := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.repo.students[w.class][friend.UserID] = true
	w.admit(s.ID, friend.UserID)

	// Create two blocks at different moments.
	b1, err := w.svc.CreateNoteBlock(ctx, w.student, w.class, s.ID, "Primeiro bloco: `ls -la`")
	require.NoError(t, err)
	assert.Equal(t, "Primeiro bloco: `ls -la`", b1.ContentMarkdown)
	assert.Equal(t, w.now, b1.CreatedAt)
	assert.Equal(t, w.now, b1.UpdatedAt)

	w.now = w.now.Add(2 * time.Minute)
	b2, err := w.svc.CreateNoteBlock(ctx, w.student, w.class, s.ID, "Segundo bloco: **permissões**")
	require.NoError(t, err)

	// List returns blocks in chronological order for the author, and empty for another student.
	list, err := w.svc.ListNoteBlocks(ctx, w.student, w.class, s.ID)
	require.NoError(t, err)
	require.Len(t, list, 2)
	assert.Equal(t, b1.ID, list[0].ID)
	assert.Equal(t, b2.ID, list[1].ID)

	friendList, err := w.svc.ListNoteBlocks(ctx, friend, w.class, s.ID)
	require.NoError(t, err)
	assert.Empty(t, friendList)

	// Teacher, admin and non-enrolled student cannot list or create note blocks (RN-01).
	for _, who := range []service.Actor{w.teacher, w.admin, w.outside} {
		_, err = w.svc.ListNoteBlocks(ctx, who, w.class, s.ID)
		assert.ErrorIs(t, err, domain.ErrForbidden)
		_, err = w.svc.CreateNoteBlock(ctx, who, w.class, s.ID, "x")
		assert.ErrorIs(t, err, domain.ErrForbidden)
	}

	// Update updates content and updatedAt; another student gets ErrForbidden (CA-03, CA-10).
	w.now = w.now.Add(3 * time.Minute)
	updated, err := w.svc.UpdateNoteBlock(ctx, w.student, w.class, s.ID, b1.ID, "Primeiro bloco editado")
	require.NoError(t, err)
	assert.Equal(t, "Primeiro bloco editado", updated.ContentMarkdown)
	assert.Equal(t, w.now, updated.UpdatedAt)
	assert.True(t, updated.UpdatedAt.After(updated.CreatedAt))

	_, err = w.svc.UpdateNoteBlock(ctx, friend, w.class, s.ID, b1.ID, "invasão")
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.UpdateNoteBlock(ctx, w.student, w.class, s.ID, uuid.New(), "inexistente")
	assert.ErrorIs(t, err, domain.ErrNoteBlockNotFound)

	// Validation errors on create and update.
	_, err = w.svc.CreateNoteBlock(ctx, w.student, w.class, s.ID, "   ")
	assert.ErrorIs(t, err, domain.ErrEmptyNoteBlock)
	_, err = w.svc.UpdateNoteBlock(ctx, w.student, w.class, s.ID, b1.ID, strings.Repeat("x", domain.MaxNoteLength+1))
	assert.ErrorIs(t, err, domain.ErrContentTooLong)

	// ListSessions reports hasNotes = true for the student who created blocks (RN-08).
	summaries, err := w.svc.ListSessions(ctx, w.student, w.class)
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.True(t, summaries[0].HasNotes)

	// Delete removes the block only for its owner (CA-04, CA-10).
	err = w.svc.DeleteNoteBlock(ctx, friend, w.class, s.ID, b1.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)

	require.NoError(t, w.svc.DeleteNoteBlock(ctx, w.student, w.class, s.ID, b1.ID))
	list, err = w.svc.ListNoteBlocks(ctx, w.student, w.class, s.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, b2.ID, list[0].ID)

	err = w.svc.DeleteNoteBlock(ctx, w.student, w.class, s.ID, b1.ID)
	assert.ErrorIs(t, err, domain.ErrNoteBlockNotFound)
}

// Covers SPEC-071 CA-04, CA-10, CA-11, CA-12 (RN-04 to RN-07): private image upload to MinIO, linking to note block,
// authenticated media proxy restricted to the author, and revocation when the block is deleted.
func TestNoteImagesUploadAndProxyAuth(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.admit(s.ID, w.student.UserID)

	friend := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.repo.students[w.class][friend.UserID] = true
	w.admit(s.ID, friend.UserID)

	// Upload a valid AVIF image.
	created, err := w.svc.UploadNoteImage(ctx, w.student, w.class, s.ID, service.NoteImageInput{
		OriginalName: "print.png",
		Width:        1220,
		Height:       680,
		Size:         int64(len(avifBytes)),
		File:         bytes.NewReader(avifBytes),
	})
	require.NoError(t, err)
	assert.NotEqual(t, uuid.Nil, created.ImageID)
	assert.Equal(t, "/api/v1/media/notes/"+created.ImageID.String(), created.AccessURL)

	expectedKey := "notes/" + w.student.UserID.String() + "/" + created.ImageID.String() + ".avif"
	assert.Equal(t, avifBytes, w.store.body[expectedKey])

	// Proxy streams bytes to the student owner (CA-11).
	stream, err := w.svc.OpenNoteImage(ctx, w.student, created.ImageID)
	require.NoError(t, err)
	body, err := io.ReadAll(stream.Body)
	require.NoError(t, err)
	_ = stream.Body.Close()
	assert.Equal(t, avifBytes, body)
	assert.Equal(t, "image/avif", stream.Image.MimeType)

	// Another student, the teacher, or an admin gets 403 ErrForbidden (CA-10).
	for _, who := range []service.Actor{friend, w.teacher, w.admin, w.outside} {
		_, err = w.svc.OpenNoteImage(ctx, who, created.ImageID)
		assert.ErrorIs(t, err, domain.ErrForbidden)
	}

	// Non-existent image returns ErrNoteImageNotFound.
	_, err = w.svc.OpenNoteImage(ctx, w.student, uuid.New())
	assert.ErrorIs(t, err, domain.ErrNoteImageNotFound)

	// Creating a note block referencing the image links the image to the block; deleting the block revokes the image (CA-04, RN-04, RN-06).
	block, err := w.svc.CreateNoteBlock(ctx, w.student, w.class, s.ID, "Veja o print:\n\n![Print]("+created.AccessURL+")")
	require.NoError(t, err)
	require.NoError(t, w.svc.DeleteNoteBlock(ctx, w.student, w.class, s.ID, block.ID))

	_, err = w.svc.OpenNoteImage(ctx, w.student, created.ImageID)
	assert.ErrorIs(t, err, domain.ErrNoteImageNotFound, "image access is revoked when its note block is deleted")
}
