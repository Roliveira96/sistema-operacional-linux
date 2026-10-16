-- SPEC-073: the diary of the lesson. The notes of the teacher on a lesson of the schedule (public, which the class reads, and private, which
-- only the teacher and an administrator read), and the commands the teacher ran in the presentation window of a live classroom, kept in the
-- order they ran, with the moment of the server. The commands have forensic value: nothing is deleted physically.

-- +goose Up
ALTER TABLE class_sessions ADD COLUMN teacher_notes text;
ALTER TABLE class_sessions ADD COLUMN teacher_private_notes text;

CREATE TABLE live_terminal_commands (
    id               uuid PRIMARY KEY,
    session_id       uuid NOT NULL REFERENCES live_classroom_sessions (id),
    terminal         smallint NOT NULL CHECK (terminal BETWEEN 1 AND 3),
    command          text NOT NULL CHECK (char_length(command) BETWEEN 1 AND 2000),
    -- the exit status of the command; null when it was interrupted and had none
    exit_status      smallint,
    output           text NOT NULL DEFAULT '' CHECK (char_length(output) <= 4000),
    output_truncated boolean NOT NULL DEFAULT false,
    ran_at           timestamptz NOT NULL,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    deleted_at       timestamptz
);
CREATE INDEX live_terminal_commands_session_idx ON live_terminal_commands (session_id, ran_at) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE live_terminal_commands;
ALTER TABLE class_sessions DROP COLUMN teacher_private_notes;
ALTER TABLE class_sessions DROP COLUMN teacher_notes;
