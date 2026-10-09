// Package handler provides HTTP endpoints for course module management and catalog access (SPEC-010).
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// CourseModuleService defines the use cases needed by the handler.
type CourseModuleService interface {
	CreateModule(ctx context.Context, input service.CreateModuleInput) (domain.CourseModule, error)
	UpdateModule(ctx context.Context, input service.UpdateModuleInput) (domain.CourseModule, error)
	GetModuleByID(ctx context.Context, moduleID uuid.UUID, userCtx service.UserAccessContext) (repository.ModuleDetails, error)
	ListModules(ctx context.Context, userCtx service.UserAccessContext, filter repository.ListFilter) (repository.ListResult, error)
	ListPublicModules(ctx context.Context, filter repository.ListFilter) (repository.ListResult, error)
	ReorderExercises(ctx context.Context, moduleID, callerID uuid.UUID, isAdmin bool, exerciseIDs []uuid.UUID) error
}

// Handler manages course module HTTP endpoints.
type Handler struct {
	svc  CourseModuleService
	auth authn.Validator
	now  func() time.Time
}

// New creates a new CourseModule HTTP handler.
func New(svc CourseModuleService, auth authn.Validator) *Handler {
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

// Register wires endpoints to the Gin router under /api/v1.
func (h *Handler) Register(r gin.IRouter) {
	// Public catalog
	r.GET("/modules/public", h.listPublic)

	// Detail endpoint with optional authentication
	r.GET("/modules/:id", h.optionalAuth(), h.getModule)

	// Authenticated modules listing (all roles)
	authed := r.Group("", authn.Required(h.auth))
	authed.GET("/modules", h.listModules)

	// Teacher / Admin management endpoints
	teacherGroup := r.Group("/modules", authn.Required(h.auth), authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacherGroup.POST("", h.createModule)
	teacherGroup.PATCH("/:id", h.updateModule)
	teacherGroup.PUT("/:id/exercises/order", h.reorderExercises)
}

func (h *Handler) optionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(authn.CookieName)
		if err == nil && token != "" {
			if p, err := h.auth.Authenticate(c.Request.Context(), token); err == nil {
				c.Request = c.Request.WithContext(authn.WithPrincipal(c.Request.Context(), p))
			}
		}
		c.Next()
	}
}

// optional tells an absent JSON field (keep the value) from an explicit null (clear it).
type optional[T any] struct {
	Set   bool
	Value *T
}

// UnmarshalJSON is only called when the field is present in the body.
func (o *optional[T]) UnmarshalJSON(data []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		o.Value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

type createModuleRequest struct {
	Title           string      `json:"title"`
	Description     string      `json:"description"`
	Slug            *string     `json:"slug"`
	Visibility      string      `json:"visibility"`
	ActivationStart *string     `json:"activationStart"`
	ActivationEnd   *string     `json:"activationEnd"`
	ClassIDs        []uuid.UUID `json:"classIds"`
}

type updateModuleRequest struct {
	Title           *string          `json:"title"`
	Description     *string          `json:"description"`
	Slug            optional[string] `json:"slug"`
	Visibility      *string          `json:"visibility"`
	Status          *string          `json:"status"`
	ActivationStart optional[string] `json:"activationStart"`
	ActivationEnd   optional[string] `json:"activationEnd"`
	ClassIDs        []uuid.UUID      `json:"classIds"`
}

type reorderExercisesRequest struct {
	OrderedExerciseIDs []uuid.UUID `json:"orderedExerciseIds"`
}

type moduleSummaryResponse struct {
	ID              uuid.UUID  `json:"id"`
	TeacherID       uuid.UUID  `json:"teacherId"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Visibility      string     `json:"visibility"`
	Status          string     `json:"status"`
	ActivationStart *time.Time `json:"activationStart,omitempty"`
	ActivationEnd   *time.Time `json:"activationEnd,omitempty"`
	TotalExercises  int64      `json:"totalExercises"`
	TotalMaterials  int64      `json:"totalMaterials"`
	IsActiveNow     bool       `json:"isActiveNow"`
	Icon         *string   `json:"icon,omitempty"`
	Color        *string   `json:"color,omitempty"`
	DisplayOrder *int      `json:"displayOrder,omitempty"`
	SourceKey    *string   `json:"sourceKey,omitempty"`
	Slug         *string   `json:"slug,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type exerciseItemResponse struct {
	ID            uuid.UUID `json:"id"`
	ModuleID      uuid.UUID `json:"moduleId"`
	ExerciseID    uuid.UUID `json:"exerciseId"`
	SequenceOrder int       `json:"sequenceOrder"`
	IsMandatory   bool      `json:"isMandatory"`
}

type materialResponse struct {
	ID          uuid.UUID `json:"id"`
	ModuleID    uuid.UUID `json:"moduleId"`
	Title       string    `json:"title"`
	Description *string   `json:"description,omitempty"`
	URL         string    `json:"url"`
}

type moduleDetailResponse struct {
	moduleSummaryResponse
	AssignedClassIDs []uuid.UUID            `json:"assignedClassIds"`
	ExerciseItems    []exerciseItemResponse `json:"exerciseItems"`
	Materials        []materialResponse     `json:"materials"`
}

func (h *Handler) createModule(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	var req createModuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request body."))
		return
	}

	start, end, err := parseDateRange(req.ActivationStart, req.ActivationEnd)
	if err != nil {
		fail(c, problem.BadRequest("invalid-date-format", err.Error()))
		return
	}

	mod, err := h.svc.CreateModule(c.Request.Context(), service.CreateModuleInput{
		TeacherID:       principal.UserID,
		Title:           req.Title,
		Description:     req.Description,
		Slug:            req.Slug,
		Visibility:      domain.Visibility(req.Visibility),
		ActivationStart: start,
		ActivationEnd:   end,
		ClassIDs:        req.ClassIDs,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusCreated, h.toSummaryResponse(domain.CourseModule{
		Model:           mod.Model,
		TeacherID:       mod.TeacherID,
		Title:           mod.Title,
		Description:     mod.Description,
		Visibility:      mod.Visibility,
		Status:          mod.Status,
		ActivationStart: mod.ActivationStart,
		ActivationEnd:   mod.ActivationEnd,
	}, 0, 0))
}

func (h *Handler) updateModule(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	moduleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "Invalid module ID format."))
		return
	}

	var req updateModuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request body."))
		return
	}

	start, err := toTimePatch(req.ActivationStart)
	if err != nil {
		fail(c, invalidDate("activationStart", err))
		return
	}
	end, err := toTimePatch(req.ActivationEnd)
	if err != nil {
		fail(c, invalidDate("activationEnd", err))
		return
	}

	var vis *domain.Visibility
	if req.Visibility != nil {
		v := domain.Visibility(*req.Visibility)
		vis = &v
	}

	var st *domain.ModuleStatus
	if req.Status != nil {
		s := domain.ModuleStatus(*req.Status)
		st = &s
	}

	mod, err := h.svc.UpdateModule(c.Request.Context(), service.UpdateModuleInput{
		ModuleID:        moduleID,
		CallerID:        principal.UserID,
		IsAdmin:         principal.Role == authn.RoleAdmin,
		Title:           req.Title,
		Description:     req.Description,
		Slug:            service.Patch[string]{Set: req.Slug.Set, Value: req.Slug.Value},
		Visibility:      vis,
		Status:          st,
		ActivationStart: start,
		ActivationEnd:   end,
		ClassIDs:        req.ClassIDs,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, h.toSummaryResponse(mod, 0, 0))
}

func (h *Handler) getModule(c *gin.Context) {
	moduleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "Invalid module ID format."))
		return
	}

	userCtx := service.UserAccessContext{}
	if principal, ok := authn.FromContext(c.Request.Context()); ok {
		userCtx.UserID = &principal.UserID
		userCtx.Role = principal.Role
		userCtx.IsAdmin = principal.Role == authn.RoleAdmin
		userCtx.IsTeacher = principal.Role == authn.RoleTeacher
		userCtx.IsStudent = principal.Role == authn.RoleStudent
	}

	details, err := h.svc.GetModuleByID(c.Request.Context(), moduleID, userCtx)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	exResponses := make([]exerciseItemResponse, len(details.ExerciseItems))
	for i, ex := range details.ExerciseItems {
		exResponses[i] = exerciseItemResponse{
			ID:            ex.ID,
			ModuleID:      ex.ModuleID,
			ExerciseID:    ex.ExerciseID,
			SequenceOrder: ex.SequenceOrder,
			IsMandatory:   ex.IsMandatory,
		}
	}

	matResponses := make([]materialResponse, len(details.Materials))
	for i, m := range details.Materials {
		matResponses[i] = materialResponse{
			ID:          m.ID,
			ModuleID:    m.ModuleID,
			Title:       m.Title,
			Description: m.Description,
			URL:         m.URL,
		}
	}

	summary := h.toSummaryResponse(details.Module, details.TotalExercises, details.TotalMaterials)
	c.JSON(http.StatusOK, moduleDetailResponse{
		moduleSummaryResponse: summary,
		AssignedClassIDs:      details.AssignedClassIDs,
		ExerciseItems:         exResponses,
		Materials:             matResponses,
	})
}

func (h *Handler) listPublic(c *gin.Context) {
	filter := parseListFilter(c)
	result, err := h.svc.ListPublicModules(c.Request.Context(), filter)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	items := make([]moduleSummaryResponse, len(result.Items))
	for i, it := range result.Items {
		items[i] = h.toSummaryResponse(it.CourseModule, it.TotalExercises, it.TotalMaterials)
	}

	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"total": result.TotalCount,
		"page":  result.Page,
		"limit": result.Limit,
	})
}

func (h *Handler) listModules(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	userCtx := service.UserAccessContext{
		UserID:    &principal.UserID,
		Role:      principal.Role,
		IsAdmin:   principal.Role == authn.RoleAdmin,
		IsTeacher: principal.Role == authn.RoleTeacher,
		IsStudent: principal.Role == authn.RoleStudent,
	}

	filter := parseListFilter(c)
	result, err := h.svc.ListModules(c.Request.Context(), userCtx, filter)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	items := make([]moduleSummaryResponse, len(result.Items))
	for i, it := range result.Items {
		items[i] = h.toSummaryResponse(it.CourseModule, it.TotalExercises, it.TotalMaterials)
	}

	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"total": result.TotalCount,
		"page":  result.Page,
		"limit": result.Limit,
	})
}

func (h *Handler) reorderExercises(c *gin.Context) {
	principal, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}

	moduleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, problem.BadRequest("invalid-uuid", "Invalid module ID format."))
		return
	}

	var req reorderExercisesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, problem.BadRequest("malformed-request", "Invalid request payload."))
		return
	}

	err = h.svc.ReorderExercises(
		c.Request.Context(),
		moduleID,
		principal.UserID,
		principal.Role == authn.RoleAdmin,
		req.OrderedExerciseIDs,
	)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Exercises reordered successfully",
		"reorderedCount": len(req.OrderedExerciseIDs),
	})
}

func (h *Handler) toSummaryResponse(m domain.CourseModule, exercises, materials int64) moduleSummaryResponse {
	return moduleSummaryResponse{
		ID:              m.ID,
		TeacherID:       m.TeacherID,
		Title:           m.Title,
		Description:     m.Description,
		Visibility:      string(m.Visibility),
		Status:          string(m.Status),
		ActivationStart: m.ActivationStart,
		ActivationEnd:   m.ActivationEnd,
		TotalExercises:  exercises,
		TotalMaterials:  materials,
		IsActiveNow:     m.IsActiveNow(h.now()),
		Icon:            m.Icon,
		Color:           m.Color,
		DisplayOrder:    m.DisplayOrder,
		SourceKey:       m.SourceKey,
		Slug:            m.Slug,
		CreatedAt:       m.CreatedAt,
		UpdatedAt:       m.UpdatedAt,
	}
}

func parseListFilter(c *gin.Context) repository.ListFilter {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	var classID *uuid.UUID
	if cidStr := c.Query("classId"); cidStr != "" {
		if cid, err := uuid.Parse(cidStr); err == nil {
			classID = &cid
		}
	}
	return repository.ListFilter{
		Status:     c.Query("status"),
		Visibility: c.Query("visibility"),
		ClassID:    classID,
		Search:     c.Query("search"),
		Page:       page,
		Limit:      limit,
	}
}

func parseDateRange(startStr, endStr *string) (*time.Time, *time.Time, error) {
	var start, end *time.Time
	if startStr != nil && *startStr != "" {
		t, err := time.Parse(time.RFC3339, *startStr)
		if err != nil {
			return nil, nil, err
		}
		start = &t
	}
	if endStr != nil && *endStr != "" {
		t, err := time.Parse(time.RFC3339, *endStr)
		if err != nil {
			return nil, nil, err
		}
		end = &t
	}
	return start, end, nil
}

// toTimePatch turns an optional RFC 3339 field into a patch: absent keeps, null or "" clears.
func toTimePatch(o optional[string]) (service.Patch[time.Time], error) {
	if !o.Set {
		return service.Patch[time.Time]{}, nil
	}
	if o.Value == nil || strings.TrimSpace(*o.Value) == "" {
		return service.Patch[time.Time]{Set: true}, nil
	}
	t, err := time.Parse(time.RFC3339, *o.Value)
	if err != nil {
		return service.Patch[time.Time]{}, err
	}
	return service.Patch[time.Time]{Set: true, Value: &t}, nil
}

// invalidDate is the 400 for a date that is not RFC 3339, pointing at the field.
func invalidDate(field string, err error) *problem.Problem {
	p := problem.BadRequest("invalid-date-format", err.Error())
	p.InvalidParams = []problem.InvalidParam{{Name: field, Reason: "invalid date"}}
	return p
}

func toProblem(err error) *problem.Problem {
	switch {
	case errors.Is(err, service.ErrTitleRequired):
		return problem.BadRequest("title-required", err.Error())
	case errors.Is(err, service.ErrDescriptionRequired):
		return problem.BadRequest("description-required", err.Error())
	case errors.Is(err, service.ErrDescriptionTooLong):
		return problem.BadRequest("description-too-long", err.Error())
	case errors.Is(err, domain.ErrInvalidVisibility):
		return problem.BadRequest("invalid-visibility", err.Error())
	case errors.Is(err, domain.ErrInvalidStatus):
		return problem.BadRequest("invalid-status", err.Error())
	case errors.Is(err, domain.ErrInvalidDateRange):
		p := problem.BadRequest("invalid-date-range", err.Error())
		p.InvalidParams = []problem.InvalidParam{{Name: "activationEnd", Reason: "must not be before the start"}}
		return p
	case errors.Is(err, domain.ErrInvalidSlug):
		p := problem.BadRequest("invalid-slug", err.Error())
		p.InvalidParams = []problem.InvalidParam{{Name: "slug", Reason: "invalid format"}}
		return p
	case errors.Is(err, domain.ErrSlugTaken):
		p := problem.Conflict("slug-taken", err.Error())
		p.InvalidParams = []problem.InvalidParam{{Name: "slug", Reason: "already in use"}}
		return p
	case errors.Is(err, domain.ErrPrivateRequiresClass):
		return problem.BadRequest("private-requires-class", err.Error())
	case errors.Is(err, domain.ErrDuplicateExerciseOrder):
		return problem.BadRequest("duplicate-exercise-order", err.Error())
	case errors.Is(err, domain.ErrInvalidExerciseSequence):
		return problem.BadRequest("invalid-exercise-sequence", err.Error())
	case errors.Is(err, domain.ErrModuleNotFound):
		return problem.NotFound("module-not-found", err.Error())
	case errors.Is(err, domain.ErrModuleInactive):
		return problem.Forbidden("module-inactive", err.Error())
	case errors.Is(err, domain.ErrModuleExpired):
		return problem.Forbidden("module-expired", err.Error())
	case errors.Is(err, domain.ErrForbidden):
		return problem.Forbidden("forbidden", err.Error())
	default:
		return problem.Internal()
	}
}

func fail(c *gin.Context, p *problem.Problem) {
	_ = c.Error(p)
	c.Abort()
}
