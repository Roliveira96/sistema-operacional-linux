-- SPEC-023 revisions 2 and 3: the bank of exercises is the only source of the exercises of a module, and the practice and the
-- assessment are links to it. A question is in the practice when its usage is EXERCISE (and then it has a place in the trail),
-- and in the assessment when `in_assessment` is set; `exclusive_assessment` keeps it out of the practice. An exercise can
-- depend on another one (`depends_on`), whose recipe is built before its machine. The module has one snapshot for the whole bank.

-- +goose Up
ALTER TABLE questions
    ADD COLUMN in_assessment        boolean NOT NULL DEFAULT false,
    ADD COLUMN exclusive_assessment boolean NOT NULL DEFAULT false,
    ADD COLUMN depends_on           uuid REFERENCES questions (id) ON DELETE SET NULL;

-- What was reserved for the assessment is linked to it.
UPDATE questions SET in_assessment = true WHERE usage = 'ASSESSMENT';

-- The exercises that continued from the previous one of the trail now depend on it.
UPDATE questions q SET depends_on = prev.exercise_id
FROM module_exercise_items cur
JOIN module_exercise_items prev ON prev.module_id = cur.module_id AND prev.sequence_order = cur.sequence_order - 1
WHERE cur.exercise_id = q.id AND q.continues_previous;
ALTER TABLE questions DROP COLUMN continues_previous;

ALTER TABLE questions ADD CONSTRAINT questions_exclusive_needs_assessment
    CHECK (NOT exclusive_assessment OR (in_assessment AND usage = 'ASSESSMENT'));
ALTER TABLE questions ADD CONSTRAINT questions_not_self_dependent CHECK (depends_on IS DISTINCT FROM id);

-- One snapshot for the bank: the one of the practice wins, the one of the assessment is used when it is the only one.
ALTER TABLE course_modules ADD COLUMN bank_setup jsonb;
UPDATE course_modules SET bank_setup = COALESCE(exercises_setup, assessment_setup);
ALTER TABLE course_modules DROP COLUMN exercises_setup, DROP COLUMN assessment_setup;

-- +goose Down
ALTER TABLE course_modules ADD COLUMN exercises_setup jsonb, ADD COLUMN assessment_setup jsonb;
UPDATE course_modules SET exercises_setup = bank_setup;
ALTER TABLE course_modules DROP COLUMN bank_setup;

ALTER TABLE questions DROP CONSTRAINT questions_not_self_dependent;
ALTER TABLE questions DROP CONSTRAINT questions_exclusive_needs_assessment;
ALTER TABLE questions ADD COLUMN continues_previous boolean NOT NULL DEFAULT false;
UPDATE questions SET continues_previous = true WHERE depends_on IS NOT NULL;
ALTER TABLE questions DROP COLUMN depends_on, DROP COLUMN exclusive_assessment, DROP COLUMN in_assessment;
