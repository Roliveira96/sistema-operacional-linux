package handler

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

type createEnvironmentRequest struct {
	Snapshot json.RawMessage `json:"snapshot"`
}

// createEnvironment records the machine an author prepared: POST /teacher/modules/{id}/environments (SPEC-020 5.1).
func (h *AuthorHandler) createEnvironment(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req createEnvironmentRequest
	if !bindBody(c, &req) {
		return
	}
	if len(req.Snapshot) == 0 || string(req.Snapshot) == "null" {
		authFail(c, problem.Validation("The environment is required.", problem.InvalidParam{Name: "snapshot", Reason: "required"}))
		return
	}
	scenarioID, err := h.author.CreateEnvironment(c.Request.Context(), who, id, req.Snapshot)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"scenarioId": scenarioID})
}

// environment reads a recorded machine: GET /teacher/environments/{scenarioId} (SPEC-020 5.2).
func (h *AuthorHandler) environment(c *gin.Context) {
	scenarioID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		authFail(c, problem.NotFound("scenario-not-found", "The environment does not exist."))
		return
	}
	snapshot, err := h.author.Environment(c.Request.Context(), scenarioID)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"scenarioId": scenarioID, "snapshot": snapshot})
}
