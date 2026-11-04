-- SPEC-090 (roteiro de 04/11/2026): the copies of the questions saved in the attempts had the keys of the alternatives and of the columns in upper
-- case ("ID", "HTML", "Left", "Right", "Text"), and the window of the exam reads them in lower case. jsonb prints a key as "Key": with a space; a
-- quote inside a string is printed escaped (\"), so the replacement only touches keys.

-- +goose Up
UPDATE assessment_attempt_items
SET student_view = replace(replace(replace(replace(replace(student_view::text,
        '"ID": ', '"id": '), '"HTML": ', '"html": '), '"Text": ', '"text": '), '"Left": ', '"left": '), '"Right": ', '"right": ')::jsonb
WHERE student_view::text LIKE '%"ID": %';

-- +goose Down
-- Nothing to undo: the lower case keys are the right ones.
SELECT 1;
