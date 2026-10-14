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
	classlinkhandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/handler"
	classlinkrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/repository"
	classlinkservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/service"
	classroomhandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	classroomrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/repository"
	classroomservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contenthandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/handler"
	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	coursemodulehandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/handler"
	coursemodulerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	coursemoduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	mcphandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/handler"
	mcpservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/service"
	practicehandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/handler"
	practicerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/repository"
	practiceservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	schedulehandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/handler"
	schedulerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/repository"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	studenthandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/handler"
	studentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/repository"
	studentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/service"
	ttshandler "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/tts/handler"
	ttsservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/tts/service"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	userservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/service"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/health"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/scheduler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/speech"
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
	// The images of the content are read by the students without a session, so that prefix (and only it) is public (SPEC-025 RN-07).
	if err := store.AllowPublicRead(ctx, contentdomain.ImagePrefix); err != nil {
		log.Error("could not open the images of the content for reading", zap.Error(err))
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
		Users:        users,
		Store:        authStore,
		AccessTokens: authStore,
		OAuth:        authStore,
		NotFound:     authrepository.ErrNotFound,
		Auditor:      auditor,
		Mailer:       dispatcher,
		Tx:           db,
		Hasher:       authservice.Argon2Hasher{},
		GoogleOAuth:  googleOAuth,
		PublicURL:    cfg.Auth.PublicURL,
		Log:          log,
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

	accessTokenHandler := authhandler.NewAccessTokens(auth, auth, ratelimit.New(10, time.Hour))
	mcpOAuthHandler := authhandler.NewMCPOAuth(auth, auth,
		authhandler.MCPOAuthURLs{Backend: cfg.Auth.MCPPublicURL, Frontend: cfg.Auth.PublicURL},
		ratelimit.New(10, time.Hour), ratelimit.New(30, time.Minute))

	// The schedule of the classes (SPEC-042): its e-mails wait in the outbox and the scheduler delivers them.
	scheduleService := scheduleservice.New(schedulerepository.New(db), time.Now, cfg.Auth.PublicURL)
	scheduleHandler := schedulehandler.New(scheduleService, auth)
	classLinkHandler := classlinkhandler.New(classlinkservice.New(classlinkrepository.New(db)), auth)

	// The live classroom (SPEC-051): its realtime hub lives in memory, and a room left without its teacher is ended by the scheduler.
	classroomService := classroomservice.New(classroomrepository.New(db), store, time.Now)
	classroomHandler := classroomhandler.New(classroomService, auth, log, classroomhandler.Options{
		AllowedOrigins: []string{cfg.Auth.PublicURL},
		AnyOrigin:      cfg.IsDevelopment(),
	})
	classroomService.WithOnEnded(classroomHandler.CloseRoom)
	classroomSweep := func(ctx context.Context, _ time.Time) error {
		_, err := classroomService.EndAbandoned(ctx, classroomHandler.ControllerConnected)
		return err
	}

	classRepo := classgrouprepository.New(db)
	classService := classgroupservice.New(classRepo).WithScheduleHook(scheduleService)
	classHandler := classgrouphandler.New(classService, auth).WithUserNames(classService)

	if err := startScheduler(ctx, db, smtp, scheduleService, classroomSweep, log); err != nil {
		return err
	}

	moduleRepo := coursemodulerepository.New(db)
	moduleService := coursemoduleservice.New(moduleRepo)
	// A lesson can point to a presentation and to a teaching module (SPEC-053 RN-04).
	scheduleService.WithContentRefs(scheduleDecks{classroom: classroomService}, scheduleModules{modules: moduleService})
	moduleHandler := coursemodulehandler.New(moduleService, auth)
	contentReader := contentservice.NewReader(moduleService, contentrepository.New(db))
	contentHandler := contenthandler.New(contentReader, auth)
	contentRepo := contentrepository.New(db)
	// A module is born with its version 1 published (SPEC-021 RN-11).
	moduleService.SetInitialVersioner(contentservice.NewInitialVersions(contentRepo))
	// The writes of the authoring screens and of the MCP server count together (SPEC-024 RN-10).
	authoringLimiter := ratelimit.New(120, time.Minute)
	contentAuthor := contentservice.NewAuthor(contentRepo, log)
	contentVersions := contentservice.NewVersions(contentRepo, log)
	contentExercises := contentservice.NewExercises(contentRepo, log)
	contentAuthorHandler := contenthandler.NewAuthor(contentAuthor, auth, authoringLimiter)
	contentVersionHandler := contenthandler.NewVersions(contentVersions, auth, ratelimit.New(120, time.Minute))
	contentImageHandler := contenthandler.NewImages(contentservice.NewImages(store, log, 2), auth, ratelimit.New(30, time.Minute))
	contentExerciseHandler := contenthandler.NewExercises(contentExercises, auth, ratelimit.New(120, time.Minute))
	bearer := authn.BearerOptions{ResourceMetadataURL: cfg.Auth.MCPPublicURL + authhandler.ProtectedResourceMetadataPath}
	if email := cfg.Auth.MCPDevUserEmail; email != "" {
		// Local development only: config refuses this variable in production (SPEC-024 RN-15).
		log.Warn("MCP runs without login as a local development user", zap.String("email", email))
		bearer.DevUser = func(ctx context.Context) (authn.Principal, error) { return auth.DevPrincipal(ctx, email) }
	}
	practiceRepo := practicerepository.New(db)
	// The correction of descriptive answers (SPEC-039): the teacher confirms on the web, the agent suggests through the MCP.
	grading := practiceservice.NewGrading(practiceRepo, contentExercises)
	gradingHandler := practicehandler.NewGrading(grading, auth)
	practiceHandler := practicehandler.New(
		practiceservice.New(contentReader, practiceRepo), auth,
		ratelimit.New(30, time.Minute), ratelimit.New(120, time.Minute))

	ttsHandler := ttshandler.New(
		ttsservice.New(speech.NewClient(), ttsservice.Options{Timeout: cfg.TTS.Timeout, MaxConcurrent: cfg.TTS.MaxConcurrent}),
		auth, ratelimit.New(cfg.TTS.RatePerMinute, time.Minute), log)

	studentRepo := studentrepository.New(db)
	studentService := studentservice.New(studentservice.Deps{
		Repo:    studentRepo,
		Users:   users,
		Storage: store,
		Hasher:  authservice.Argon2Hasher{},
		Mailer:  dispatcher,
	})
	studentHandler := studenthandler.New(studentService, auth)
	mcpHandler := mcphandler.New(
		mcpservice.New(moduleService, contentAuthor, contentExercises, contentVersions, authoringLimiter, log).
			WithGrading(grading).WithStudents(studentService, classService),
		authn.RequiredBearerWith(auth, bearer), log)

	checker := health.NewChecker(health.DefaultTimeout,
		health.Check{Name: "postgres", Critical: true, Ping: db.Ping},
		health.Check{Name: "minio", Ping: store.Ping},
		health.Check{Name: "smtp", Ping: smtp.Ping},
	)

	gin.SetMode(gin.ReleaseMode)
	engine := server.NewEngine(log, cfg.TrustedProxies,
		health.NewHandler(checker, version, log),
		authHandler,
		accessTokenHandler,
		mcpOAuthHandler,
		classHandler,
		moduleHandler,
		contentHandler,
		contentAuthorHandler,
		contentVersionHandler,
		contentExerciseHandler,
		contentImageHandler,
		practiceHandler,
		gradingHandler,
		ttsHandler,
		studentHandler,
		scheduleHandler,
		classLinkHandler,
		classroomHandler,
	)
	mcpOAuthHandler.RegisterRoot(engine)
	mcpHandler.Register(engine)
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

// startScheduler registers the periodic jobs of the schedule (SPEC-042) and runs them in the background until ctx ends.
func startScheduler(ctx context.Context, db *database.DB, sender mailer.Sender, schedule *scheduleservice.Service, classroomSweep func(context.Context, time.Time) error, log *zap.Logger) error {
	sqlDB, err := db.SQL()
	if err != nil {
		return err
	}
	jobs := scheduler.New(scheduler.NewPostgresLocker(sqlDB), time.Now, log)
	outbox := mailer.NewOutboxStore(db)
	opts := mailer.DefaultOutboxOptions()
	jobs.Add(scheduler.Task{Name: "email-outbox", Every: time.Minute, Run: func(ctx context.Context, now time.Time) error {
		return mailer.DeliverDue(ctx, outbox, sender, now, opts)
	}})
	jobs.Add(scheduler.Task{Name: "session-reminders", Every: 5 * time.Minute, Run: schedule.SendReminders})
	jobs.Add(scheduler.Task{Name: "enrollment-agendas", Every: 5 * time.Minute, Run: schedule.SendEnrollmentAgendas})
	jobs.Add(scheduler.Task{Name: "weekly-digest", Every: 15 * time.Minute, Run: schedule.SendWeeklyDigest})
	jobs.Add(scheduler.Task{Name: "national-holidays", Every: 24 * time.Hour, Run: schedule.RefreshNationalHolidays})
	jobs.Add(scheduler.Task{Name: "classroom-safety-net", Every: 10 * time.Minute, Run: classroomSweep})
	go jobs.Start(ctx, 30*time.Second)
	return nil
}
