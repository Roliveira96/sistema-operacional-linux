package health

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// Handler serves the health endpoint.
type Handler struct {
	checker *Checker
	version string
	log     *zap.Logger
}

// NewHandler creates the handler.
func NewHandler(checker *Checker, version string, log *zap.Logger) *Handler {
	return &Handler{checker: checker, version: version, log: log}
}

// Register mounts the route on the given group (expected: /api/v1).
func (h *Handler) Register(r gin.IRouter) {
	r.GET("/health", h.get)
}

type response struct {
	Status     string            `json:"status"`
	Version    string            `json:"version"`
	CheckedAt  string            `json:"checkedAt"`
	Components []ComponentResult `json:"components"`
}

func (h *Handler) get(c *gin.Context) {
	report := h.checker.Run(c.Request.Context())
	log := logger.FromContext(c.Request.Context(), h.log)

	var failed []string
	for _, comp := range report.Components {
		if comp.Err() != nil {
			failed = append(failed, comp.Name)
			log.Warn("health check failed", zap.String("component", comp.Name), zap.Error(comp.Err()))
		}
	}

	if !report.Available {
		_ = c.Error(problem.ServiceUnavailable("Unavailable dependencies: "+strings.Join(failed, ", ")).
			WithExtension("components", report.Components))
		return
	}

	c.JSON(http.StatusOK, response{
		Status:     report.Status,
		Version:    h.version,
		CheckedAt:  report.CheckedAt.Format(time.RFC3339),
		Components: report.Components,
	})
}
