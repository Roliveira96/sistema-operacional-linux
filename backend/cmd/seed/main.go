// Command seed loads the content manifest into the database (SPEC-011). It
// applies pending migrations first and uses the same environment variables
// as the API. Usage: go run ./cmd/seed [-manifest path/to/content_manifest.json.gz]
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"

	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/seed/data"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	userservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

func main() {
	os.Exit(run())
}

func run() int {
	manifestPath := flag.String("manifest", "", "path to a gzip manifest; defaults to the embedded one")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "invalid configuration:", err)
		return 1
	}
	log, flush, err := logger.New(logger.Options{Production: cfg.IsProduction(), Level: cfg.LogLevel})
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to create logger:", err)
		return 1
	}
	defer flush()

	if err := seed(cfg, *manifestPath, log); err != nil {
		log.Error("content seed failed", zap.Error(err))
		return 1
	}
	return 0
}

func seed(cfg config.Config, manifestPath string, log *zap.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var source io.Reader = bytes.NewReader(data.Manifest)
	if manifestPath != "" {
		f, err := os.Open(manifestPath)
		if err != nil {
			return fmt.Errorf("open manifest: %w", err)
		}
		defer f.Close()
		source = f
	}
	manifest, err := contentservice.ReadManifest(source)
	if err != nil {
		return err
	}

	db, err := database.Open(ctx, cfg.Database, log)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.Migrate(ctx, cfg.Database.Schema, migrations.FS, log); err != nil {
		return err
	}

	seeder := contentservice.NewSeeder(
		cmservice.NewSeeder(cmrepository.New(db)),
		userservice.New(userrepository.New(db)),
		contentrepository.New(db),
		db,
		log,
	)
	_, err = seeder.Run(ctx, manifest, cfg.Auth.AdminEmail)
	return err
}
