-- SPEC-074: the materials of a lesson of the schedule: files (PDF or image, in the bucket) and links, each with a kind and a phase of
-- visibility (always, only during the lesson, only after it, during and after it). The server decides who sees what at each moment; the
-- exclusion is logical and the object stays in the bucket.

-- +goose Up
CREATE TABLE class_session_materials (
    id           uuid PRIMARY KEY,
    session_id   uuid NOT NULL REFERENCES class_sessions (id),
    position     smallint NOT NULL CHECK (position BETWEEN 0 AND 49),
    title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    kind         text NOT NULL CHECK (kind IN ('SLIDES', 'EXERCISES', 'EXERCISE_SOLUTION', 'REFERENCE')),
    visibility   text NOT NULL CHECK (visibility IN ('ALWAYS', 'DURING_CLASS', 'AFTER_CLASS', 'DURING_AND_AFTER')),
    -- from this moment on the material is visible in any phase; "release now" writes the clock of the server here
    release_at   timestamptz,
    url          text CHECK (char_length(url) <= 2000),
    object_key   text,
    content_type text,
    size_bytes   bigint CHECK (size_bytes >= 0),
    file_name    text CHECK (char_length(file_name) <= 255),
    page_count   smallint CHECK (page_count BETWEEN 1 AND 100),
    created_by   uuid NOT NULL REFERENCES users (id),
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz,
    -- exactly one source: a link or a file
    CONSTRAINT class_session_materials_one_source CHECK ((url IS NULL) <> (object_key IS NULL))
);
CREATE INDEX class_session_materials_session_idx ON class_session_materials (session_id, position) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE class_session_materials;
