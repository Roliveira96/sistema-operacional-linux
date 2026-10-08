package database

import (
	"context"

	"gorm.io/gorm"
)

type txKey struct{}

// Conn returns the handle repositories must use: the transaction carried by
// ctx when there is one, otherwise the shared connection bound to ctx.
func (d *DB) Conn(ctx context.Context) *gorm.DB {
	if tx, ok := ctx.Value(txKey{}).(*gorm.DB); ok {
		return tx
	}
	return d.gorm.WithContext(ctx)
}

// WithinTransaction runs fn inside a single database transaction propagated
// through the context passed to fn. The transaction is rolled back if fn
// returns an error or panics, and committed otherwise. Nested calls reuse the
// outer transaction.
func (d *DB) WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	if _, ok := ctx.Value(txKey{}).(*gorm.DB); ok {
		return fn(ctx)
	}
	return d.gorm.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(context.WithValue(ctx, txKey{}, tx))
	})
}
