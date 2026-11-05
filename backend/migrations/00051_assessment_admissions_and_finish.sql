-- SPEC-096: the teacher admits each student after the start, and finishes the whole exam. An admission is never undone (RN-01); the finish keeps
-- when and who (RN-04).

-- +goose Up
CREATE TABLE assessment_admissions (
    assessment_id uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    student_id    uuid NOT NULL REFERENCES users (id),
    admitted_at   timestamptz NOT NULL,
    admitted_by   uuid NOT NULL REFERENCES users (id),
    PRIMARY KEY (assessment_id, student_id)
);

ALTER TABLE assessments
    ADD COLUMN finished_at timestamptz,
    ADD COLUMN finished_by uuid REFERENCES users (id);

-- +goose Down
ALTER TABLE assessments
    DROP COLUMN finished_by,
    DROP COLUMN finished_at;
DROP TABLE assessment_admissions;
