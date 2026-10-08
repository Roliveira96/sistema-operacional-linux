// Package logger builds the application zap.Logger and carries request-scoped
// loggers through context.Context. There is no global logger: the root logger
// is created once in main and injected everywhere.
package logger

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Options configures the root logger.
type Options struct {
	// Production selects JSON output with buffered writes; otherwise a
	// human-readable console encoder is used.
	Production bool
	// Level is one of debug, info, warn or error.
	Level string
}

// New builds the root logger and returns a cleanup function that flushes
// buffered entries. The cleanup must run before the process exits.
func New(opts Options) (*zap.Logger, func(), error) {
	return newWithSink(opts, zapcore.Lock(os.Stdout))
}

func newWithSink(opts Options, sink zapcore.WriteSyncer) (*zap.Logger, func(), error) {
	level, err := zapcore.ParseLevel(opts.Level)
	if err != nil {
		return nil, nil, fmt.Errorf("parse log level: %w", err)
	}

	var encoder zapcore.Encoder
	cleanup := func() {}

	if opts.Production {
		encCfg := zap.NewProductionEncoderConfig()
		encCfg.TimeKey = "timestamp"
		encCfg.EncodeTime = zapcore.ISO8601TimeEncoder
		encoder = zapcore.NewJSONEncoder(encCfg)

		buffered := &zapcore.BufferedWriteSyncer{
			WS:            sink,
			Size:          256 * 1024,
			FlushInterval: time.Second,
		}
		sink = buffered
		cleanup = func() { _ = buffered.Stop() }
	} else {
		encCfg := zap.NewDevelopmentEncoderConfig()
		encCfg.EncodeLevel = zapcore.CapitalColorLevelEncoder
		encoder = zapcore.NewConsoleEncoder(encCfg)
	}

	core := zapcore.NewCore(encoder, sink, level)
	log := zap.New(core, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))

	return log, func() {
		_ = log.Sync()
		cleanup()
	}, nil
}

type contextKey struct{}

// WithContext returns a copy of ctx carrying the given logger.
func WithContext(ctx context.Context, log *zap.Logger) context.Context {
	return context.WithValue(ctx, contextKey{}, log)
}

// FromContext returns the request-scoped logger stored in ctx, or fallback
// when there is none.
func FromContext(ctx context.Context, fallback *zap.Logger) *zap.Logger {
	if log, ok := ctx.Value(contextKey{}).(*zap.Logger); ok {
		return log
	}
	return fallback
}
