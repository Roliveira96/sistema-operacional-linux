package handler

import (
	"context"
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

// review gives the delivered attempt for the correction (SPEC-097 section 5).
func (h *Handler) review(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	attemptID, ok := uuidParam(c, "attemptId")
	if !ok {
		return
	}
	got, err := h.svc.ReviewOf(c.Request.Context(), actor, classID, id, attemptID)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, h.reviewJSON(got))
}

func (h *Handler) reviewJSON(r service.Review) gin.H {
	out := attemptRowJSON(r.AttemptRow)
	delete(out, "chatCount")
	out["score"], out["reviewed"], out["teacherNote"], out["studentNote"], out["serverNow"] = r.Score.Float(), r.Reviewed, r.TeacherNote, r.StudentNote, iso(h.svc.Now())
	items := make([]gin.H, len(r.Items))
	for i, it := range r.Items {
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
		if it.ExpectedAnswer != "" {
			item["expectedAnswer"] = it.ExpectedAnswer
		}
		if it.Points != nil {
			item["points"] = it.Points.Float()
		}
		if it.AdjustedPoints != nil {
			item["adjustedPoints"], item["adjustReason"] = it.AdjustedPoints.Float(), it.AdjustReason
		}
		commands := make([]gin.H, len(it.Commands))
		for j, cmd := range it.Commands {
			commands[j] = gin.H{"position": cmd.Position, "command": cmd.Command, "output": cmd.Output, "executedAt": iso(cmd.ExecutedAt)}
		}
		item["commands"] = commands
		items[i] = item
	}
	out["items"] = items
	helps := make([]gin.H, len(r.Helps))
	for i, hr := range r.Helps {
		helps[i] = helpJSON(hr)
	}
	out["helps"] = helps
	return out
}

// adjust changes the points of a question in the correction, or undoes the change with null points (SPEC-097 section 5).
func (h *Handler) adjust(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	attemptID, ok := uuidParam(c, "attemptId")
	if !ok {
		return
	}
	position, ok := positionParam(c)
	if !ok {
		return
	}
	var body struct {
		Points json.RawMessage `json:"points"`
		Reason string          `json:"reason"`
	}
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || len(body.Points) == 0 {
		malformed(c)
		return
	}
	var points *float64
	if string(body.Points) != "null" {
		var v float64
		if err := json.Unmarshal(body.Points, &v); err != nil {
			malformed(c)
			return
		}
		points = &v
	}
	got, err := h.svc.AdjustItem(c.Request.Context(), actor, classID, id, attemptID, position, points, body.Reason)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, h.reviewJSON(got))
}

// reviewNotes keeps the private note and the note to the student (SPEC-097 section 5).
func (h *Handler) reviewNotes(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	attemptID, ok := uuidParam(c, "attemptId")
	if !ok {
		return
	}
	var body struct {
		TeacherNote string `json:"teacherNote"`
		StudentNote string `json:"studentNote"`
	}
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		malformed(c)
		return
	}
	if err := h.svc.SaveReviewNotes(c.Request.Context(), actor, classID, id, attemptID, body.TeacherNote, body.StudentNote); err != nil {
		failWith(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// finishReview concludes the review of the attempt; reopenReview opens it again (SPEC-097 section 5).
func (h *Handler) finishReview(c *gin.Context) { h.reviewAction(c, h.svc.FinishReview) }
func (h *Handler) reopenReview(c *gin.Context) { h.reviewAction(c, h.svc.ReopenReview) }

func (h *Handler) reviewAction(c *gin.Context, do func(context.Context, service.Actor, uuid.UUID, uuid.UUID, uuid.UUID) (service.Review, error)) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	attemptID, ok := uuidParam(c, "attemptId")
	if !ok {
		return
	}
	got, err := do(c.Request.Context(), actor, classID, id, attemptID)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, h.reviewJSON(got))
}

// publishGrades publishes the grades of the exam (SPEC-098 section 5).
func (h *Handler) publishGrades(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	got, err := h.svc.PublishGrades(c.Request.Context(), actor, classID, id)
	if err != nil {
		failWith(c, err)
		return
	}
	c.JSON(http.StatusOK, summaryResponse{summaryJSON: toSummary(got), ServerNow: iso(h.svc.Now())})
}

// myResult gives the student her published result (SPEC-098 section 5).
func (h *Handler) myResult(c *gin.Context) {
	actor, classID, id, ok := attemptIDs(c)
	if !ok {
		return
	}
	got, err := h.svc.MyResult(c.Request.Context(), actor, classID, id)
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
		if it.Points != nil {
			item["points"] = it.Points.Float()
		}
		if it.AdjustReason != "" {
			item["adjustReason"] = it.AdjustReason
		}
		items[i] = item
	}
	out := gin.H{"finalScore": got.FinalScore.Float(), "maxScore": got.MaxScore.Float(), "items": items}
	if got.StudentNote != "" {
		out["studentNote"] = got.StudentNote
	}
	c.JSON(http.StatusOK, out)
}
