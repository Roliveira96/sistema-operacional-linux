package handler_test

import (
	"bytes"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Covers SPEC-071 CA-02, CA-03, CA-04, CA-10: REST routes for listing, creating, updating and deleting atomic note blocks.
func TestNoteBlocksRoutes(t *testing.T) {
	w := setup(t)
	sid := w.session.ID.String()
	bid := uuid.New()
	now := time.Date(2026, 10, 16, 10, 14, 22, 0, time.UTC)
	edited := now.Add(50 * time.Second)

	// POST create block -> 201 Created
	w.svc.noteBlock = domain.LiveClassroomNoteBlock{
		Model:           database.Model{ID: bid, CreatedAt: now, UpdatedAt: now},
		SessionID:       w.session.ID,
		StudentID:       w.student.UserID,
		ContentMarkdown: "O comando `sudo` eleva privilégios.",
	}
	code, body := w.call(t, "student", http.MethodPost, w.path("/sessions/"+sid+"/note-blocks"), obj{"contentMarkdown": "O comando `sudo` eleva privilégios."})
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, bid.String(), body["id"])
	assert.Equal(t, "O comando `sudo` eleva privilégios.", body["contentMarkdown"])
	assert.NotEmpty(t, body["createdAt"])
	assert.NotEmpty(t, body["updatedAt"])

	// GET list blocks -> 200 OK
	w.svc.noteBlocks = []domain.LiveClassroomNoteBlock{w.svc.noteBlock}
	code, body = w.call(t, "student", http.MethodGet, w.path("/sessions/"+sid+"/note-blocks"), nil)
	require.Equal(t, http.StatusOK, code)
	items := body["items"].([]any)
	require.Len(t, items, 1)
	first := items[0].(map[string]any)
	assert.Equal(t, bid.String(), first["id"])
	assert.Equal(t, "O comando `sudo` eleva privilégios.", first["contentMarkdown"])

	// PATCH update block -> 200 OK
	w.svc.noteBlock.ContentMarkdown = "Texto atualizado"
	w.svc.noteBlock.UpdatedAt = edited
	code, body = w.call(t, "student", http.MethodPatch, w.path("/sessions/"+sid+"/note-blocks/"+bid.String()), obj{"contentMarkdown": "Texto atualizado"})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "Texto atualizado", body["contentMarkdown"])

	// DELETE block -> 204 No Content
	code, _ = w.call(t, "student", http.MethodDelete, w.path("/sessions/"+sid+"/note-blocks/"+bid.String()), nil)
	require.Equal(t, http.StatusNoContent, code)

	// Error mappings: 400 validation, 403 forbidden, 404 note-block-not-found
	w.svc.err = &domain.FieldError{Field: "contentMarkdown", Err: domain.ErrEmptyNoteBlock}
	code, body = w.call(t, "student", http.MethodPost, w.path("/sessions/"+sid+"/note-blocks"), obj{"contentMarkdown": "   "})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "validation-error", body["type"])

	w.svc.err = domain.ErrForbidden
	code, body = w.call(t, "second", http.MethodPatch, w.path("/sessions/"+sid+"/note-blocks/"+bid.String()), obj{"contentMarkdown": "x"})
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", body["type"])

	w.svc.err = domain.ErrNoteBlockNotFound
	code, body = w.call(t, "student", http.MethodDelete, w.path("/sessions/"+sid+"/note-blocks/"+bid.String()), nil)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "note-block-not-found", body["type"])
}

// Covers SPEC-071 CA-10, CA-11, CA-12: POST /note-images and GET /media/notes/:imageId proxy authentication and streaming.
func TestNoteImagesUploadAndMediaProxyRoutes(t *testing.T) {
	w := setup(t)
	sid := w.session.ID.String()
	imgID := uuid.New()
	avif := append([]byte{0x00, 0x00, 0x00, 0x1c, 'f', 't', 'y', 'p', 'a', 'v', 'i', 'f', 0x00, 0x00, 0x00, 0x00}, []byte("avif-content")...)

	w.svc.noteImage = service.NoteImageCreated{
		ImageID:   imgID,
		AccessURL: "/api/v1/media/notes/" + imgID.String(),
	}
	code, body := w.call(t, "student", http.MethodPost, w.path("/sessions/"+sid+"/note-images"), multipartBody(t, map[string]string{"width": "1220", "height": "680"}, avif))
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, imgID.String(), body["imageId"])
	assert.Equal(t, "/api/v1/media/notes/"+imgID.String(), body["accessUrl"])
	assert.Equal(t, avif, w.svc.uploaded)

	// GET /api/v1/media/notes/:imageId streams bytes with private cache headers to the owner (CA-11).
	w.svc.noteStream = service.NoteImageStream{
		Image: domain.LiveClassroomNoteImage{
			Model:     database.Model{ID: imgID},
			StudentID: w.student.UserID,
			MimeType:  "image/avif",
			SizeBytes: int64(len(avif)),
		},
		Body: io.NopCloser(bytes.NewReader(avif)),
	}
	req, err := http.NewRequest(http.MethodGet, w.srv.URL+"/api/v1/media/notes/"+imgID.String(), nil)
	require.NoError(t, err)
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "student"})
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	streamed, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "image/avif", res.Header.Get("Content-Type"))
	assert.Equal(t, "private, max-age=86400", res.Header.Get("Cache-Control"))
	assert.Equal(t, "nosniff", res.Header.Get("X-Content-Type-Options"))
	assert.Equal(t, avif, streamed)

	// Forbidden for another student (CA-10).
	w.svc.err = domain.ErrForbidden
	code, body = w.call(t, "second", http.MethodGet, "/api/v1/media/notes/"+imgID.String(), nil)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", body["type"])

	// Not found when revoked or unknown.
	w.svc.err = domain.ErrNoteImageNotFound
	code, body = w.call(t, "student", http.MethodGet, "/api/v1/media/notes/"+imgID.String(), nil)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "note-image-not-found", body["type"])
}
