// Command api is the composition root of the backend: it loads the
// configuration, builds every dependency, applies migrations and serves HTTP
// until SIGINT or SIGTERM, then shuts down gracefully.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/health"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/storage"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

// version is injected at build time with -ldflags "-X main.version=<value>".
var version = "dev"

func main() {
	os.Exit(run())
}

func run() int {
	cfg, cfgErr := config.Load()

	logOpts := logger.Options{Production: cfg.IsProduction(), Level: cfg.LogLevel}
	if cfgErr != nil {
		// The configuration is invalid, so log with safe defaults.
		logOpts = logger.Options{Production: os.Getenv("APP_ENV") == config.EnvProduction, Level: "info"}
	}
	log, flush, err := logger.New(logOpts)
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to create logger:", err)
		return 1
	}
	defer flush()

	if cfgErr != nil {
		log.Error("invalid configuration", zap.Error(cfgErr))
		return 1
	}

	if err := start(cfg, log); err != nil {
		log.Error("application stopped with error", zap.Error(err))
		return 1
	}
	log.Info("application stopped")
	return 0
}

func start(cfg config.Config, log *zap.Logger) (err error) {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Info("starting application", zap.String("version", version), zap.String("env", cfg.AppEnv))

	db, err := database.Open(ctx, cfg.Database, log)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := db.Close(); cerr != nil {
			err = errors.Join(err, fmt.Errorf("close database: %w", cerr))
		}
	}()

	if err := db.Migrate(ctx, cfg.Database.Schema, migrations.FS, log); err != nil {
		return err
	}

	store, err := storage.New(cfg.Storage)
	if err != nil {
		return err
	}
	// MinIO is not critical: the service starts degraded when it is down.
	if err := store.EnsureBucket(ctx); err != nil {
		log.Error("could not ensure storage bucket; starting degraded", zap.Error(err))
	}

	smtp := mailer.NewSMTPSender(cfg.Mail)
	dispatcher := mailer.NewDispatcher(smtp, mailer.DefaultDispatcherOptions(cfg.Mail.Workers), log)

	checker := health.NewChecker(health.DefaultTimeout,
		health.Check{Name: "postgres", Critical: true, Ping: db.Ping},
		health.Check{Name: "minio", Ping: store.Ping},
		health.Check{Name: "smtp", Ping: smtp.Ping},
	)

	gin.SetMode(gin.ReleaseMode)
	engine := server.NewEngine(log,
		health.NewHandler(checker, version, log),
	)
	srv := server.New(cfg.HTTPAddr, engine, log)

	shutdownCtx, cancel, err := srv.Run(ctx, cfg.ShutdownTimeout)
	if cancel != nil {
		defer cancel()
	}
	if shutdownCtx == nil {
		shutdownCtx = context.Background()
	}
	if derr := dispatcher.Shutdown(shutdownCtx); derr != nil {
		err = errors.Join(err, fmt.Errorf("drain mail queue: %w", derr))
	}
	return err
}
