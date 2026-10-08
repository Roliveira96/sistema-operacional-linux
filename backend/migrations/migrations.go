// Package migrations embeds the versioned SQL migrations applied by goose at
// startup. File names follow goose's sequential pattern: 00001_name.sql.
package migrations

import "embed"

// FS holds every migration file of this directory.
//
//go:embed *.sql
var FS embed.FS
