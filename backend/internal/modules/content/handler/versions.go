package handler

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// Versioning is the use-case port of the versions of a module (SPEC-021).
type Versioning interface {
	List(ctx context.Context, who service.Actor, moduleID uuid.UUID) (service.VersionList, error)
	Publish(ctx context.Context, who service.Actor, moduleID uuid.UUID, note string) (domain.ModuleVersion, error)
	Restore(ctx context.Context, who service.Actor, moduleID uuid.UUID, number int) ([]domain.ContentBlock, json.RawMessage, error)
	RecordTestResult(ctx context.Context, who service.Actor, moduleID uuid.UUID, kind domain.TestKind, passed bool, summary []byte) (domain.ModuleTestResult, error)
}

// VersionHandler serves the routes of the versions of a module.
type VersionHandler struct {
	versions Versioning
	auth     authn.Validator
	limiter  Limiter
}

// NewVersions creates the handler of the versions.
func NewVersions(versions Versioning, auth authn.Validator, limiter Limiter) *VersionHandler {
	return &VersionHandler{versions: versions, auth: auth, limiter: limiter}
}

// Register mounts the routes under /api/v1/teacher.
func (h *VersionHandler) Register(r gin.IRouter) {
	teacher := r.Group("/teacher", authn.Required(h.auth), authn.PasswordChanged(),
		authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacher.GET("/modules/:id/versions", h.list)
	teacher.POST("/modules/:id/versions", h.write, h.publish)
	teacher.POST("/modules/:id/versions/:number/restore", h.write, h.restore)
	teacher.POST("/modules/:id/test-results", h.write, h.recordTest)
}

// write bounds the body and the rate of the routes that change content.
func (h *VersionHandler) write(c *gin.Context) {
	who, ok := actor(c)
	if !ok {
		authFail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}
	if allowed, retry := h.limiter.Allow(who.UserID.String()); !allowed {
		authFail(c, problem.TooManyRequests("Too many changes. Try again later.", int(math.Ceil(retry.Seconds()))))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAuthoringBody)
	c.Next()
}

func (h *VersionHandler) list(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	list, err := h.versions.List(c.Request.Context(), who, id)
	if err != nil {
		versionFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "versions": list.Versions, "hasUnpublishedChanges": list.HasUnpublishedChanges,
		"moduleTestPassed": list.ModuleTestPassed, "exerciseBankTestPassed": list.ExerciseBankTestPassed})
}

func (h *VersionHandler) publish(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req struct {
		Note string `json:"note"`
	}
	if c.Request.ContentLength != 0 && !bindBody(c, &req) {
		return
	}
	v, err := h.versions.Publish(c.Request.Context(), who, id, req.Note)
	if err != nil {
		versionFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"moduleId": id, "number": v.Number, "note": v.Note, "createdAt": v.CreatedAt})
}

// recordTest stores the result of a test the teacher ran in the screen of the module (SPEC-024 RN-13).
func (h *VersionHandler) recordTest(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	var req struct {
		Kind    domain.TestKind `json:"kind"`
		Passed  *bool           `json:"passed"`
		Summary json.RawMessage `json:"summary"`
	}
	if !bindBody(c, &req) {
		return
	}
	if req.Passed == nil {
		authFail(c, problem.Validation("The result of the test is required.", problem.InvalidParam{Name: "passed", Reason: "is required"}))
		return
	}
	r, err := h.versions.RecordTestResult(c.Request.Context(), who, id, req.Kind, *req.Passed, req.Summary)
	if err != nil {
		versionFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": r.ID, "kind": r.Kind, "passed": r.Passed, "contentHash": r.ContentHash, "createdAt": r.CreatedAt})
}

func (h *VersionHandler) restore(c *gin.Context) {
	id, ok := moduleID(c)
	who, authed := actor(c)
	if !ok || !authed {
		return
	}
	number, err := strconv.Atoi(c.Param("number"))
	if err != nil || number < 1 {
		authFail(c, problem.NotFound("version-not-found", "The version does not exist."))
		return
	}
	blocks, setup, err := h.versions.Restore(c.Request.Context(), who, id, number)
	if err != nil {
		versionFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"moduleId": id, "blocks": toAuthoredList(blocks), "setup": setupOrNull(setup)})
}

func versionFail(c *gin.Context, err error) {
	var missing *service.MissingTestsError
	switch {
	case errors.As(err, &missing):
		err = problem.Conflict("module-not-tested", "The module must pass its tests before publishing.").WithExtension("missingTests", missing.Tests)
	case errors.Is(err, service.ErrInvalidTestKind):
		err = problem.Validation("The kind of the test is not valid.", problem.InvalidParam{Name: "kind", Reason: "must be MODULE or EXERCISE_BANK"})
	case errors.Is(err, service.ErrInvalidSummary):
		err = problem.Validation("The summary of the test is not valid.", problem.InvalidParam{Name: "summary", Reason: "must be a JSON object"})
	case errors.Is(err, service.ErrSummaryTooLarge):
		// SPEC-024 5 names this problem payload-too-large.
		err = problem.New(http.StatusRequestEntityTooLarge, "payload-too-large", "The summary of the test has at most 64 KB.")
	case errors.Is(err, service.ErrNoChanges):
		err = problem.Conflict("no-changes", "The draft has no changes since the latest version.")
	case errors.Is(err, service.ErrVersionNotFound):
		err = problem.NotFound("version-not-found", "The version does not exist.")
	case errors.Is(err, service.ErrNoteTooLong):
		err = problem.Validation("The note is too long.", problem.InvalidParam{Name: "note", Reason: "must have at most 200 characters"})
	}
	authorFail(c, err)
}
