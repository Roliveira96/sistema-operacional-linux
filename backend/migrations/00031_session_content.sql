-- SPEC-053: the content of each lesson (a date of the calendar): topic, description, teaching module, presentation and links. A lesson with content is
-- never dropped when the weekly lessons are regenerated (has_content); the links that are replaced are soft deleted.

-- +goose Up
ALTER TABLE class_sessions ADD COLUMN topic text CHECK (char_length(topic) BETWEEN 1 AND 120);
ALTER TABLE class_sessions ADD COLUMN description text;
ALTER TABLE class_sessions ADD COLUMN module_id uuid REFERENCES course_modules (id);
ALTER TABLE class_sessions ADD COLUMN deck_id uuid REFERENCES slide_decks (id);
ALTER TABLE class_sessions ADD COLUMN has_content boolean NOT NULL DEFAULT false;

CREATE TABLE class_session_links (
    id         uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES class_sessions (id),
    position   smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
    name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    url        text NOT NULL CHECK (char_length(url) <= 2000),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
CREATE INDEX class_session_links_session_idx ON class_session_links (session_id, position) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE class_session_links;
ALTER TABLE class_sessions DROP COLUMN has_content;
ALTER TABLE class_sessions DROP COLUMN deck_id;
ALTER TABLE class_sessions DROP COLUMN module_id;
ALTER TABLE class_sessions DROP COLUMN description;
ALTER TABLE class_sessions DROP COLUMN topic;
