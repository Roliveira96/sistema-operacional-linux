// Package handler provides HTTP endpoints for class management and join requests (SPEC-009).
package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// ClassService defines the application use cases consumed by the handler.
type ClassService interface {
	CreateClass(ctx context.Context, teacherID uuid.UUID, input service.CreateClassInput) (domain.ClassGroup, error)
	ListClasses(ctx context.Context, teacherID uuid.UUID, filter repository.ListFilter) (repository.ListResult, error)
	GetClass(ctx context.Context, teacherID, classID uuid.UUID) (domain.ClassGroup, error)
	UpdateClass(ctx context.Context, teacherID, classID uuid.UUID, input service.UpdateClassInput) (domain.ClassGroup, error)
	ArchiveClass(ctx context.Context, teacherID, classID uuid.UUID, reason string) (domain.ClassGroup, error)
	JoinByToken(ctx context.Context, studentID uuid.UUID, token string) (service.JoinResult, error)
	ListMembers(ctx context.Context, teacherID, classID uuid.UUID, status string) ([]repository.EnrollmentWithUser, error)
	ModerateMember(ctx context.Context, teacherID, classID, enrollmentID uuid.UUID, approve bool, rejectionReason *string) (domain.Enrollment, error)
}

// Handler manages class-related HTTP requests.
type Handler struct {
	svc  ClassService
	auth authn.Validator
	now  func() time.Time
}

// New creates a new ClassGroup HTTP handler.
func New(svc ClassService, auth authn.Validator) *Handler {
	return &Handler{
		svc:  svc,
		auth: auth,
		now:  time.Now,
	}
}

// WithNow allows setting a custom clock for testing.
func (h *Handler) WithNow(now func() time.Time) *Handler {
	h.now = now
	return h
}

// Register wires classgroup endpoints to the Gin router under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	// Student join endpoint: any authenticated user
	authed := r.Group("", authn.Required(h.auth))
	authed.POST("/classes/join/:token", h.joinByToken)

	// Teacher/Admin endpoints
	teacherGroup := r.Group("/classes", authn.Required(h.auth), authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacherGroup.POST("", h.createClass)
	teacherGroup.GET("", h.listClasses)
	teacherGroup.GET("/:id", h.getClass)
	teacherGroup.PATCH("/:id", h.updateClass)
	teacherGroup.POST("/:id/archive", h.archiveClass)
	teacherGroup.GET("/:id/members", h.listMembers)
	teacherGroup.POST("/:id/members/:memberId/moderate", h.moderateMember)
}

type createClassRequest struct {
	Name                    string      `json:"name"`
	CourseCode              string      `json:"courseCode"`
	Semester                string      `json:"semester"`
	Syllabus                string      `json:"syllabus"`
	InstitutionalGuidelines string      `json:"institutionalGuidelines"`
	StartDate               string      `json:"startDate"`
	EndDate                 string      `json:"endDate"`
	ScheduleDescription     string      `json:"scheduleDescription"`
	EnableVirtualClassroom  bool        `json:"enableVirtualClassroom"`
	EnableInviteLink        bool        `json:"enableInviteLink"`
	InviteLinkStart         *string     `json:"inviteLinkStart"`
	InviteLinkEnd           *string     `json:"inviteLinkEnd"`
	InitialStudentIDs       []uuid.UUID `json:"initialStudentIds"`
}

type classResponse struct {
	ID                      uuid.UUID  `json:"id"`
	TeacherID               uuid.UUID  `json:"teacherId"`
	Name                    string     `json:"name"`
	CourseCode              string     `json:"courseCode"`
	Semester                string     `json:"semester"`
	Syllabus                string     `json:"syllabus"`
	InstitutionalGuidelines string     `json:"institutionalGuidelines"`
	StartDate               time.Time  `json:"startDate"`
	EndDate                 time.Time  `json:"endDate"`
	ScheduleDescription     string     `json:"scheduleDescription"`
	EnableVirtualClassroom  bool       `json:"enableVirtualClassroom"`
	EnableInviteLink        bool       `json:"enableInviteLink"`
	InviteLinkToken         *string    `json:"inviteLinkToken,omitempty"`
	InviteLinkStart         *time.Time `json:"inviteLinkStart,omitempty"`
	InviteLinkEnd           *time.Time `json:"inviteLinkEnd,omitempty"`
	Status                  string     `json:"status"`
	ArchiveReason           *string    `json:"archiveReason,omitempty"`
	IsExpiringSoon          bool       `json:"isExpiringSoon"`
	CreatedAt               time.Time  `json:"createdAt"`
	UpdatedAt               time.Time  `json:"updatedAt"`
}

type classSummaryResponse struct {
	classResponse
	TotalActiveStudents  int64 `json:"totalActiveStudents"`
	TotalPendingRequests int64 `json:"totalPendingRequests"`
}

type listClassesResponse struct {
	Items      []classSummaryResponse `json:"items"`
	TotalCount int64                  `json:"totalCount"`
	Page       int                    `json:"page"`
	Limit      int                    `json:"limit"`
}

func (h *Handler) toClassResponse(c domain.ClassGroup) classResponse {
	return classResponse{
		ID:                      c.ID,
		TeacherID:               c.TeacherID,
		Name:                    c.Name,
		CourseCode:              c.CourseCode,
		Semester:                c.Semester,
		Syllabus:                c.Syllabus,
		InstitutionalGuidelines: c.InstitutionalGuidelines,
		StartDate:               c.StartDate,
		EndDate:                 c.EndDate,
		ScheduleDescription:     c.ScheduleDescription,
		EnableVirtualClassroom:  c.EnableVirtualClassroom,
		EnableInviteLink:        c.EnableInviteLink,
		InviteLinkToken:         c.InviteLinkToken,
		InviteLinkStart:         c.InviteLinkStart,
		InviteLinkEnd:           c.InviteLinkEnd,
		Status:                  string(c.Status),
		ArchiveReason:           c.ArchiveReason,
		IsExpiringSoon:          c.IsExpiringSoon(h.now()),
		CreatedAt:               c.CreatedAt,
		UpdatedAt:               c.UpdatedAt,
	}
}

func (h *Handler) createClass(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	var req createClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}

	var invalidParams []problem.InvalidParam
	if req.Name == "" {
		invalidParams = append(invalidParams, problem.InvalidParam{Name: "name", Reason: "required"})
	}
	if req.CourseCode == "" {
		invalidParams = append(invalidParams, problem.InvalidParam{Name: "courseCode", Reason: "required"})
	}
	if req.Semester == "" {
		invalidParams = append(invalidParams, problem.InvalidParam{Name: "semester", Reason: "required"})
	}
	if req.StartDate == "" {
		invalidParams = append(invalidParams, problem.InvalidParam{Name: "startDate", Reason: "required"})
	}
	if req.EndDate == "" {
		invalidParams = append(invalidParams, problem.InvalidParam{Name: "endDate", Reason: "required"})
	}
	if len(invalidParams) > 0 {
		fail(c, problem.Validation("Required fields are missing.", invalidParams...))
		return
	}

	start, err := time.Parse(time.RFC3339, req.StartDate)
	if err != nil {
		fail(c, problem.BadRequest("invalid-date-format", "startDate must be a valid ISO 8601 timestamp."))
		return
	}
	end, err := time.Parse(time.RFC3339, req.EndDate)
	if err != nil {
		fail(c, problem.BadRequest("invalid-date-format", "endDate must be a valid ISO 8601 timestamp."))
		return
	}

	var inviteStart, inviteEnd *time.Time
	if req.InviteLinkStart != nil {
		t, err := time.Parse(time.RFC3339, *req.InviteLinkStart)
		if err != nil {
			fail(c, problem.BadRequest("invalid-date-format", "inviteLinkStart must be a valid ISO 8601 timestamp."))
			return
		}
		inviteStart = &t
	}
	if req.InviteLinkEnd != nil {
		t, err := time.Parse(time.RFC3339, *req.InviteLinkEnd)
		if err != nil {
			fail(c, problem.BadRequest("invalid-date-format", "inviteLinkEnd must be a valid ISO 8601 timestamp."))
			return
		}
		inviteEnd = &t
	}

	input := service.CreateClassInput{
		Name:                    req.Name,
		CourseCode:              req.CourseCode,
		Semester:                req.Semester,
		Syllabus:                req.Syllabus,
		InstitutionalGuidelines: req.InstitutionalGuidelines,
		StartDate:               start,
		EndDate:                 end,
		ScheduleDescription:     req.ScheduleDescription,
		EnableVirtualClassroom:  req.EnableVirtualClassroom,
		EnableInviteLink:        req.EnableInviteLink,
		InviteLinkStart:         inviteStart,
		InviteLinkEnd:           inviteEnd,
		InitialStudentIDs:       req.InitialStudentIDs,
	}

	class, err := h.svc.CreateClass(c.Request.Context(), principal.UserID, input)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusCreated, h.toClassResponse(class))
}

func (h *Handler) listClasses(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	status := c.Query("status")
	search := c.Query("search")

	res, err := h.svc.ListClasses(c.Request.Context(), principal.UserID, repository.ListFilter{
		Status: status,
		Search: search,
		Page:   page,
		Limit:  limit,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	items := make([]classSummaryResponse, len(res.Items))
	for i, it := range res.Items {
		items[i] = classSummaryResponse{
			classResponse:        h.toClassResponse(it.Class),
			TotalActiveStudents:  it.TotalActiveStudents,
			TotalPendingRequests: it.TotalPendingRequests,
		}
	}

	c.JSON(http.StatusOK, listClassesResponse{
		Items:      items,
		TotalCount: res.TotalCount,
		Page:       res.Page,
		Limit:      res.Limit,
	})
}

func (h *Handler) getClass(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	idStr := c.Param("id")
	classID, err := uuid.Parse(idStr)
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The class ID parameter is invalid."))
		return
	}

	class, err := h.svc.GetClass(c.Request.Context(), principal.UserID, classID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, h.toClassResponse(class))
}

type updateClassRequest struct {
	Name                    *string `json:"name"`
	Syllabus                *string `json:"syllabus"`
	InstitutionalGuidelines *string `json:"institutionalGuidelines"`
	StartDate               *string `json:"startDate"`
	EndDate                 *string `json:"endDate"`
	ScheduleDescription     *string `json:"scheduleDescription"`
	EnableVirtualClassroom  *bool   `json:"enableVirtualClassroom"`
	EnableInviteLink        *bool   `json:"enableInviteLink"`
	InviteLinkStart         *string `json:"inviteLinkStart"`
	InviteLinkEnd           *string `json:"inviteLinkEnd"`
}

func (h *Handler) updateClass(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The class ID parameter is invalid."))
		return
	}

	var req updateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}

	input := service.UpdateClassInput{
		Name:                    req.Name,
		Syllabus:                req.Syllabus,
		InstitutionalGuidelines: req.InstitutionalGuidelines,
		ScheduleDescription:     req.ScheduleDescription,
		EnableVirtualClassroom:  req.EnableVirtualClassroom,
		EnableInviteLink:        req.EnableInviteLink,
	}

	if req.StartDate != nil {
		t, err := time.Parse(time.RFC3339, *req.StartDate)
		if err != nil {
			fail(c, problem.BadRequest("invalid-date-format", "startDate must be a valid ISO 8601 timestamp."))
			return
		}
		input.StartDate = &t
	}
	if req.EndDate != nil {
		t, err := time.Parse(time.RFC3339, *req.EndDate)
		if err != nil {
			fail(c, problem.BadRequest("invalid-date-format", "endDate must be a valid ISO 8601 timestamp."))
			return
		}
		input.EndDate = &t
	}
	if req.InviteLinkStart != nil {
		t, err := time.Parse(time.RFC3339, *req.InviteLinkStart)
		if err != nil {
			fail(c, problem.BadRequest("invalid-date-format", "inviteLinkStart must be a valid ISO 8601 timestamp."))
			return
		}
		input.InviteLinkStart = &t
	}
	if req.InviteLinkEnd != nil {
		t, err := time.Parse(time.RFC3339, *req.InviteLinkEnd)
		if err != nil {
			fail(c, problem.BadRequest("invalid-date-format", "inviteLinkEnd must be a valid ISO 8601 timestamp."))
			return
		}
		input.InviteLinkEnd = &t
	}

	class, err := h.svc.UpdateClass(c.Request.Context(), principal.UserID, classID, input)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, h.toClassResponse(class))
}

type archiveRequest struct {
	Reason string `json:"reason"`
}

func (h *Handler) archiveClass(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The class ID parameter is invalid."))
		return
	}

	var req archiveRequest
	_ = c.ShouldBindJSON(&req)

	class, err := h.svc.ArchiveClass(c.Request.Context(), principal.UserID, classID, req.Reason)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, h.toClassResponse(class))
}

type joinResponse struct {
	EnrollmentID uuid.UUID `json:"enrollmentId"`
	ClassName    string    `json:"className"`
	Status       string    `json:"status"`
}

func (h *Handler) joinByToken(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	token := c.Param("token")
	if token == "" {
		fail(c, problem.BadRequest("missing-token", "Token is required."))
		return
	}

	res, err := h.svc.JoinByToken(c.Request.Context(), principal.UserID, token)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusCreated, joinResponse{
		EnrollmentID: res.EnrollmentID,
		ClassName:    res.ClassName,
		Status:       string(res.Status),
	})
}

type memberResponse struct {
	ID             uuid.UUID  `json:"id"`
	ClassID        uuid.UUID  `json:"classId"`
	UserID         uuid.UUID  `json:"userId"`
	UserName       *string    `json:"userName,omitempty"`
	UserEmail      string     `json:"userEmail"`
	UserAcademicID *string    `json:"userAcademicId,omitempty"`
	Status         string     `json:"status"`
	Origin         string     `json:"origin"`
	RequestedAt    time.Time  `json:"requestedAt"`
	DecidedAt      *time.Time `json:"decidedAt,omitempty"`
}

func (h *Handler) listMembers(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The class ID parameter is invalid."))
		return
	}

	status := c.Query("status")
	members, err := h.svc.ListMembers(c.Request.Context(), principal.UserID, classID, status)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	res := make([]memberResponse, len(members))
	for i, m := range members {
		res[i] = memberResponse{
			ID:             m.ID,
			ClassID:        m.ClassID,
			UserID:         m.UserID,
			UserName:       m.UserName,
			UserEmail:      m.UserEmail,
			UserAcademicID: m.UserAcademicID,
			Status:         string(m.Status),
			Origin:         string(m.Origin),
			RequestedAt:    m.RequestedAt,
			DecidedAt:      m.DecidedAt,
		}
	}

	c.JSON(http.StatusOK, res)
}

type moderateRequest struct {
	Approve         bool    `json:"approve"`
	RejectionReason *string `json:"rejectionReason"`
}

func (h *Handler) moderateMember(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The class ID parameter is invalid."))
		return
	}

	memberID, err := uuid.Parse(c.Param("memberId"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "The member ID parameter is invalid."))
		return
	}

	var req moderateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}

	enrollment, err := h.svc.ModerateMember(c.Request.Context(), principal.UserID, classID, memberID, req.Approve, req.RejectionReason)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":              enrollment.ID,
		"status":          enrollment.Status,
		"rejectionReason": enrollment.RejectionReason,
		"decidedAt":       enrollment.DecidedAt,
	})
}

func toProblem(err error) *problem.Problem {
	switch {
	case errors.Is(err, domain.ErrInvalidDateRange):
		return problem.BadRequest("invalid-date-range", err.Error())
	case errors.Is(err, domain.ErrInvalidInviteRange):
		return problem.BadRequest("invalid-invite-range", err.Error())
	case errors.Is(err, domain.ErrInviteLinkConfigRequired):
		return problem.BadRequest("invite-link-dates-required", err.Error())
	case errors.Is(err, domain.ErrArchiveReasonRequired):
		return problem.New(http.StatusUnprocessableEntity, "archive-reason-required", err.Error())
	case errors.Is(err, domain.ErrClassConflict):
		return problem.Conflict("class-conflict", err.Error())
	case errors.Is(err, domain.ErrClassNotFound):
		return problem.NotFound("class-not-found", err.Error())
	case errors.Is(err, domain.ErrForbidden):
		return problem.Forbidden("forbidden", err.Error())
	case errors.Is(err, domain.ErrInviteLinkExpired):
		return problem.Gone("invite-link-expired", err.Error())
	case errors.Is(err, domain.ErrAlreadyEnrolled):
		return problem.Conflict("already-enrolled", err.Error())
	case errors.Is(err, domain.ErrEnrollmentNotFound):
		return problem.NotFound("enrollment-not-found", err.Error())
	default:
		return problem.Internal()
	}
}

func fail(c *gin.Context, p *problem.Problem) {
	_ = c.Error(p)
	c.Abort()
}
