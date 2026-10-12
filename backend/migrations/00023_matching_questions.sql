-- SPEC-037: matching questions (THEORETICAL_MATCHING). The columns are kept in `choices` ({left, right}, each in the order of the
-- teacher) and the correct pairs in `answer_key` ({pairs}). A draft may miss the pairs; a published one needs the columns and the pairs.

-- +goose Up
ALTER TABLE questions DROP CONSTRAINT questions_kind_check;
ALTER TABLE questions ADD CONSTRAINT questions_kind_check CHECK (kind IN ('PRACTICAL', 'THEORETICAL_SINGLE', 'THEORETICAL_MULTIPLE',
    'THEORETICAL_BOOLEAN', 'THEORETICAL_MATCHING', 'DISCURSIVE'));

ALTER TABLE questions DROP CONSTRAINT questions_objective_fields;
ALTER TABLE questions ADD CONSTRAINT questions_objective_fields CHECK (
    (kind <> 'THEORETICAL_MULTIPLE' OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind NOT IN ('THEORETICAL_SINGLE', 'THEORETICAL_MATCHING') OR status <> 'PUBLISHED' OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind <> 'THEORETICAL_BOOLEAN' OR status <> 'PUBLISHED' OR answer_key IS NOT NULL));

-- +goose Down
-- The old enum has no matching kind: those questions are removed logically, never lost from the table.
UPDATE questions SET deleted_at = COALESCE(deleted_at, NOW()), kind = 'DISCURSIVE', status = 'ARCHIVED' WHERE kind = 'THEORETICAL_MATCHING';
ALTER TABLE questions DROP CONSTRAINT questions_objective_fields;
ALTER TABLE questions ADD CONSTRAINT questions_objective_fields CHECK (
    (kind <> 'THEORETICAL_MULTIPLE' OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind <> 'THEORETICAL_SINGLE' OR status <> 'PUBLISHED' OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind <> 'THEORETICAL_BOOLEAN' OR status <> 'PUBLISHED' OR answer_key IS NOT NULL));
ALTER TABLE questions DROP CONSTRAINT questions_kind_check;
ALTER TABLE questions ADD CONSTRAINT questions_kind_check CHECK (kind IN ('PRACTICAL', 'THEORETICAL_SINGLE', 'THEORETICAL_MULTIPLE',
    'THEORETICAL_BOOLEAN', 'DISCURSIVE'));
