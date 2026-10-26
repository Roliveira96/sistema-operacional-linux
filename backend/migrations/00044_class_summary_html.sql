-- SPEC-078: the summary of a class is formatted text, stored as html that the server filters (RN-01). The summaries already stored are plain text and
-- were never filtered, so they are escaped and made one paragraph for each line (RN-02): shown as html, a script in the old text stays text, as the
-- syllabus did in SPEC-041 RN-07. Going down changes nothing: the text stays escaped and readable. The column has no length constraint to change.

-- +goose Up
UPDATE classes SET summary = COALESCE((
    SELECT string_agg('<p>' || replace(replace(replace(btrim(line, E' \t\r'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>', '' ORDER BY ord)
    FROM unnest(regexp_split_to_array(summary, '\r?\n')) WITH ORDINALITY AS lines(line, ord)
    WHERE btrim(line, E' \t\r') <> ''
), '')
WHERE summary <> '';

-- +goose Down
SELECT 1;
