package scheduler

import (
	"context"
	"database/sql"
	"hash/fnv"
)

// PostgresLocker takes PostgreSQL session advisory locks, one per task name, on a dedicated connection.
type PostgresLocker struct {
	db *sql.DB
}

// NewPostgresLocker creates a locker over db.
func NewPostgresLocker(db *sql.DB) *PostgresLocker { return &PostgresLocker{db: db} }

func lockKey(name string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("scheduler:" + name))
	return int64(h.Sum64())
}

// TryLock takes the lock of name without waiting. The connection stays reserved until unlock.
func (l *PostgresLocker) TryLock(ctx context.Context, name string) (func(), bool, error) {
	conn, err := l.db.Conn(ctx)
	if err != nil {
		return nil, false, err
	}
	key := lockKey(name)
	var ok bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&ok); err != nil {
		_ = conn.Close()
		return nil, false, err
	}
	if !ok {
		_ = conn.Close()
		return nil, false, nil
	}
	unlock := func() {
		_, _ = conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock($1)", key)
		_ = conn.Close()
	}
	return unlock, true, nil
}
