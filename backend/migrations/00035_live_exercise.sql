-- SPEC-065: the exercise of the live classroom. A round is one exercise of a block of the module that the teacher gives to the whole room, with
-- a time; a room has at most one round running and keeps the ended ones. A result is the conclusion of one student in one round, with the time
-- and the points, kept for the gamification. The progress and who the teacher watches live in memory only. Soft deleted; nothing cascades.

-- +goose Up
CREATE TABLE live_exercise_runs (
    id               uuid PRIMARY KEY,
    session_id       uuid NOT NULL REFERENCES live_classroom_sessions (id),
    -- the block of the module (the blocks of a published version are not rows, so there is no reference) and the exercise of its group
    block_id         uuid NOT NULL,
    exercise_index   integer NOT NULL CHECK (exercise_index >= 0),
    -- the title and the level are kept as the round started, whatever the module becomes
    title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    difficulty       text NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 60 AND 3600),
    started_at       timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    -- null while the round runs; the moment and the reason come together
    ended_at         timestamptz,
    ended_by         text CHECK (ended_by IN ('TIMER', 'TEACHER', 'SESSION')),
    -- the teacher shows the result to the students only after the round ended
    result_visible   boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    deleted_at       timestamptz,
    CONSTRAINT live_exercise_runs_end_chk CHECK ((ended_at IS NULL) = (ended_by IS NULL)),
    CONSTRAINT live_exercise_runs_result_chk CHECK (NOT result_visible OR ended_at IS NOT NULL)
);
-- One round running per room (SPEC-065 section 3.1): a second start finds the first one.
CREATE UNIQUE INDEX live_exercise_runs_running_idx ON live_exercise_runs (session_id) WHERE ended_at IS NULL AND deleted_at IS NULL;
CREATE INDEX live_exercise_runs_session_idx ON live_exercise_runs (session_id, started_at) WHERE deleted_at IS NULL;

CREATE TABLE live_exercise_results (
    id              uuid PRIMARY KEY,
    run_id          uuid NOT NULL REFERENCES live_exercise_runs (id),
    student_id      uuid NOT NULL REFERENCES users (id),
    completed_at    timestamptz NOT NULL,
    elapsed_seconds integer NOT NULL CHECK (elapsed_seconds >= 0),
    points          integer NOT NULL CHECK (points >= 0),
    attempts        integer NOT NULL CHECK (attempts >= 1),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    deleted_at      timestamptz
);
-- One result per student and round.
CREATE UNIQUE INDEX live_exercise_results_student_idx ON live_exercise_results (run_id, student_id) WHERE deleted_at IS NULL;
-- The sum of the points of a student (the gamification).
CREATE INDEX live_exercise_results_by_student_idx ON live_exercise_results (student_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE live_exercise_results;
DROP TABLE live_exercise_runs;
