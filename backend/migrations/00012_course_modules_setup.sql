-- SPEC-021: the snapshot of a module, a script of commands shared by its cards.
-- NULL means the module has none.

-- +goose Up
ALTER TABLE course_modules ADD COLUMN setup jsonb;

-- +goose Down
ALTER TABLE course_modules DROP COLUMN setup;
