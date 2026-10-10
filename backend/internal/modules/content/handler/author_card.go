package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

type cardBlockRequest struct {
	ID        *uuid.UUID      `json:"id"`
	UpdatedAt *time.Time      `json:"updatedAt"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type saveCardRequest struct {
	ReplaceIDs   []uuid.UUID        `json:"replaceIds"`
	AfterBlockID *uuid.UUID         `json:"afterBlockId"`
	Force        bool               `json:"force"`
	Blocks       []cardBlockRequest `json:"blocks"`
}

// saveCard stores a whole card: PUT /teacher/modules/{id}/cards (SPEC-019 5.7).
func (h *AuthorHandler) saveCard(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req saveCardRequest
	if !bindBody(c, &req) {
		return
	}
	in := service.SaveCardInput{ReplaceIDs: req.ReplaceIDs, AfterID: req.AfterBlockID, Force: req.Force}
	for _, b := range req.Blocks {
		in.Blocks = append(in.Blocks, service.CardBlock{ID: b.ID, UpdatedAt: b.UpdatedAt, Type: domain.BlockType(b.Type), Payload: b.Payload})
	}
	blocks, err := h.author.SaveCard(c.Request.Context(), who, id, in)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "blocks": toAuthoredList(blocks)})
}

type cardActiveRequest struct {
	BlockIDs []uuid.UUID `json:"blockIds"`
	Active   *bool       `json:"active"`
}

// setCardActive inactivates or reactivates the blocks of a card: PUT /teacher/modules/{id}/cards/active (SPEC-019 5.8).
func (h *AuthorHandler) setCardActive(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req cardActiveRequest
	if !bindBody(c, &req) {
		return
	}
	if req.Active == nil || len(req.BlockIDs) == 0 {
		authFail(c, problem.Validation("The blocks and the new situation are required.",
			problem.InvalidParam{Name: "blockIds", Reason: "required"}, problem.InvalidParam{Name: "active", Reason: "required"}))
		return
	}
	blocks, err := h.author.SetActiveMany(c.Request.Context(), who, id, req.BlockIDs, *req.Active)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "blocks": toAuthoredList(blocks)})
}
