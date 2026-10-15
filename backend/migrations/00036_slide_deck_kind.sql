-- SPEC-068: a presentation is a PDF or one image. The teacher sends both with the room open; the stage draws a PDF page by page and an image whole
-- (one slide). The rows that were there are PDFs.

-- +goose Up
ALTER TABLE slide_decks ADD COLUMN kind text NOT NULL DEFAULT 'PDF' CHECK (kind IN ('PDF', 'IMAGE'));

-- +goose Down
ALTER TABLE slide_decks DROP COLUMN kind;
