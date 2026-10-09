-- SPEC-010: a module slug is unique among the modules that were not deleted.

-- +goose Up
DROP INDEX IF EXISTS course_modules_slug_idx;
CREATE UNIQUE INDEX course_modules_slug_unique ON course_modules (slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS course_modules_slug_unique;
CREATE INDEX course_modules_slug_idx ON course_modules (slug) WHERE deleted_at IS NULL;
