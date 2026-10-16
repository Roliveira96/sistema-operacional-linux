package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

func noteBlockJSON(b domain.LiveClassroomNoteBlock) gin.H {
	return gin.H{
		"id":              b.ID,
		"contentMarkdown": b.ContentMarkdown,
		"createdAt":       b.CreatedAt.UTC(),
		"updatedAt":       b.UpdatedAt.UTC(),
	}
}

func (h *Handler) listNoteBlocks(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	blocks, err := h.svc.ListNoteBlocks(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	items := make([]gin.H, 0, len(blocks))
	for _, b := range blocks {
		items = append(items, noteBlockJSON(b))
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) createNoteBlock(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	var req struct {
		ContentMarkdown *string `json:"contentMarkdown"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ContentMarkdown == nil {
		fail(c, problem.Validation("Validation failed.", problem.InvalidParam{Name: "contentMarkdown", Reason: "required"}))
		return
	}
	block, err := h.svc.CreateNoteBlock(c.Request.Context(), actor, classID, sessionID, *req.ContentMarkdown)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, noteBlockJSON(block))
}

func (h *Handler) updateNoteBlock(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	blockID, ok := uuidParam(c, c.Param("blockId"), "blockId")
	if !ok {
		return
	}
	var req struct {
		ContentMarkdown *string `json:"contentMarkdown"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ContentMarkdown == nil {
		fail(c, problem.Validation("Validation failed.", problem.InvalidParam{Name: "contentMarkdown", Reason: "required"}))
		return
	}
	block, err := h.svc.UpdateNoteBlock(c.Request.Context(), actor, classID, sessionID, blockID, *req.ContentMarkdown)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, noteBlockJSON(block))
}

func (h *Handler) deleteNoteBlock(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	blockID, ok := uuidParam(c, c.Param("blockId"), "blockId")
	if !ok {
		return
	}
	if err := h.svc.DeleteNoteBlock(c.Request.Context(), actor, classID, sessionID, blockID); err != nil {
		fail(c, toProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) uploadNoteImage(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, domain.MaxNoteImageBytes+1024*1024)
	fh, err := c.FormFile("file")
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			fail(c, problem.PayloadTooLarge(domain.ErrFileTooLarge.Error()))
			return
		}
		fail(c, problem.Validation("Validation failed.", problem.InvalidParam{Name: "file", Reason: "required"}))
		return
	}
	f, err := fh.Open()
	if err != nil {
		fail(c, problem.Internal())
		return
	}
	defer f.Close()

	width, _ := strconv.Atoi(c.PostForm("width"))
	height, _ := strconv.Atoi(c.PostForm("height"))

	created, err := h.svc.UploadNoteImage(c.Request.Context(), actor, classID, sessionID, service.NoteImageInput{
		File:         f,
		Size:         fh.Size,
		OriginalName: fh.Filename,
		Width:        width,
		Height:       height,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"imageId":   created.ImageID,
		"accessUrl": created.AccessURL,
	})
}

func (h *Handler) getNoteImage(c *gin.Context) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}
	imageID, ok := uuidParam(c, c.Param("imageId"), "imageId")
	if !ok {
		return
	}
	actor := service.Actor{UserID: p.UserID, Role: p.Role}
	stream, err := h.svc.OpenNoteImage(c.Request.Context(), actor, imageID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	defer stream.Body.Close()

	c.Header("Cache-Control", "private, max-age=86400")
	c.Header("X-Content-Type-Options", "nosniff")
	c.DataFromReader(http.StatusOK, stream.Image.SizeBytes, stream.Image.MimeType, stream.Body, nil)
}
