-- SPEC-050: who deleted a class. A class is deleted by the soft delete it already has (deleted_at), only after it was archived
-- for 30 days or more.

-- +goose Up
ALTER TABLE classes ADD COLUMN deleted_by uuid REFERENCES users (id);

-- +goose Down
ALTER TABLE classes DROP COLUMN deleted_by;
