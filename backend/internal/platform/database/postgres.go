// Package database owns the PostgreSQL connection, the base model, the
// context-propagated transaction manager and the migration runner.
package database

import (
	"context"
	"database/sql"
	"fmt"

	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
)

// DB wraps the GORM connection. Repositories obtain their handle through
// Conn so they automatically join a transaction carried by the context.
type DB struct {
	gorm *gorm.DB
}

// Open connects to PostgreSQL with search_path pinned to the project schema
// and applies the pool settings. It fails if the database is unreachable.
func Open(ctx context.Context, cfg config.DatabaseConfig, log *zap.Logger) (*DB, error) {
	gdb, err := gorm.Open(postgres.Open(DSN(cfg)), &gorm.Config{
		Logger:      newGormLogger(log),
		PrepareStmt: true,
	})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("get sql handle: %w", err)
	}
	sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)

	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &DB{gorm: gdb}, nil
}

// DSN builds the key/value connection string. The schema is validated by the
// config package as a plain identifier, so it needs no quoting.
func DSN(cfg config.DatabaseConfig) string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s search_path=%s sslmode=disable TimeZone=UTC",
		quote(cfg.Host), cfg.Port, quote(cfg.User), quote(cfg.Password), quote(cfg.Name), cfg.Schema,
	)
}

// quote escapes a libpq key/value parameter value.
func quote(v string) string {
	out := []byte{'\''}
	for i := 0; i < len(v); i++ {
		if v[i] == '\'' || v[i] == '\\' {
			out = append(out, '\\')
		}
		out = append(out, v[i])
	}
	return string(append(out, '\''))
}

// SQL returns the underlying *sql.DB, used by migrations and health checks.
func (d *DB) SQL() (*sql.DB, error) {
	return d.gorm.DB()
}

// Ping checks that the database answers.
func (d *DB) Ping(ctx context.Context) error {
	sqlDB, err := d.gorm.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}

// Close closes the connection pool.
func (d *DB) Close() error {
	sqlDB, err := d.gorm.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
