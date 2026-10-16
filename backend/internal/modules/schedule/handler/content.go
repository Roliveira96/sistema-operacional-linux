package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
)

type contentRequest struct {
	Topic       string  `json:"topic"`
	Description string  `json:"description"`
	ModuleID    *string `json:"moduleId"`
	DeckID      *string `json:"deckId"`
	Links       []struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	} `json:"links"`
	TeacherNotes        string `json:"teacherNotes"`
	TeacherPrivateNotes string `json:"teacherPrivateNotes"`
}

type contentModuleJSON struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}

type contentDeckJSON struct {
	ID          uuid.UUID `json:"id"`
	Title       string    `json:"title"`
	PageCount   int       `json:"pageCount"`
	DownloadURL string    `json:"downloadUrl"`
}

type contentLinkJSON struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Position int    `json:"position"`
}

type contentJSON struct {
	Topic       string             `json:"topic"`
	Description string             `json:"description"`
	Module      *contentModuleJSON `json:"module"`
	Deck        *contentDeckJSON   `json:"deck"`
	Links       []contentLinkJSON  `json:"links"`
	// The notes of the teacher (SPEC-073): the private ones are left out for who may not read them.
	TeacherNotes        string  `json:"teacherNotes"`
	TeacherPrivateNotes *string `json:"teacherPrivateNotes,omitempty"`
}

func toContentJSON(c service.SessionContent) contentJSON {
	out := contentJSON{Topic: c.Topic, Description: c.Description, Links: []contentLinkJSON{}, TeacherNotes: c.TeacherNotes, TeacherPrivateNotes: c.TeacherPrivateNotes}
	if c.Module != nil {
		out.Module = &contentModuleJSON{ID: c.Module.ID, Title: c.Module.Title}
	}
	if c.Deck != nil {
		out.Deck = &contentDeckJSON{ID: c.Deck.ID, Title: c.Deck.Title, PageCount: c.Deck.PageCount, DownloadURL: c.Deck.DownloadURL}
	}
	for _, l := range c.Links {
		out.Links = append(out.Links, contentLinkJSON{Name: l.Name, URL: l.URL, Position: l.Position})
	}
	return out
}

// optionalUUID reads an identifier that may be absent or empty; a bad one is a problem of the content (SPEC-053 section 5).
func optionalUUID(field string, raw *string) (*uuid.UUID, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	id, err := uuid.Parse(strings.TrimSpace(*raw))
	if err != nil {
		return nil, &domain.FieldError{Field: field, Err: domain.ErrInvalidSessionContent}
	}
	return &id, nil
}

func (h *Handler) saveContent(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, "sessionId")
	if !ok {
		return
	}
	var req contentRequest
	if !bindJSON(c, &req) {
		return
	}
	moduleID, err := optionalUUID("moduleId", req.ModuleID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	deckID, err := optionalUUID("deckId", req.DeckID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	in := service.ContentInput{Topic: req.Topic, Description: req.Description, ModuleID: moduleID, DeckID: deckID,
		TeacherNotes: req.TeacherNotes, TeacherPrivateNotes: req.TeacherPrivateNotes}
	for _, l := range req.Links {
		in.Links = append(in.Links, domain.LinkInput{Name: l.Name, URL: l.URL})
	}
	saved, err := h.svc.SaveContent(c.Request.Context(), actor, classID, sessionID, in)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toContentJSON(saved))
}

func (h *Handler) content(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, "sessionId")
	if !ok {
		return
	}
	got, err := h.svc.Content(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toContentJSON(got))
}
