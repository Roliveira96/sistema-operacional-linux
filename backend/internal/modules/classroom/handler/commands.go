package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// commands reads the commands the teacher ran in a room of the class, in the order they ran (SPEC-071 section 5).
func (h *Handler) commands(c *gin.Context) {
	actor, classID, ok := requestOf(c)
	if !ok {
		return
	}
	sessionID, ok := uuidParam(c, c.Param("sessionId"), "sessionId")
	if !ok {
		return
	}
	list, err := h.svc.ListCommands(c.Request.Context(), actor, classID, sessionID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, cmd := range list {
		out = append(out, gin.H{
			"terminal": cmd.Terminal, "command": cmd.Command, "exitStatus": cmd.ExitStatus, "output": cmd.Output,
			"outputTruncated": cmd.OutputTruncated, "ranAt": cmd.RanAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"sessionId": sessionID, "commands": out})
}
