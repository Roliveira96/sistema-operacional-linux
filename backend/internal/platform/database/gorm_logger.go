package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
)

const slowQueryThreshold = 200 * time.Millisecond

// gormLogger routes GORM output to zap. Query errors are logged at debug level
// only: they are returned to the caller and logged once at the HTTP edge.
type gormLogger struct {
	log *zap.Logger
}

func newGormLogger(log *zap.Logger) gormlogger.Interface {
	return gormLogger{log: log}
}

func (g gormLogger) LogMode(gormlogger.LogLevel) gormlogger.Interface { return g }

func (g gormLogger) Info(ctx context.Context, msg string, args ...any) {
	g.from(ctx).Info(fmt.Sprintf(msg, args...))
}

func (g gormLogger) Warn(ctx context.Context, msg string, args ...any) {
	g.from(ctx).Warn(fmt.Sprintf(msg, args...))
}

func (g gormLogger) Error(ctx context.Context, msg string, args ...any) {
	g.from(ctx).Error(fmt.Sprintf(msg, args...))
}

func (g gormLogger) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	elapsed := time.Since(begin)
	log := g.from(ctx)

	switch {
	case err != nil && !errors.Is(err, gorm.ErrRecordNotFound):
		sql, rows := fc()
		log.Debug("query failed", zap.String("sql", sql), zap.Int64("rows", rows),
			zap.Duration("elapsed", elapsed), zap.Error(err))
	case elapsed > slowQueryThreshold:
		sql, rows := fc()
		log.Warn("slow query", zap.String("sql", sql), zap.Int64("rows", rows), zap.Duration("elapsed", elapsed))
	case log.Core().Enabled(zap.DebugLevel):
		sql, rows := fc()
		log.Debug("query", zap.String("sql", sql), zap.Int64("rows", rows), zap.Duration("elapsed", elapsed))
	}
}

func (g gormLogger) from(ctx context.Context) *zap.Logger {
	return logger.FromContext(ctx, g.log).Named("gorm")
}
