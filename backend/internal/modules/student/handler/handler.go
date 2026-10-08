// Package handler exposes REST endpoints for student management, CSV onboarding and invites (SPEC-002).
package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	authdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
)

// StudentService defines operations needed by the student HTTP handler.
type StudentService interface {
	RegisterManual(ctx context.Context, req service.RegisterManualRequest) (service.RegisterManualResponse, error)
	ImportCSV(ctx context.Context, classGroupID *uuid.UUID, r io.Reader) (domain.CSVImportResult, error)
	JoinByInvite(ctx context.Context, token string, req service.JoinByInviteRequest) (service.JoinByInviteResponse, error)
	UpdateAvatar(ctx context.Context, userID uuid.UUID, r io.Reader, size int64, contentType string) (string, error)
	GetProfile(ctx context.Context, userID uuid.UUID) (domain.StudentProfileResponse, error)
	ListStudents(ctx context.Context, page, perPage int, search string) (service.ListStudentsResponse, error)
}

// Handler manages student HTTP endpoints.
type Handler struct {
	svc          StudentService
	auth         authn.Validator
	inviteLimiter *ratelimit.Limiter
	now          func() time.Time
}

// New creates a new student handler.
func New(svc StudentService, auth authn.Validator) *Handler {
	return &Handler{
		svc:           svc,
		auth:          auth,
		inviteLimiter: ratelimit.New(10, time.Hour), // 10 signups per IP per hour (P-07)
		now:           time.Now,
	}
}

// WithClock sets a custom clock for rate limiting and time operations.
func (h *Handler) WithClock(now func() time.Time) *Handler {
	h.now = now
	h.inviteLimiter = ratelimit.NewWithClock(10, time.Hour, now)
	return h
}

// Register registers student endpoints onto the Gin router.
func (h *Handler) Register(r gin.IRouter) {
	// Public endpoint for self-registration via class invite link (with rate limiting)
	r.POST("/invites/:token/join", h.joinByInvite)

	// Teacher & Admin endpoints
	teacherGroup := r.Group("/students", authn.Required(h.auth), authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacherGroup.POST("", h.registerManual)
	teacherGroup.POST("/import-csv", h.importCSV)
	teacherGroup.GET("", h.listStudents)

	// Student profile & avatar endpoints
	studentGroup := r.Group("/students/me", authn.Required(h.auth), authn.Roles(authn.RoleStudent))
	studentGroup.GET("", h.getProfile)
	studentGroup.PATCH("/avatar", h.updateAvatar)
}

type manualStudentInput struct {
	AcademicID   string     `json:"academicId"`
	Email        string     `json:"email"`
	Name         *string    `json:"name"`
	Whatsapp     *string    `json:"whatsapp"`
	Discord      *string    `json:"discord"`
	ClassGroupID *uuid.UUID `json:"classGroupId"`
}

func (h *Handler) registerManual(c *gin.Context) {
	var input manualStudentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, problem.BadRequest("validation-error", "Dados da requisição inválidos."))
		return
	}

	if strings.TrimSpace(input.AcademicID) == "" || strings.TrimSpace(input.Email) == "" {
		fail(c, problem.BadRequest("validation-error", "Campos academicId e email são obrigatórios."))
		return
	}

	res, err := h.svc.RegisterManual(c.Request.Context(), service.RegisterManualRequest{
		AcademicID:   input.AcademicID,
		Email:        input.Email,
		Name:         input.Name,
		Whatsapp:     input.Whatsapp,
		Discord:      input.Discord,
		ClassGroupID: input.ClassGroupID,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusCreated, res)
}

func (h *Handler) importCSV(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		fail(c, problem.BadRequest("csv-invalid", "Arquivo CSV não fornecido."))
		return
	}

	if fileHeader.Size > domain.MaxCSVFileSize {
		fail(c, problem.PayloadTooLarge("Arquivo CSV excede o limite de 2 MB."))
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		fail(c, problem.BadRequest("csv-invalid", "Falha ao abrir arquivo CSV."))
		return
	}
	defer file.Close()

	var classGroupID *uuid.UUID
	if rawClassID := strings.TrimSpace(c.PostForm("classGroupId")); rawClassID != "" {
		parsed, err := uuid.Parse(rawClassID)
		if err != nil {
			fail(c, problem.BadRequest("validation-error", "ID da turma inválido."))
			return
		}
		classGroupID = &parsed
	}

	result, err := h.svc.ImportCSV(c.Request.Context(), classGroupID, file)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) listStudents(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "20"))
	search := c.Query("search")

	res, err := h.svc.ListStudents(c.Request.Context(), page, perPage, search)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, res)
}

func (h *Handler) getProfile(c *gin.Context) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Autenticação requerida."))
		return
	}

	res, err := h.svc.GetProfile(c.Request.Context(), p.UserID)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, res)
}

func (h *Handler) updateAvatar(c *gin.Context) {
	p, ok := authn.FromContext(c.Request.Context())
	if !ok {
		fail(c, problem.Unauthorized("not-authenticated", "Autenticação requerida."))
		return
	}

	fileHeader, err := c.FormFile("avatar")
	if err != nil {
		fail(c, problem.BadRequest("unsupported-image", "Arquivo de avatar não fornecido."))
		return
	}

	if fileHeader.Size > domain.MaxAvatarFileSize {
		fail(c, problem.PayloadTooLarge("Imagem excede o limite máximo de 5 MB."))
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		fail(c, problem.BadRequest("unsupported-image", "Falha ao abrir imagem."))
		return
	}
	defer file.Close()

	contentType := fileHeader.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}

	avatarURL, err := h.svc.UpdateAvatar(c.Request.Context(), p.UserID, file, fileHeader.Size, contentType)
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusOK, gin.H{"avatarUrl": avatarURL})
}

type joinInviteInput struct {
	AcademicID string  `json:"academicId"`
	Email      string  `json:"email"`
	Name       string  `json:"name"`
	Password   string  `json:"password"`
	Whatsapp   *string `json:"whatsapp"`
	Discord    *string `json:"discord"`
}

func (h *Handler) joinByInvite(c *gin.Context) {
	clientIP := c.ClientIP()
	if ok, _ := h.inviteLimiter.Allow(clientIP); !ok {
		fail(c, problem.TooManyRequests("Limite de cadastros excedido. Tente novamente mais tarde.", 3600))
		return
	}

	token := strings.TrimSpace(c.Param("token"))
	if token == "" {
		fail(c, problem.NotFound("invite-not-found", "Token de convite não informado."))
		return
	}

	var input joinInviteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, problem.BadRequest("validation-error", "Dados da requisição inválidos."))
		return
	}

	if strings.TrimSpace(input.AcademicID) == "" || strings.TrimSpace(input.Email) == "" || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Password) == "" {
		fail(c, problem.BadRequest("validation-error", "Nome, RA, e-mail e senha são obrigatórios."))
		return
	}

	res, err := h.svc.JoinByInvite(c.Request.Context(), token, service.JoinByInviteRequest{
		AcademicID: input.AcademicID,
		Email:      input.Email,
		Name:       input.Name,
		Password:   input.Password,
		Whatsapp:   input.Whatsapp,
		Discord:    input.Discord,
	})
	if err != nil {
		fail(c, toProblem(err))
		return
	}

	c.JSON(http.StatusCreated, res)
}

func toProblem(err error) *problem.Problem {
	var policyErr *authdomain.PolicyError
	if errors.As(err, &policyErr) {
		return problem.BadRequest("weak-password", "A senha fornecida não atende às diretrizes de segurança.")
	}

	switch {
	case errors.Is(err, domain.ErrInvalidAcademicID), errors.Is(err, domain.ErrInvalidEmail):
		return problem.BadRequest("validation-error", err.Error())
	case errors.Is(err, domain.ErrEmailAlreadyRegistered), errors.Is(err, userdomain.ErrEmailTaken):
		return problem.Conflict("email-already-registered", "E-mail já cadastrado.")
	case errors.Is(err, domain.ErrAcademicIDAlreadyRegistered), errors.Is(err, userdomain.ErrAcademicIDTaken):
		return problem.Conflict("academic-id-already-registered", "RA já cadastrado.")
	case errors.Is(err, domain.ErrClassNotFound):
		return problem.NotFound("class-group-not-found", "Turma não encontrada.")
	case errors.Is(err, domain.ErrInviteNotFound), errors.Is(err, domain.ErrInviteExpired):
		return problem.NotFound("invite-not-found", "Convite inexistente ou expirado.")
	case errors.Is(err, domain.ErrStudentNotFound):
		return problem.NotFound("student-not-found", "Estudante não encontrado.")
	case errors.Is(err, domain.ErrNotAStudent):
		return problem.Forbidden("forbidden", "Operação restrita a estudantes.")
	case errors.Is(err, domain.ErrInvalidCSV):
		return problem.BadRequest("csv-invalid", "Arquivo CSV inválido ou sem cabeçalhos obrigatórios.")
	case errors.Is(err, domain.ErrCSVFileTooLarge):
		return problem.PayloadTooLarge("Arquivo excede o limite máximo permitido.")
	case errors.Is(err, domain.ErrUnsupportedImageFormat), errors.Is(err, domain.ErrImageDimensions):
		return problem.BadRequest("unsupported-image", err.Error())
	case errors.Is(err, domain.ErrImageTooLarge):
		return problem.PayloadTooLarge("Imagem excede o limite de 5 MB.")
	default:
		return problem.Internal()
	}
}

func fail(c *gin.Context, p *problem.Problem) {
	c.Header("Content-Type", problem.ContentType)
	c.JSON(p.Status, p)
}
