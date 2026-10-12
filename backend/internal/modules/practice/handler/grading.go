package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// Grading is the correction use case of the descriptive answers (SPEC-039).
type Grading interface {
	List(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID, status string) ([]service.AnswerRow, error)
	Get(ctx context.Context, who contentservice.Actor, progressID uuid.UUID) (service.AnswerRow, error)
	Confirm(ctx context.Context, who contentservice.Actor, progressID uuid.UUID, in domain.GradeInput) (service.AnswerRow, error)
}

// GradingHandler serves the correction routes, for ADMIN and the TEACHER who owns the module.
type GradingHandler struct {
	grading Grading
	auth    authn.Validator
}

// NewGrading creates the handler.
func NewGrading(grading Grading, auth authn.Validator) *GradingHandler {
	return &GradingHandler{grading: grading, auth: auth}
}

// Register mounts the routes under /api/v1.
func (h *GradingHandler) Register(r gin.IRouter) {
	teacher := r.Group("/teacher", authn.Required(h.auth), authn.PasswordChanged(), authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacher.GET("/modules/:id/answers", h.list)
	teacher.GET("/answers/:id", h.get)
	teacher.PUT("/answers/:id/grade", h.grade)
}

type suggestionResponse struct {
	Score       int        `json:"score"`
	Reason      *string    `json:"reason,omitempty"`
	StudentNote *string    `json:"studentNote,omitempty"`
	At          *time.Time `json:"at,omitempty"`
}

type gradeResponse struct {
	Score       int        `json:"score"`
	Source      string     `json:"source"`
	StudentNote *string    `json:"studentNote,omitempty"`
	PrivateNote *string    `json:"privateNote,omitempty"`
	GradedAt    *time.Time `json:"gradedAt,omitempty"`
}

// answerResponse is a descriptive answer as the teacher sees it, with the name of the student and the private note (SPEC-039 D-06).
type answerResponse struct {
	ProgressID     uuid.UUID           `json:"progressId"`
	QuestionID     uuid.UUID           `json:"questionId"`
	QuestionTitle  string              `json:"questionTitle"`
	Statement      string              `json:"statement"`
	ExpectedAnswer string              `json:"expectedAnswer,omitempty"`
	Response       string              `json:"response"`
	StudentName    string              `json:"studentName"`
	AnsweredAt     *time.Time          `json:"answeredAt"`
	Status         string              `json:"status"`
	Suggestion     *suggestionResponse `json:"suggestion,omitempty"`
	Grade          *gradeResponse      `json:"grade,omitempty"`
}

func toAnswer(r service.AnswerRow) answerResponse {
	out := answerResponse{
		ProgressID: r.Progress.ID, QuestionID: r.QuestionID, QuestionTitle: r.QuestionTitle, Statement: r.Statement, ExpectedAnswer: r.ExpectedAnswer,
		Response: contentdomain.AnswerHTML(r.Progress.Response), StudentName: r.StudentName, AnsweredAt: r.Progress.CompletedAt, Status: r.Grade.Status(),
	}
	g := r.Grade
	if g.SuggestedScore != nil {
		out.Suggestion = &suggestionResponse{Score: *g.SuggestedScore, Reason: g.SuggestionReason, StudentNote: g.SuggestedStudentNote, At: g.SuggestedAt}
	}
	if g.Score != nil && g.Source != nil {
		out.Grade = &gradeResponse{Score: *g.Score, Source: *g.Source, StudentNote: g.StudentNote, PrivateNote: g.PrivateNote, GradedAt: g.GradedAt}
	}
	return out
}

func gradingActor(c *gin.Context) contentservice.Actor {
	p, _ := authn.FromContext(c.Request.Context())
	return contentservice.Actor{UserID: p.UserID, Role: p.Role}
}

// list returns the answers of a module: GET /teacher/modules/{id}/answers?status=.
func (h *GradingHandler) list(c *gin.Context) {
	id, ok := parseID(c, "module-not-found")
	if !ok {
		return
	}
	rows, err := h.grading.List(c.Request.Context(), gradingActor(c), id, c.Query("status"))
	if err != nil {
		gradingFail(c, err)
		return
	}
	items := make([]answerResponse, len(rows))
	for i, r := range rows {
		items[i] = toAnswer(r)
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "items": items})
}

// get returns one answer: GET /teacher/answers/{progressId}.
func (h *GradingHandler) get(c *gin.Context) {
	id, ok := parseID(c, "answer-not-found")
	if !ok {
		return
	}
	row, err := h.grading.Get(c.Request.Context(), gradingActor(c), id)
	if err != nil {
		gradingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toAnswer(row))
}

type gradeRequest struct {
	Score         *int   `json:"score"`
	UseSuggestion bool   `json:"useSuggestion"`
	StudentNote   string `json:"studentNote"`
	PrivateNote   string `json:"privateNote"`
	Reason        string `json:"reason"`
}

// grade confirms or revises the grade: PUT /teacher/answers/{progressId}/grade.
func (h *GradingHandler) grade(c *gin.Context) {
	id, ok := parseID(c, "answer-not-found")
	if !ok {
		return
	}
	var req gradeRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		gradingFail(c, problem.Validation("The request body must be a JSON object with the grade."))
		return
	}
	row, err := h.grading.Confirm(c.Request.Context(), gradingActor(c), id, domain.GradeInput{
		Score: req.Score, UseSuggestion: req.UseSuggestion, StudentNote: req.StudentNote, PrivateNote: req.PrivateNote, Reason: req.Reason,
	})
	if err != nil {
		gradingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, toAnswer(row))
}

func gradingFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrAnswerNotFound):
		err = problem.NotFound("answer-not-found", "The descriptive answer does not exist.")
	case errors.Is(err, contentservice.ErrModuleNotFound):
		err = problem.NotFound("module-not-found", "The module does not exist.")
	case errors.Is(err, contentservice.ErrForbidden):
		err = problem.Forbidden("forbidden", "Only the teacher of the module or an administrator corrects its answers.")
	case errors.Is(err, domain.ErrInvalidScore):
		err = problem.Validation("The grade must be 0, 25, 50, 75 or 100.", problem.InvalidParam{Name: "score", Reason: "must be 0, 25, 50, 75 or 100"})
	case errors.Is(err, domain.ErrNoSuggestion):
		err = problem.Validation("There is no suggestion to use.", problem.InvalidParam{Name: "useSuggestion", Reason: "no suggestion yet"})
	case errors.Is(err, domain.ErrReasonRequired):
		err = problem.Validation("Changing a confirmed grade needs a reason.", problem.InvalidParam{Name: "reason", Reason: "required"})
	case errors.Is(err, service.ErrInvalidAnswerStatus):
		err = problem.Validation("The status is not valid.", problem.InvalidParam{Name: "status", Reason: "must be PENDING, SUGGESTED or GRADED"})
	}
	_ = c.Error(err)
	c.Abort()
}
