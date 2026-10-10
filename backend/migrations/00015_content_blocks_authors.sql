-- SPEC-019: who created and who last changed a block of content, to show it to the teachers.

-- +goose Up
ALTER TABLE content_blocks
    ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN updated_by uuid REFERENCES users (id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE content_blocks DROP COLUMN updated_by, DROP COLUMN created_by;
