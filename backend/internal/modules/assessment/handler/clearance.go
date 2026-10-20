package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// ---- what the routes answer (SPEC-076 section 5) ----

type countsJSON struct {
	Pending  int `json:"pending"`
	Approved int `json:"approved"`
	Rejected int `json:"rejected"`
}

func toCounts(c service.ClearanceCounts) countsJSON {
	return countsJSON{Pending: c.Pending, Approved: c.Approved, Rejected: c.Rejected}
}

type clearanceItemJSON struct {
	StudentID       uuid.UUID              `json:"studentId"`
	Name            string                 `json:"name"`
	AcademicID      string                 `json:"academicId"`
	Status          domain.ClearanceStatus `json:"status"`
	RejectionReason *string                `json:"rejectionReason,omitempty"`
	ClearedAt       *string                `json:"clearedAt,omitempty"`
	ClearedByName   string                 `json:"clearedByName,omitempty"`
}

type clearanceListResponse struct {
	RequiresClearance bool                `json:"requiresClearance"`
	Items             []clearanceItemJSON `json:"items"`
	Counts            countsJSON          `json:"counts"`
	ServerNow         string              `json:"serverNow"`
}

func toClearanceList(l service.ClearanceList, now string) clearanceListResponse {
	out := clearanceListResponse{RequiresClearance: l.RequiresClearance, Items: make([]clearanceItemJSON, len(l.Items)), Counts: toCounts(l.Counts), ServerNow: now}
	for i, it := range l.Items {
		out.Items[i] = clearanceItemJSON{
			StudentID: it.StudentID, Name: it.Name, AcademicID: it.AcademicID, Status: it.Status, RejectionReason: it.RejectionReason,
			ClearedAt: isoPtr(it.ClearedAt), ClearedByName: it.ClearedByName,
		}
	}
	return out
}

// ownClearanceJSON is the state of the student who asks, and nobody else's (RN-10).
type ownClearanceJSON struct {
	Status          domain.ClearanceStatus `json:"status"`
	RejectionReason *string                `json:"rejectionReason,omitempty"`
}

// myAccessResponse is the only thing a student gets about the clearance. A test compares its keys with the list of the spec.
type myAccessResponse struct {
	Allowed           bool              `json:"allowed"`
	Reason            domain.Access     `json:"reason"`
	Modality          domain.Modality   `json:"modality"`
	RequiresClearance bool              `json:"requiresClearance"`
	Clearance         *ownClearanceJSON `json:"clearance,omitempty"`
	ServerNow         string            `json:"serverNow"`
}

// ---- reading the request ----

type decisionRequest struct {
	StudentID       string `json:"studentId"`
	Status          string `json:"status"`
	RejectionReason string `json:"rejectionReason"`
}

type clearanceRequest struct {
	Action   string            `json:"action"`
	Students []decisionRequest `json:"students"`
}

// parseDecisions reads the students of an update. A state that does not exist or an id that is no UUID cannot be read; one that exists and is not a
// decision (waiting) is the service's to refuse.
func parseDecisions(raw []decisionRequest) ([]service.ClearanceDecision, bool) {
	out := make([]service.ClearanceDecision, len(raw))
	for i, r := range raw {
		id, ok := parseUUID(r.StudentID)
		status := domain.ClearanceStatus(r.Status)
		if !ok || (status != domain.ClearancePending && status != domain.ClearanceApproved && status != domain.ClearanceRejected) {
			return nil, false
		}
		out[i] = service.ClearanceDecision{StudentID: id, Status: status, Reason: r.RejectionReason}
	}
	return out, true
}

// ---- the routes ----

func (h *Handler) clearances(c *gin.Context) {
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
	got, err := h.svc.Clearances(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, toClearanceList(got, iso(h.svc.Now())))
}

func (h *Handler) decide(c *gin.Context) {
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
	var req clearanceRequest
	if !bind(c, &req) {
		return
	}
	in := service.ClearanceInput{Action: service.ClearanceAction(req.Action)}
	if in.Action == service.ClearanceUpdate { // the list is ignored with APPROVE_ALL
		var ok bool
		if in.Students, ok = parseDecisions(req.Students); !ok {
			malformed(c)
			return
		}
	}
	got, err := h.svc.Decide(c.Request.Context(), actor, classID, id, in)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, toClearanceList(got, iso(h.svc.Now())))
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
	out := myAccessResponse{Allowed: got.Allowed, Reason: got.Reason, Modality: got.Modality, RequiresClearance: got.RequiresClearance, ServerNow: iso(h.svc.Now())}
	if got.Clearance != nil {
		out.Clearance = &ownClearanceJSON{Status: got.Clearance.Status, RejectionReason: got.Clearance.RejectionReason}
	}
	c.JSON(http.StatusOK, out)
}
