package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// maxAnswerBody is the largest body of an answer or a check: the machine is up to 256 KiB, with room for the envelope (SPEC-090 RN-04).
const maxAnswerBody = 300 << 10

// attemptIDs reads the actor, the class and the assessment of an attempt route.
func attemptIDs(c *gin.Context) (service.Actor, uuid.UUID, uuid.UUID, bool) {
	actor, ok := actorOf(c)
	if !ok {
		return service.Actor{}, uuid.Nil, uuid.Nil, false
	}
	classID, ok := uuidParam(c, "id")
	if !ok {
		return service.Actor{}, uuid.Nil, uuid.Nil, false
	}
	id, ok := uuidParam(c, "assessmentId")
	return actor, classID, id, ok
}

func positionParam(c *gin.Context) (int, bool) {
	n, err := strconv.Atoi(c.Param("position"))
	if err != nil || n < 1 {
		malformed(c)
		return 0, false
	}
	return n, true
}

// readJSONField reads one field of a JSON body, which must be present (SPEC-090 section 5).
func readJSONField(c *gin.Context, field string) (json.RawMessage, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAnswerBody)
	var body map[string]json.RawMessage
	if err := json.NewDecoder(c.Request.Body).Decode(&body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, problem.PayloadTooLarge("The answer exceeds 256 KB."))
			return nil, false
		}
		malformed(c)
		return nil, false
	}
	value, ok := body[field]
	if !ok || len(value) == 0 || string(value) == "null" {
		malformed(c)
		return nil, false
	}
	return value, true
}

func (h *Handler) attemptJSON(a service.StudentAttempt) gin.H {
	items := make([]gin.H, len(a.Items))
	for i, it := range a.Items {
		item := gin.H{"position": it.Position, "kind": it.Kind, "weight": it.Weight.Float(), "studentView": it.StudentView}
		if len(it.Answer) > 0 {
			item["answer"] = it.Answer
		}
		if it.CheckedSolved != nil {
			item["checkedSolved"] = *it.CheckedSolved
		}
		items[i] = item
	}
	out := gin.H{"id": a.ID, "status": a.Status, "startedAt": iso(a.StartedAt), "deadlineAt": iso(a.DeadlineAt), "serverNow": iso(h.svc.Now()), "items": items}
	if a.SubmittedAt != nil {
		out["submittedAt"] = iso(*a.SubmittedAt)
	}
	return out
}

func (h *Handler) enterAttempt(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	got, created, err := h.svc.EnterAttempt(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	h.cardChanged(c.Request.Context(), id, actor.UserID) // the teacher follows the progress in the room (SPEC-091 RN-04)
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, h.attemptJSON(got))
}

func (h *Handler) myAttempt(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	got, err := h.svc.MyAttempt(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, h.attemptJSON(got))
}

func (h *Handler) saveAnswer(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	position, ok := positionParam(c)
	if !ok {
		return
	}
	answer, ok := readJSONField(c, "answer")
	if !ok {
		return
	}
	if err := h.svc.SaveAnswer(c.Request.Context(), actor, classID, id, position, answer); err != nil {
		failWith(c, err)
		return
	}
	h.cardChanged(c.Request.Context(), id, actor.UserID)
	c.Status(http.StatusNoContent)
}

func (h *Handler) checkAnswer(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	position, ok := positionParam(c)
	if !ok {
		return
	}
	snapshot, ok := readJSONField(c, "snapshot")
	if !ok {
		return
	}
	solved, err := h.svc.CheckAnswer(c.Request.Context(), actor, classID, id, position, snapshot)
	if err != nil {
		failWith(c, err)
		return
	}
	h.cardChanged(c.Request.Context(), id, actor.UserID)
	c.JSON(http.StatusOK, gin.H{"solved": solved})
}

func (h *Handler) submitAttempt(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	got, err := h.svc.SubmitAttempt(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	h.cardChanged(c.Request.Context(), id, actor.UserID)
	c.JSON(http.StatusOK, h.attemptJSON(got))
}

func (h *Handler) attempts(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	rows, err := h.svc.Attempts(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	items := make([]gin.H, len(rows))
	for i, r := range rows {
		items[i] = attemptRowJSON(r)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "serverNow": iso(h.svc.Now())})
}

// attemptForTeacher gives the attempt of one student to the teacher in the room, with the answers and the key of the objective kinds (SPEC-095
// section 5).
func (h *Handler) attemptForTeacher(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	attemptID, ok := uuidParam(c, "attemptId")
	if !ok {
		return
	}
	got, err := h.svc.AttemptForTeacher(c.Request.Context(), actor, classID, id, attemptID)
	if err != nil {
		failWith(c, err)
		return
	}
	items := make([]gin.H, len(got.Items))
	for i, it := range got.Items {
		item := gin.H{"position": it.Position, "kind": it.Kind, "weight": it.Weight.Float(), "title": it.Title, "studentView": it.StudentView}
		if len(it.Answer) > 0 {
			item["answer"] = it.Answer
		}
		if it.CheckedSolved != nil {
			item["checkedSolved"] = *it.CheckedSolved
		}
		if len(it.AnswerKey) > 0 {
			item["answerKey"] = it.AnswerKey
		}
		items[i] = item
	}
	out := gin.H{"attemptId": got.ID, "studentId": got.StudentID, "studentName": got.StudentName, "status": got.Status, "startedAt": iso(got.StartedAt),
		"serverNow": iso(h.svc.Now()), "items": items}
	if got.SubmittedAt != nil {
		out["submittedAt"] = iso(*got.SubmittedAt)
	}
	c.JSON(http.StatusOK, out)
}
