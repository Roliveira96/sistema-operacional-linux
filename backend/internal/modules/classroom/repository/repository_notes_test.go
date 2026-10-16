package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-071 CA-02, CA-03, CA-04: persistence of atomic note blocks and private note images, chronological ordering,
// linking images to a block, soft-deleting a block with image revocation, and SessionsWithNotes.
func TestNoteBlocksAndImagesRepository(t *testing.T) {
	e := newEnv(t)
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	otherStudent := e.newStudent(t, "1000002", "Bruno")

	b1 := domain.LiveClassroomNoteBlock{
		SessionID:       s.ID,
		StudentID:       e.student.ID,
		ContentMarkdown: "Bloco 1: `whoami`",
	}
	require.NoError(t, e.repo.CreateNoteBlock(e.ctx, &b1))
	require.NotEqual(t, uuid.Nil, b1.ID)

	b2 := domain.LiveClassroomNoteBlock{
		SessionID:       s.ID,
		StudentID:       e.student.ID,
		ContentMarkdown: "Bloco 2: **root**",
	}
	require.NoError(t, e.repo.CreateNoteBlock(e.ctx, &b2))

	// List returns blocks in chronological order only for the student who owns them.
	blocks, err := e.repo.ListNoteBlocks(e.ctx, s.ID, e.student.ID)
	require.NoError(t, err)
	require.Len(t, blocks, 2)
	assert.Equal(t, b1.ID, blocks[0].ID)
	assert.Equal(t, b2.ID, blocks[1].ID)

	otherBlocks, err := e.repo.ListNoteBlocks(e.ctx, s.ID, otherStudent.ID)
	require.NoError(t, err)
	assert.Empty(t, otherBlocks)

	// SessionsWithNotes reports true when the student has note blocks.
	withNotes, err := e.repo.SessionsWithNotes(e.ctx, e.student.ID, []uuid.UUID{s.ID})
	require.NoError(t, err)
	assert.True(t, withNotes[s.ID])

	// Update block content.
	b1.ContentMarkdown = "Bloco 1 atualizado"
	require.NoError(t, e.repo.SaveNoteBlock(e.ctx, &b1))
	foundBlock, err := e.repo.FindNoteBlock(e.ctx, b1.ID)
	require.NoError(t, err)
	assert.Equal(t, "Bloco 1 atualizado", foundBlock.ContentMarkdown)

	// Create image and link it to b1.
	img := domain.LiveClassroomNoteImage{
		SessionID:    s.ID,
		StudentID:    e.student.ID,
		ObjectKey:    "notes/" + e.student.ID.String() + "/capture.avif",
		OriginalName: "capture.png",
		MimeType:     "image/avif",
		Width:        1220,
		Height:       680,
		SizeBytes:    4096,
	}
	require.NoError(t, e.repo.CreateNoteImage(e.ctx, &img))
	require.NoError(t, e.repo.LinkNoteImages(e.ctx, s.ID, e.student.ID, b1.ID, []uuid.UUID{img.ID}))

	gotImg, err := e.repo.FindNoteImage(e.ctx, img.ID)
	require.NoError(t, err)
	require.NotNil(t, gotImg.NoteBlockID)
	assert.Equal(t, b1.ID, *gotImg.NoteBlockID)

	// Soft-deleting b1 also revokes its linked image.
	require.NoError(t, e.repo.DeleteNoteBlock(e.ctx, b1.ID, time.Now().UTC()))
	_, err = e.repo.FindNoteBlock(e.ctx, b1.ID)
	assert.ErrorIs(t, err, domain.ErrNoteBlockNotFound)
	_, err = e.repo.FindNoteImage(e.ctx, img.ID)
	assert.ErrorIs(t, err, domain.ErrNoteImageNotFound)

	remaining, err := e.repo.ListNoteBlocks(e.ctx, s.ID, e.student.ID)
	require.NoError(t, err)
	require.Len(t, remaining, 1)
	assert.Equal(t, b2.ID, remaining[0].ID)
}
