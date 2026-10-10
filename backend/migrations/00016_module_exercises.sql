-- SPEC-023: exercises of the module and the bank of exercises. A module exercise is a practical question that carries
-- its tips, the conditions that say how it ends and who created and changed it; its machine is made of the layers of
-- the module, so it needs no scenario of its own. The module gets two snapshots, one for each set of exercises.

-- +goose Up
ALTER TABLE questions
    ADD COLUMN hints          jsonb,
    ADD COLUMN end_conditions jsonb,
    ADD COLUMN created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN updated_by     uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE questions DROP CONSTRAINT questions_practical_fields;
ALTER TABLE questions ADD CONSTRAINT questions_practical_fields
    CHECK (kind <> 'PRACTICAL' OR validation_conditions IS NOT NULL);

ALTER TABLE course_modules
    ADD COLUMN exercises_setup  jsonb,
    ADD COLUMN assessment_setup jsonb;

-- +goose Down
ALTER TABLE course_modules DROP COLUMN assessment_setup, DROP COLUMN exercises_setup;

-- Practical questions without a scenario only exist from this migration on: they go away with it.
DELETE FROM exercise_progress WHERE question_id IN (SELECT id FROM questions WHERE kind = 'PRACTICAL' AND scenario_id IS NULL);
DELETE FROM module_exercise_items WHERE exercise_id IN (SELECT id FROM questions WHERE kind = 'PRACTICAL' AND scenario_id IS NULL);
DELETE FROM questions WHERE kind = 'PRACTICAL' AND scenario_id IS NULL;

ALTER TABLE questions DROP CONSTRAINT questions_practical_fields;
ALTER TABLE questions ADD CONSTRAINT questions_practical_fields
    CHECK (kind <> 'PRACTICAL' OR (scenario_id IS NOT NULL AND validation_conditions IS NOT NULL));

ALTER TABLE questions DROP COLUMN updated_by, DROP COLUMN created_by, DROP COLUMN end_conditions, DROP COLUMN hints;
