-- SPEC-048: links of a class (name and https address) that the teacher publishes for the students. The list is replaced as a
-- whole; the links that leave are soft deleted.

-- +goose Up
CREATE TABLE class_links (
    id         uuid PRIMARY KEY,
    class_id   uuid NOT NULL REFERENCES classes (id),
    position   smallint NOT NULL CHECK (position BETWEEN 0 AND 19),
    name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    url        text NOT NULL CHECK (char_length(url) <= 2000),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
CREATE INDEX class_links_class_idx ON class_links (class_id, position) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE class_links;
