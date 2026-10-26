-- SPEC-077: the instructions of an assessment are formatted text, stored as html that the server filters (RN-01), up to 20,000 characters. The ones
-- already stored are plain text and were never filtered, so they are escaped and made one paragraph for each line (RN-03): shown as html, a script in
-- the old text stays text, as the syllabus of a class did in SPEC-041 RN-07. Going down keeps the text as it is (escaped, readable) and gives the old limit
-- back only if no instruction is beyond it: the constraint refuses to hold otherwise, and nothing is cut.

-- +goose Up
ALTER TABLE assessments DROP CONSTRAINT assessments_description_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_description_check CHECK (char_length(description) <= 20000);

UPDATE assessments SET description = COALESCE((
    SELECT string_agg('<p>' || replace(replace(replace(btrim(line, E' \t\r'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>', '' ORDER BY ord)
    FROM unnest(regexp_split_to_array(description, '\r?\n')) WITH ORDINALITY AS lines(line, ord)
    WHERE btrim(line, E' \t\r') <> ''
), '')
WHERE description <> '';

-- +goose Down
ALTER TABLE assessments DROP CONSTRAINT assessments_description_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_description_check CHECK (char_length(description) <= 5000);
