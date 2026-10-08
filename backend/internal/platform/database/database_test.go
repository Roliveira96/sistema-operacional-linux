package database

import (
	"context"
	"errors"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

const testSchema = "linux_lab"

// startPostgres runs a disposable PostgreSQL container. Integration tests are
// skipped with -short.
func startPostgres(t *testing.T) config.DatabaseConfig {
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
		Schema: testSchema, MaxOpenConns: 5, MaxIdleConns: 2, ConnMaxLifetime: time.Minute,
	}
}

func openMigrated(t *testing.T) *DB {
	t.Helper()
	cfg := startPostgres(t)
	db, err := Open(context.Background(), cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Migrate(context.Background(), cfg.Schema, migrations.FS, zap.NewNop()); err != nil {
		t.Fatal(err)
	}
	return db
}

// Covers SPEC-004 CA-03.
func TestMigrateCreatesSchemaAndIsIdempotent(t *testing.T) {
	db := openMigrated(t)
	ctx := context.Background()

	var exists bool
	if err := db.Conn(ctx).Raw(
		"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'goose_db_version')",
		testSchema).Scan(&exists).Error; err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("goose version table not created inside the schema")
	}
	if err := db.Migrate(ctx, testSchema, migrations.FS, zap.NewNop()); err != nil {
		t.Fatalf("second run failed: %v", err)
	}
}

// Covers SPEC-004 CA-04: a broken migration returns an error, which main
// treats as fatal before starting the HTTP server.
func TestMigrateFailsOnBrokenMigration(t *testing.T) {
	db := openMigrated(t)
	broken := fstest.MapFS{
		"00001_baseline.sql": {Data: mustRead(t, "00001_baseline.sql")},
		"00002_broken.sql":   {Data: []byte("-- +goose Up\nCREATE TABLE broken (;\n")},
	}
	err := db.Migrate(context.Background(), testSchema, broken, zap.NewNop())
	if err == nil || !strings.Contains(err.Error(), "apply migrations") {
		t.Fatalf("expected migration error, got %v", err)
	}
}

func mustRead(t *testing.T, name string) []byte {
	t.Helper()
	data, err := migrations.FS.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

type alpha struct {
	Model
	Name string
}

type beta struct {
	Model
	Name string
}

// Covers SPEC-004 CA-09 and CA-10.
func TestModelAndTransactions(t *testing.T) {
	db := openMigrated(t)
	ctx := context.Background()
	if err := db.Conn(ctx).AutoMigrate(&alpha{}, &beta{}); err != nil { // test-only tables
		t.Fatal(err)
	}

	t.Run("assigns ordered UUIDv7 ids", func(t *testing.T) {
		first, second := alpha{Name: "a"}, alpha{Name: "b"}
		if err := db.Conn(ctx).Create(&first).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Conn(ctx).Create(&second).Error; err != nil {
			t.Fatal(err)
		}
		if first.ID.Version() != 7 || second.ID.Version() != 7 {
			t.Fatalf("expected UUIDv7, got %s and %s", first.ID, second.ID)
		}
		if first.ID.String() >= second.ID.String() {
			t.Errorf("ids are not time ordered: %s >= %s", first.ID, second.ID)
		}
	})

	t.Run("keeps an explicit id", func(t *testing.T) {
		id := uuid.New()
		row := alpha{Model: Model{ID: id}, Name: "explicit"}
		if err := db.Conn(ctx).Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.ID != id {
			t.Errorf("id overwritten: %s", row.ID)
		}
	})

	t.Run("rolls back writes of every repository", func(t *testing.T) {
		boom := errors.New("boom")
		err := db.WithinTransaction(ctx, func(ctx context.Context) error {
			if err := db.Conn(ctx).Create(&alpha{Name: "rollback"}).Error; err != nil {
				return err
			}
			if err := db.Conn(ctx).Create(&beta{Name: "rollback"}).Error; err != nil {
				return err
			}
			return boom
		})
		if !errors.Is(err, boom) {
			t.Fatalf("got %v", err)
		}
		var count int64
		db.Conn(ctx).Model(&alpha{}).Where("name = ?", "rollback").Count(&count)
		var countBeta int64
		db.Conn(ctx).Model(&beta{}).Where("name = ?", "rollback").Count(&countBeta)
		if count != 0 || countBeta != 0 {
			t.Errorf("rows persisted after rollback: alpha=%d beta=%d", count, countBeta)
		}
	})

	t.Run("commits on success", func(t *testing.T) {
		err := db.WithinTransaction(ctx, func(ctx context.Context) error {
			return db.Conn(ctx).Create(&beta{Name: "commit"}).Error
		})
		if err != nil {
			t.Fatal(err)
		}
		var count int64
		db.Conn(ctx).Model(&beta{}).Where("name = ?", "commit").Count(&count)
		if count != 1 {
			t.Errorf("expected 1 committed row, got %d", count)
		}
	})

	t.Run("rolls back on panic", func(t *testing.T) {
		func() {
			defer func() { _ = recover() }()
			_ = db.WithinTransaction(ctx, func(ctx context.Context) error {
				db.Conn(ctx).Create(&alpha{Name: "panic"})
				panic("boom")
			})
		}()
		var count int64
		db.Conn(ctx).Model(&alpha{}).Where("name = ?", "panic").Count(&count)
		if count != 0 {
			t.Errorf("row persisted after panic: %d", count)
		}
	})
}

func TestDSNQuotesValues(t *testing.T) {
	dsn := DSN(config.DatabaseConfig{Host: "h", Port: 1, User: "u", Password: "p'w d", Name: "n", Schema: "s"})
	if !strings.Contains(dsn, `password='p\'w d'`) || !strings.Contains(dsn, "search_path=s") {
		t.Errorf("unexpected dsn %q", dsn)
	}
}
