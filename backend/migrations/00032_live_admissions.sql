-- SPEC-054: the waiting room of the live classroom. A student who connects waits until the teacher admits him; the decision is per
-- room and survives a reconnection. Soft deleted; nothing cascades.

-- +goose Up
CREATE TABLE live_classroom_admissions (
    id           uuid PRIMARY KEY,
    session_id   uuid NOT NULL REFERENCES live_classroom_sessions (id),
    student_id   uuid NOT NULL REFERENCES users (id),
    status       text NOT NULL CHECK (status IN ('WAITING', 'ADMITTED', 'REMOVED')),
    requested_at timestamptz NOT NULL,
    decided_at   timestamptz,
    decided_by   uuid REFERENCES users (id),
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz
);
-- One row per student and room.
CREATE UNIQUE INDEX live_classroom_admissions_student_idx ON live_classroom_admissions (session_id, student_id) WHERE deleted_at IS NULL;
CREATE INDEX live_classroom_admissions_line_idx ON live_classroom_admissions (session_id, status, requested_at) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE live_classroom_admissions;
