-- SPEC-035: the bank of the module holds true or false questions (THEORETICAL_BOOLEAN) besides the practical ones. A true or
-- false question has no choices (the labels are the ones of the screen) and is written as a draft before the teacher picks the
-- correct answer, which it only needs to be published (RN-04). Only a practical question takes part in dependencies, and the
-- progress of the student keeps the single answer given to a true or false question, which never changes once given (RN-08).

-- +goose Up
ALTER TABLE questions DROP CONSTRAINT questions_objective_fields;
ALTER TABLE questions ADD CONSTRAINT questions_objective_fields CHECK (
    (kind NOT IN ('THEORETICAL_SINGLE', 'THEORETICAL_MULTIPLE') OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind <> 'THEORETICAL_BOOLEAN' OR status <> 'PUBLISHED' OR answer_key IS NOT NULL));

ALTER TABLE questions ADD CONSTRAINT questions_dependency_only_practical
    CHECK (depends_on IS NULL OR kind = 'PRACTICAL');

ALTER TABLE exercise_progress ADD COLUMN response jsonb;

-- +goose Down
ALTER TABLE exercise_progress DROP COLUMN response;
ALTER TABLE questions DROP CONSTRAINT questions_dependency_only_practical;
-- The old rule wants choices and an answer key on every true or false question: fill the missing ones instead of losing questions.
UPDATE questions SET choices = COALESCE(choices, '[]'::jsonb), answer_key = COALESCE(answer_key, '{}'::jsonb) WHERE kind = 'THEORETICAL_BOOLEAN';
ALTER TABLE questions DROP CONSTRAINT questions_objective_fields;
ALTER TABLE questions ADD CONSTRAINT questions_objective_fields CHECK (kind NOT IN ('THEORETICAL_SINGLE', 'THEORETICAL_MULTIPLE', 'THEORETICAL_BOOLEAN')
    OR (choices IS NOT NULL AND answer_key IS NOT NULL));
