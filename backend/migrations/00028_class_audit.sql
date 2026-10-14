-- SPEC-049: who created and who last updated a class, and when and by whom it was archived. The classes that exist are filled
-- with what can be told: the teacher is the author, and the archived ones were archived when they were last updated.

-- +goose Up
ALTER TABLE classes ADD COLUMN created_by uuid REFERENCES users (id);
ALTER TABLE classes ADD COLUMN updated_by uuid REFERENCES users (id);
ALTER TABLE classes ADD COLUMN archived_at timestamptz;
ALTER TABLE classes ADD COLUMN archived_by uuid REFERENCES users (id);

UPDATE classes SET created_by = teacher_id, updated_by = teacher_id;
UPDATE classes SET archived_at = updated_at, archived_by = teacher_id WHERE status = 'ARCHIVED';

ALTER TABLE classes ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE classes ALTER COLUMN updated_by SET NOT NULL;

-- +goose Down
ALTER TABLE classes DROP COLUMN archived_by;
ALTER TABLE classes DROP COLUMN archived_at;
ALTER TABLE classes DROP COLUMN updated_by;
ALTER TABLE classes DROP COLUMN created_by;
