// Package server builds the Gin engine with the global middlewares and runs
// the HTTP server with graceful shutdown.
package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server/middleware"
)

// Routes registers the routes of one module under /api/v1.
type Routes interface {
	Register(r gin.IRouter)
}

// NewEngine builds the Gin engine with the global middlewares, in order:
// correlation ID, access log, panic recovery and RFC 7807 errors.
func NewEngine(log *zap.Logger, routes ...Routes) *gin.Engine {
	engine := gin.New()
	engine.HandleMethodNotAllowed = false
	engine.Use(
		middleware.CorrelationID(log),
		middleware.AccessLog(log),
		middleware.Recovery(log),
		middleware.Errors(log),
	)
	engine.NoRoute(middleware.NoRoute)

	api := engine.Group("/api/v1")
	for _, r := range routes {
		r.Register(api)
	}
	return engine
}

// Server is the HTTP server.
type Server struct {
	http *http.Server
	log  *zap.Logger
}

// New creates a server listening on addr.
func New(addr string, handler http.Handler, log *zap.Logger) *Server {
	return &Server{
		http: &http.Server{
			Addr:              addr,
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
			ErrorLog:          zap.NewStdLog(log.Named("http")),
		},
		log: log,
	}
}

// Run serves until ctx is cancelled, then stops accepting connections and
// waits for in-flight requests until shutdownTimeout. It returns the
// remaining shutdown context so later steps share the same deadline.
func (s *Server) Run(ctx context.Context, shutdownTimeout time.Duration) (context.Context, context.CancelFunc, error) {
	ln, err := net.Listen("tcp", s.http.Addr)
	if err != nil {
		return nil, nil, fmt.Errorf("listen on %s: %w", s.http.Addr, err)
	}
	return s.Serve(ctx, ln, shutdownTimeout)
}

// Serve is Run on an existing listener.
func (s *Server) Serve(ctx context.Context, ln net.Listener, shutdownTimeout time.Duration) (context.Context, context.CancelFunc, error) {
	serveErr := make(chan error, 1)
	go func() {
		s.log.Info("http server listening", zap.String("addr", ln.Addr().String()))
		serveErr <- s.http.Serve(ln)
	}()

	select {
	case err := <-serveErr:
		return nil, nil, fmt.Errorf("http server stopped: %w", err)
	case <-ctx.Done():
	}

	s.log.Info("shutting down http server", zap.Duration("timeout", shutdownTimeout))
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	if err := s.http.Shutdown(shutdownCtx); err != nil {
		return shutdownCtx, cancel, fmt.Errorf("shutdown http server: %w", err)
	}
	if err := <-serveErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return shutdownCtx, cancel, fmt.Errorf("http server stopped: %w", err)
	}
	return shutdownCtx, cancel, nil
}
