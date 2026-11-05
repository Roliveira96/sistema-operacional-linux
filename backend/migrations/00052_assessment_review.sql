-- SPEC-097: the correction of the exam by the teacher. Each question may have its points adjusted, with the reason; the attempt keeps the private
-- note, the note to the student, the final score and who reviewed it, and when.

-- +goose Up
ALTER TABLE assessment_attempt_items
    ADD COLUMN adjusted_points numeric(5, 2),
    ADD COLUMN adjust_reason   text CHECK (char_length(adjust_reason) <= 300),
    ADD COLUMN adjusted_at     timestamptz,
    ADD COLUMN adjusted_by     uuid REFERENCES users (id);

ALTER TABLE assessment_attempts
    ADD COLUMN teacher_note text CHECK (char_length(teacher_note) <= 2000),
    ADD COLUMN student_note text CHECK (char_length(student_note) <= 2000),
    ADD COLUMN final_score  numeric(5, 2),
    ADD COLUMN reviewed_at  timestamptz,
    ADD COLUMN reviewed_by  uuid REFERENCES users (id);

-- +goose Down
ALTER TABLE assessment_attempts
    DROP COLUMN reviewed_by,
    DROP COLUMN reviewed_at,
    DROP COLUMN final_score,
    DROP COLUMN student_note,
    DROP COLUMN teacher_note;

ALTER TABLE assessment_attempt_items
    DROP COLUMN adjusted_by,
    DROP COLUMN adjusted_at,
    DROP COLUMN adjust_reason,
    DROP COLUMN adjusted_points;
