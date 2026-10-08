// Package dbtest starts a disposable, migrated PostgreSQL for integration
// tests. It is imported only by test files.
package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

// Schema is the schema used by integration tests.
const Schema = "linux_lab"

// Config starts a PostgreSQL container and returns its connection settings.
// Integration tests are skipped with -short.
func Config(t *testing.T) config.DatabaseConfig {
	t.Helper()
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	ctx := context.Background()
	container, err := postgres.Run(ctx, "postgres:18-alpine",
		postgres.WithDatabase("linux_lab_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(container) })

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatal(err)
	}
	port, err := container.MappedPort(ctx, "5432/tcp")
	if err != nil {
		t.Fatal(err)
	}
	return config.DatabaseConfig{
		Host: host, Port: int(port.Num()), Name: "linux_lab_test", User: "test", Password: "test",
		Schema: Schema, MaxOpenConns: 5, MaxIdleConns: 2, ConnMaxLifetime: time.Minute,
	}
}

// Open starts a container, connects and applies every migration.
func Open(t *testing.T) *database.DB {
	t.Helper()
	cfg := Config(t)
	db, err := database.Open(context.Background(), cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Migrate(context.Background(), cfg.Schema, migrations.FS, zap.NewNop()); err != nil {
		t.Fatal(err)
	}
	return db
}
