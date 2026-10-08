package database

import (
	"context"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"
	"go.uber.org/zap"
)

// Migrate applies every pending migration from fsys. The schema is created
// first (idempotently) because goose keeps its version table inside it.
func (d *DB) Migrate(ctx context.Context, schema string, fsys fs.FS, log *zap.Logger) error {
	sqlDB, err := d.SQL()
	if err != nil {
		return err
	}
	if _, err := sqlDB.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS "+schema); err != nil {
		return fmt.Errorf("create schema %s: %w", schema, err)
	}

	store, err := database.NewStore(database.DialectPostgres, schema+".goose_db_version")
	if err != nil {
		return fmt.Errorf("create migration store: %w", err)
	}
	provider, err := goose.NewProvider("", sqlDB, fsys, goose.WithStore(store))
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}

	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	for _, r := range results {
		log.Info("migration applied",
			zap.Int64("version", r.Source.Version),
			zap.String("file", r.Source.Path),
			zap.Duration("elapsed", r.Duration))
	}
	return nil
}
