-- SPEC-090: the attempt of a student at an exam, one for each student, with its questions frozen at the entry: what the student sees, the key that
-- grades the answer, the last answer and, on the delivery, the points. An attempt is an academic record: no deletion.

-- +goose Up
CREATE TABLE assessment_attempts (
    id                uuid PRIMARY KEY,
    assessment_id     uuid NOT NULL REFERENCES assessments (id),
    student_id        uuid NOT NULL REFERENCES users (id),
    status            text NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'TIME_EXPIRED')),
    started_at        timestamptz NOT NULL,
    deadline_at       timestamptz NOT NULL,
    submitted_at      timestamptz,
    preliminary_score numeric(5,2),
    pending_items     integer CHECK (pending_items >= 0),
    created_at        timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL,
    CONSTRAINT assessment_attempts_student_once UNIQUE (assessment_id, student_id),
    CONSTRAINT assessment_attempts_deadline CHECK (deadline_at > started_at),
    CONSTRAINT assessment_attempts_closed CHECK (
        (status = 'IN_PROGRESS') = (submitted_at IS NULL)
        AND (status = 'IN_PROGRESS') = (preliminary_score IS NULL)
        AND (status = 'IN_PROGRESS') = (pending_items IS NULL))
);
CREATE INDEX assessment_attempts_due_idx ON assessment_attempts (status, deadline_at);

CREATE TABLE assessment_attempt_items (
    attempt_id     uuid NOT NULL REFERENCES assessment_attempts (id) ON DELETE CASCADE,
    position       integer NOT NULL CHECK (position >= 1),
    question_id    uuid NOT NULL,
    kind           text NOT NULL,
    weight         numeric(5,2) NOT NULL CHECK (weight > 0),
    student_view   jsonb NOT NULL,
    answer_key     jsonb NOT NULL,
    answer         jsonb,
    answered_at    timestamptz,
    checked_solved boolean,
    points         numeric(5,2) CHECK (points >= 0 AND points <= weight),
    PRIMARY KEY (attempt_id, position)
);

-- +goose Down
DROP TABLE assessment_attempt_items;
DROP TABLE assessment_attempts;
