-- SPEC-010: Add slug column to course_modules table.

-- +goose Up
ALTER TABLE course_modules ADD COLUMN slug text;
CREATE INDEX course_modules_slug_idx ON course_modules (slug) WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS course_modules_slug_idx;
ALTER TABLE course_modules DROP COLUMN IF EXISTS slug;
