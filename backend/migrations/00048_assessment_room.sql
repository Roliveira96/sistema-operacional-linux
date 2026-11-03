-- SPEC-091: the room of the exam. The teacher may end the attempt of a student, with the reason; the commands of the attempt are kept for the teacher
-- to follow live and later; and the students raise the hand, one open request each, which the teacher answers with an optional text (D-03).

-- +goose Up
ALTER TABLE assessment_attempts DROP CONSTRAINT assessment_attempts_status_check;
ALTER TABLE assessment_attempts
    ADD CONSTRAINT assessment_attempts_status_check CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'TIME_EXPIRED', 'ENDED_BY_TEACHER')),
    ADD COLUMN ended_by uuid REFERENCES users (id),
    ADD COLUMN end_reason text CHECK (char_length(end_reason) BETWEEN 1 AND 500),
    ADD CONSTRAINT assessment_attempts_ended CHECK ((status = 'ENDED_BY_TEACHER') = (ended_by IS NOT NULL) AND (ended_by IS NULL) = (end_reason IS NULL));

CREATE TABLE assessment_attempt_commands (
    id          uuid PRIMARY KEY,
    attempt_id  uuid NOT NULL REFERENCES assessment_attempts (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    command     text NOT NULL CHECK (char_length(command) <= 1000),
    output      text NOT NULL CHECK (char_length(output) <= 4000),
    executed_at timestamptz NOT NULL
);
CREATE INDEX assessment_attempt_commands_attempt_idx ON assessment_attempt_commands (attempt_id, executed_at);

CREATE TABLE assessment_help_requests (
    id         uuid PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES assessment_attempts (id) ON DELETE CASCADE,
    position   integer,
    question   text NOT NULL CHECK (char_length(question) <= 300),
    status     text NOT NULL CHECK (status IN ('OPEN', 'ANSWERED', 'CANCELED')),
    created_at timestamptz NOT NULL,
    closed_at  timestamptz,
    closed_by  uuid REFERENCES users (id),
    answer     text NOT NULL DEFAULT '' CHECK (char_length(answer) <= 300),
    CONSTRAINT assessment_help_requests_closed CHECK ((status = 'OPEN') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX assessment_help_requests_one_open ON assessment_help_requests (attempt_id) WHERE status = 'OPEN';

-- +goose Down
DROP TABLE assessment_help_requests;
DROP TABLE assessment_attempt_commands;
UPDATE assessment_attempts SET status = 'SUBMITTED', ended_by = NULL, end_reason = NULL WHERE status = 'ENDED_BY_TEACHER';
ALTER TABLE assessment_attempts
    DROP CONSTRAINT assessment_attempts_ended,
    DROP COLUMN end_reason,
    DROP COLUMN ended_by,
    DROP CONSTRAINT assessment_attempts_status_check;
ALTER TABLE assessment_attempts ADD CONSTRAINT assessment_attempts_status_check CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'TIME_EXPIRED'));
