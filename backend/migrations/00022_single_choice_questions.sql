-- SPEC-036: single choice questions in the bank of the module. Each alternative has a stable id and its html, and the answer key
-- points to the id of the correct one instead of its position (D-01). The questions of the initial load are converted (D-04): the id
-- of the alternative at index i is the first 8 hex digits of md5('<question id>:<i>'), the same as domain.LegacyChoiceID. A draft may
-- miss the answer key; a published one needs the alternatives and the answer key.

-- +goose Up
-- D-07: the teacher chooses whether the alternatives are shuffled for the student (the default) or keep her order.
ALTER TABLE questions ADD COLUMN shuffle_choices boolean NOT NULL DEFAULT true;

ALTER TABLE questions DROP CONSTRAINT questions_objective_fields;
ALTER TABLE questions ADD CONSTRAINT questions_objective_fields CHECK (
    (kind <> 'THEORETICAL_MULTIPLE' OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind <> 'THEORETICAL_SINGLE' OR status <> 'PUBLISHED' OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind <> 'THEORETICAL_BOOLEAN' OR status <> 'PUBLISHED' OR answer_key IS NOT NULL));

UPDATE questions q SET
    answer_key = CASE
        WHEN jsonb_typeof(q.answer_key -> 'correct') = 'number'
            THEN jsonb_build_object('correct', substr(md5(q.id::text || ':' || (q.answer_key ->> 'correct')), 1, 8))
        ELSE q.answer_key END,
    choices = (SELECT jsonb_agg(jsonb_build_object('id', substr(md5(q.id::text || ':' || (t.ord - 1)), 1, 8), 'html', t.txt) ORDER BY t.ord)
               FROM jsonb_array_elements_text(q.choices) WITH ORDINALITY AS t(txt, ord))
WHERE q.kind = 'THEORETICAL_SINGLE' AND jsonb_typeof(q.choices) = 'array' AND jsonb_typeof(q.choices -> 0) = 'string';

-- +goose Down
ALTER TABLE questions DROP COLUMN shuffle_choices;
UPDATE questions q SET
    answer_key = COALESCE((SELECT jsonb_build_object('correct', t.ord - 1)
                           FROM jsonb_array_elements(q.choices) WITH ORDINALITY AS t(item, ord)
                           WHERE t.item ->> 'id' = q.answer_key ->> 'correct'), q.answer_key),
    choices = (SELECT jsonb_agg(t.item ->> 'html' ORDER BY t.ord) FROM jsonb_array_elements(q.choices) WITH ORDINALITY AS t(item, ord))
WHERE q.kind = 'THEORETICAL_SINGLE' AND jsonb_typeof(q.choices -> 0) = 'object';
UPDATE questions SET choices = COALESCE(choices, '[]'::jsonb), answer_key = COALESCE(answer_key, '{}'::jsonb)
WHERE kind = 'THEORETICAL_SINGLE';
ALTER TABLE questions DROP CONSTRAINT questions_objective_fields;
ALTER TABLE questions ADD CONSTRAINT questions_objective_fields CHECK (
    (kind NOT IN ('THEORETICAL_SINGLE', 'THEORETICAL_MULTIPLE') OR (choices IS NOT NULL AND answer_key IS NOT NULL))
    AND (kind <> 'THEORETICAL_BOOLEAN' OR status <> 'PUBLISHED' OR answer_key IS NOT NULL));
