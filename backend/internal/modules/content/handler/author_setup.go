package handler

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

// putSetup stores the snapshot of the module: PUT /teacher/modules/{id}/setup (SPEC-021 6).
func (h *AuthorHandler) putSetup(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var raw json.RawMessage
	if !bindBody(c, &raw) {
		return
	}
	setup, err := h.author.SetSetup(c.Request.Context(), who, id, raw)
	if err != nil {
		authorFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "setup": setup})
}
