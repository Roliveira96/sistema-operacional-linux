-- SPEC-019: a content block can be inactivated without losing its content.
-- NULL means active; a block that is inactive is hidden from students.

-- +goose Up
ALTER TABLE content_blocks ADD COLUMN inactive_at timestamptz;

-- +goose Down
ALTER TABLE content_blocks DROP COLUMN inactive_at;
