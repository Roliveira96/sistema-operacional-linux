-- SPEC-014: progress of each student on each practical exercise.

-- +goose Up
CREATE TABLE exercise_progress (
    id           uuid PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users (id),
    question_id  uuid NOT NULL REFERENCES questions (id),
    attempts     integer NOT NULL CHECK (attempts >= 1),
    last_passed  boolean NOT NULL,
    completed_at timestamptz,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    CONSTRAINT exercise_progress_unique UNIQUE (user_id, question_id)
);

-- +goose Down
DROP TABLE exercise_progress;
