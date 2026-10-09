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
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	authhandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/handler"
	authrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/repository"
	authservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/service"
	classgrouphandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/handler"
	classgrouprepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	classgroupservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	contenthandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/handler"
	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	coursemodulehandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/handler"
	coursemodulerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	coursemoduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	practicehandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/handler"
	practicerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/repository"
	practiceservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	studenthandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/handler"
	studentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/repository"
	studentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/service"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	userservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/service"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/health"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
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

	users := userservice.New(userrepository.New(db))
	authStore := authrepository.New(db)
	auditor := authservice.NewAsyncAuditor(authStore, log)
	googleOAuth := authservice.NewGoogleOAuthProvider(
		cfg.Auth.Google.ClientID,
		cfg.Auth.Google.ClientSecret,
		cfg.Auth.Google.RedirectURL,
	)
	auth, err := authservice.New(authservice.Deps{
		Users:       users,
		Store:       authStore,
		NotFound:    authrepository.ErrNotFound,
		Auditor:     auditor,
		Mailer:      dispatcher,
		Tx:          db,
		Hasher:      authservice.Argon2Hasher{},
		GoogleOAuth: googleOAuth,
		PublicURL:   cfg.Auth.PublicURL,
		Log:         log,
	})
	if err != nil {
		return err
	}
	created, err := auth.SeedAdmin(ctx, cfg.Auth.AdminEmail, cfg.Auth.AdminInitialPassword)
	if err != nil {
		return fmt.Errorf("seed admin: %w", err)
	}
	if created {
		log.Info("default admin account created", zap.String("email", cfg.Auth.AdminEmail))
	}
	authHandler := authhandler.New(auth, authhandler.Limiters{
		LoginIP:       ratelimit.New(20, time.Minute),
		LoginFailures: ratelimit.New(5, 15*time.Minute),
		ForgotIP:      ratelimit.New(20, time.Minute),
		ForgotID:      ratelimit.New(3, time.Hour),
	}, !cfg.IsDevelopment())

	classRepo := classgrouprepository.New(db)
	classService := classgroupservice.New(classRepo)
	classHandler := classgrouphandler.New(classService, auth)

	moduleRepo := coursemodulerepository.New(db)
	moduleService := coursemoduleservice.New(moduleRepo)
	moduleHandler := coursemodulehandler.New(moduleService, auth)
	contentReader := contentservice.NewReader(moduleService, contentrepository.New(db))
	contentHandler := contenthandler.New(contentReader, auth)
	practiceHandler := practicehandler.New(
		practiceservice.New(contentReader, practicerepository.New(db)), auth,
		ratelimit.New(30, time.Minute), ratelimit.New(120, time.Minute))

	studentRepo := studentrepository.New(db)
	studentService := studentservice.New(studentservice.Deps{
		Repo:    studentRepo,
		Users:   users,
		Storage: store,
		Hasher:  authservice.Argon2Hasher{},
		Mailer:  dispatcher,
	})
	studentHandler := studenthandler.New(studentService, auth)

	checker := health.NewChecker(health.DefaultTimeout,
		health.Check{Name: "postgres", Critical: true, Ping: db.Ping},
		health.Check{Name: "minio", Ping: store.Ping},
		health.Check{Name: "smtp", Ping: smtp.Ping},
	)

	gin.SetMode(gin.ReleaseMode)
	engine := server.NewEngine(log, cfg.TrustedProxies,
		health.NewHandler(checker, version, log),
		authHandler,
		classHandler,
		moduleHandler,
		contentHandler,
		practiceHandler,
		studentHandler,
	)
	srv := server.New(cfg.HTTPAddr, engine, log)

	shutdownCtx, cancel, err := srv.Run(ctx, cfg.ShutdownTimeout)
	if cancel != nil {
		defer cancel()
	}
	if shutdownCtx == nil {
		shutdownCtx = context.Background()
	}
	if aerr := auditor.Shutdown(shutdownCtx); aerr != nil {
		err = errors.Join(err, fmt.Errorf("drain audit queue: %w", aerr))
	}
	if derr := dispatcher.Shutdown(shutdownCtx); derr != nil {
		err = errors.Join(err, fmt.Errorf("drain mail queue: %w", derr))
	}
	return err
}
