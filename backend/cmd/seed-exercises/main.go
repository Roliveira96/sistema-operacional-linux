// Command seed-exercises loads a list of exercises into the bank of a module (SPEC-023), as the teacher who owns it: each exercise is
// created in the bank, linked to the practice or to the assessment and published. It uses the same environment variables as the API
// and can be run again, since an exercise with the same title is not repeated.
// Usage: go run ./cmd/seed-exercises -module <module id> -file seeds/historia-do-linux-exercicios.json
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/google/uuid"
	"go.uber.org/zap"

	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/seed/bank"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
)

func main() {
	os.Exit(run())
}

func run() int {
	moduleFlag := flag.String("module", "", "id of the module that receives the exercises")
	file := flag.String("file", "", "path of the JSON file with the exercises")
	flag.Parse()

	moduleID, err := uuid.Parse(*moduleFlag)
	if err != nil || *file == "" {
		fmt.Fprintln(os.Stderr, "usage: seed-exercises -module <module id> -file <exercises.json>")
		return 2
	}
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

	if err := load(cfg, moduleID, *file, log); err != nil {
		log.Error("exercises seed failed", zap.Error(err))
		return 1
	}
	return 0
}

func load(cfg config.Config, moduleID uuid.UUID, path string, log *zap.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open exercises: %w", err)
	}
	defer f.Close()
	items, err := bank.Parse(f)
	if err != nil {
		return err
	}

	db, err := database.Open(ctx, cfg.Database, log)
	if err != nil {
		return err
	}
	defer db.Close()

	repo := contentrepository.New(db)
	owner, err := repo.ModuleTeacher(ctx, moduleID)
	if err != nil {
		return fmt.Errorf("find the teacher of the module: %w", err)
	}
	result, err := bank.Load(ctx, contentservice.NewExercises(repo, log), contentservice.Actor{UserID: owner, Role: "TEACHER"}, moduleID, items)
	if err != nil {
		return err
	}
	log.Info("exercises loaded", zap.Int("created", result.Created), zap.Int("skipped", result.Skipped))
	return nil
}
