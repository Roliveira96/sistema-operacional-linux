package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// The routes of the clearance are gone since SPEC-091 RN-03; what stays is the own access of the student and the counters of the summary.

type countsJSON struct {
	Pending  int `json:"pending"`
	Approved int `json:"approved"`
	Rejected int `json:"rejected"`
}

func toCounts(c service.ClearanceCounts) countsJSON {
	return countsJSON{Pending: c.Pending, Approved: c.Approved, Rejected: c.Rejected}
}

// myAccessResponse is what a student gets about their own access (SPEC-076 RN-09, SPEC-091 RN-03). A test compares its keys with the spec.
type myAccessResponse struct {
	Allowed   bool            `json:"allowed"`
	Reason    domain.Access   `json:"reason"`
	Modality  domain.Modality `json:"modality"`
	ServerNow string          `json:"serverNow"`
}

func (h *Handler) myAccess(c *gin.Context) {
	actor, ok := actorOf(c)
	if !ok {
		return
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return
	}
	id, ok := uuidParam(c, "assessmentId")
	if !ok {
		return
	}
	got, err := h.svc.MyAccess(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, myAccessResponse{Allowed: got.Allowed, Reason: got.Reason, Modality: got.Modality, ServerNow: iso(h.svc.Now())})
}
