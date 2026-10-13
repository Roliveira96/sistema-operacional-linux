-- SPEC-041: summary of the class, and the syllabus and the guidelines as HTML.
-- RN-07: plain text written before this migration becomes paragraphs; each block separated by a blank line
-- is a paragraph, a single line break is a <br>, and &, < and > are escaped. HTML (text that starts with "<")
-- and empty fields stay as they are.

-- +goose Up
ALTER TABLE classes ADD COLUMN summary text NOT NULL DEFAULT '';

UPDATE classes SET
    syllabus = CASE
        WHEN syllabus IS NULL OR btrim(syllabus) = '' OR ltrim(syllabus) LIKE '<%' THEN syllabus
        ELSE (
            SELECT string_agg('<p>' || replace(btrim(block, E' \t\n'), E'\n', '<br>') || '</p>', '' ORDER BY ord)
            FROM regexp_split_to_table(
                replace(replace(replace(replace(btrim(syllabus), E'\r\n', E'\n'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                E'\n[ \t]*\n+'
            ) WITH ORDINALITY AS blocks(block, ord)
            WHERE btrim(block, E' \t\n') <> ''
        )
    END,
    institutional_guidelines = CASE
        WHEN institutional_guidelines IS NULL OR btrim(institutional_guidelines) = '' OR ltrim(institutional_guidelines) LIKE '<%' THEN institutional_guidelines
        ELSE (
            SELECT string_agg('<p>' || replace(btrim(block, E' \t\n'), E'\n', '<br>') || '</p>', '' ORDER BY ord)
            FROM regexp_split_to_table(
                replace(replace(replace(replace(btrim(institutional_guidelines), E'\r\n', E'\n'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                E'\n[ \t]*\n+'
            ) WITH ORDINALITY AS blocks(block, ord)
            WHERE btrim(block, E' \t\n') <> ''
        )
    END;

-- +goose Down
ALTER TABLE classes DROP COLUMN summary;
