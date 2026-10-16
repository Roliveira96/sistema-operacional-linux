package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// The materials of a lesson (SPEC-074, section 5). The instants carry the offset of the schedule (SPEC-042 RN-13); the key of the object in
// the bucket is never sent.

// maxMaterialRequest is the most a request of a file may have: the biggest file (25 MB, a PDF) and what else goes in the form.
const maxMaterialRequest = 26 << 20

type materialJSON struct {
	ID          uuid.UUID  `json:"id"`
	Position    int        `json:"position"`
	Title       string     `json:"title"`
	Kind        string     `json:"kind"`
	Visibility  string     `json:"visibility"`
	ReleaseAt   *time.Time `json:"releaseAt"`
	Source      string     `json:"source"`
	URL         *string    `json:"url,omitempty"`
	FileName    *string    `json:"fileName,omitempty"`
	ContentType *string    `json:"contentType,omitempty"`
	SizeBytes   *int64     `json:"sizeBytes,omitempty"`
	PageCount   *int       `json:"pageCount,omitempty"`
	// Only for who reads them all (the teacher and the administrator): a student gets what is visible, so there is nothing to tell. HiddenUntil
	// is one of CLASS_START, CLASS_END, CLASS_OVER, CLASS_CANCELED or, for a release, the instant.
	VisibleNow  *bool   `json:"visibleNow,omitempty"`
	HiddenUntil *string `json:"hiddenUntil,omitempty"`
}

func toMaterialJSON(v service.MaterialView, staff bool) materialJSON {
	m := v.ClassSessionMaterial
	out := materialJSON{ID: m.ID, Position: m.Position, Title: m.Title, Kind: string(m.Kind), Visibility: string(m.Visibility), Source: "LINK", URL: m.URL}
	if m.ReleaseAt != nil {
		at := local(*m.ReleaseAt)
		out.ReleaseAt = &at
	}
	if m.IsFile() {
		out.Source, out.FileName, out.ContentType, out.SizeBytes, out.PageCount = "FILE", m.FileName, m.ContentType, m.SizeBytes, m.PageCount
	}
	if staff {
		visible := v.VisibleNow
		out.VisibleNow = &visible
		if v.HiddenUntil != nil {
			until := string(v.HiddenUntil.Reason)
			if v.HiddenUntil.Reason == domain.HiddenUntilRelease && v.HiddenUntil.At != nil {
				until = local(*v.HiddenUntil.At).Format(time.RFC3339)
			}
			out.HiddenUntil = &until
		}
	}
	return out
}

func toMaterialsJSON(list []service.MaterialView, staff bool) []materialJSON {
	out := make([]materialJSON, 0, len(list))
	for _, v := range list {
		out = append(out, toMaterialJSON(v, staff))
	}
	return out
}

func isStaff(actor service.Actor) bool { return actor.Role != authn.RoleStudent }

// instant reads an instant (RFC 3339) of a field; a bad one is a problem of the material.
func instant(field, raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	at, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, &domain.FieldError{Field: field, Err: domain.ErrInvalidMaterial}
	}
	return &at, nil
}

type materialLinkRequest struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	Visibility string `json:"visibility"`
	ReleaseAt  string `json:"releaseAt"`
}

type materialPatchRequest struct {
	Title      *string `json:"title"`
	Kind       *string `json:"kind"`
	Visibility *string `json:"visibility"`
	// absent leaves the release as it is; null clears it
	ReleaseAt json.RawMessage `json:"releaseAt"`
	Position  *int            `json:"position"`
}

// lessonParams reads the class and the lesson of the route.
func lessonParams(c *gin.Context) (service.Actor, uuid.UUID, uuid.UUID, bool) {
	actor, ok := actorOf(c)
	if !ok {
		return service.Actor{}, uuid.Nil, uuid.Nil, false
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return service.Actor{}, uuid.Nil, uuid.Nil, false
	}
	sessionID, ok := uuidParam(c, "sessionId")
	if !ok {
		return service.Actor{}, uuid.Nil, uuid.Nil, false
	}
	return actor, classID, sessionID, true
}

func (h *Handler) materials(c *gin.Context) {
	actor, classID, sessionID, ok := lessonParams(c)
	if !ok {
		return
	}
	list, err := h.svc.Materials(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"materials": toMaterialsJSON(list, isStaff(actor))})
}

func (h *Handler) addFileMaterial(c *gin.Context) {
	actor, classID, sessionID, ok := lessonParams(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxMaterialRequest)
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(c, toProblem(domain.ErrMaterialFileTooLarge))
			return
		}
		fail(c, problem.BadRequest("malformed-request", "Invalid multipart payload."))
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		fail(c, toProblem(&domain.FieldError{Field: "file", Err: domain.ErrInvalidMaterialFile}))
		return
	}
	defer file.Close()
	// Only a PDF has a page count, which the browser reads; an image has none to send.
	pages := 0
	if raw := c.Request.FormValue("pageCount"); raw != "" {
		if pages, err = strconv.Atoi(raw); err != nil {
			fail(c, toProblem(&domain.FieldError{Field: "pageCount", Err: domain.ErrInvalidMaterialFile}))
			return
		}
	}
	releaseAt, err := instant("releaseAt", c.Request.FormValue("releaseAt"))
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	name := header.Filename
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	view, err := h.svc.AddFileMaterial(c.Request.Context(), actor, classID, sessionID, service.FileMaterialInput{
		MaterialInput: domain.MaterialInput{Title: c.Request.FormValue("title"), Kind: domain.MaterialKind(c.Request.FormValue("kind")),
			Visibility: domain.MaterialVisibility(c.Request.FormValue("visibility")), ReleaseAt: releaseAt},
		FileName: name, PageCount: pages, Size: header.Size, File: file,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, toMaterialJSON(view, isStaff(actor)))
}

func (h *Handler) addLinkMaterial(c *gin.Context) {
	actor, classID, sessionID, ok := lessonParams(c)
	if !ok {
		return
	}
	var req materialLinkRequest
	if !bindJSON(c, &req) {
		return
	}
	releaseAt, err := instant("releaseAt", req.ReleaseAt)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	view, err := h.svc.AddLinkMaterial(c.Request.Context(), actor, classID, sessionID, service.LinkMaterialInput{
		MaterialInput: domain.MaterialInput{Title: req.Title, Kind: domain.MaterialKind(req.Kind), Visibility: domain.MaterialVisibility(req.Visibility), ReleaseAt: releaseAt},
		URL:           req.URL,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusCreated, toMaterialJSON(view, isStaff(actor)))
}

func (h *Handler) updateMaterial(c *gin.Context) {
	actor, classID, sessionID, ok := lessonParams(c)
	if !ok {
		return
	}
	materialID, ok := uuidParam(c, "materialId")
	if !ok {
		return
	}
	var req materialPatchRequest
	if !bindJSON(c, &req) {
		return
	}
	change := service.MaterialChange{Title: req.Title, Position: req.Position}
	if req.Kind != nil {
		kind := domain.MaterialKind(*req.Kind)
		change.Kind = &kind
	}
	if req.Visibility != nil {
		phase := domain.MaterialVisibility(*req.Visibility)
		change.Visibility = &phase
	}
	if len(req.ReleaseAt) > 0 {
		change.SetReleaseAt = true
		if string(req.ReleaseAt) != "null" {
			var raw string
			if err := json.Unmarshal(req.ReleaseAt, &raw); err != nil {
				fail(c, toProblem(&domain.FieldError{Field: "releaseAt", Err: domain.ErrInvalidMaterial}))
				return
			}
			releaseAt, err := instant("releaseAt", raw)
			if err != nil {
				fail(c, toProblem(err))
				return
			}
			change.ReleaseAt = releaseAt
		}
	}
	view, err := h.svc.UpdateMaterial(c.Request.Context(), actor, classID, sessionID, materialID, change)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toMaterialJSON(view, isStaff(actor)))
}

func (h *Handler) releaseMaterial(c *gin.Context) {
	actor, classID, sessionID, ok := lessonParams(c)
	if !ok {
		return
	}
	materialID, ok := uuidParam(c, "materialId")
	if !ok {
		return
	}
	view, err := h.svc.ReleaseMaterial(c.Request.Context(), actor, classID, sessionID, materialID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, toMaterialJSON(view, isStaff(actor)))
}

func (h *Handler) deleteMaterial(c *gin.Context) {
	actor, classID, sessionID, ok := lessonParams(c)
	if !ok {
		return
	}
	materialID, ok := uuidParam(c, "materialId")
	if !ok {
		return
	}
	if err := h.svc.DeleteMaterial(c.Request.Context(), actor, classID, sessionID, materialID); err != nil {
		fail(c, toProblem(err))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) materialDownload(c *gin.Context) {
	actor, classID, sessionID, ok := lessonParams(c)
	if !ok {
		return
	}
	materialID, ok := uuidParam(c, "materialId")
	if !ok {
		return
	}
	got, err := h.svc.MaterialDownload(c.Request.Context(), actor, classID, sessionID, materialID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"downloadUrl": got.URL, "expiresAt": local(got.ExpiresAt)})
}
