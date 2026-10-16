-- SPEC-071: atomic student note blocks in Markdown and private note images served via authenticated proxy.

-- +goose Up
CREATE TABLE live_classroom_note_blocks (
    id               uuid PRIMARY KEY,
    session_id       uuid NOT NULL REFERENCES live_classroom_sessions (id),
    student_id       uuid NOT NULL REFERENCES users (id),
    content_markdown text NOT NULL CHECK (char_length(content_markdown) BETWEEN 1 AND 20000),
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    deleted_at       timestamptz
);

CREATE INDEX live_classroom_note_blocks_session_student_idx
    ON live_classroom_note_blocks (session_id, student_id, created_at)
    WHERE deleted_at IS NULL;

CREATE TABLE live_classroom_note_images (
    id            uuid PRIMARY KEY,
    session_id    uuid NOT NULL REFERENCES live_classroom_sessions (id),
    note_block_id uuid REFERENCES live_classroom_note_blocks (id),
    student_id    uuid NOT NULL REFERENCES users (id),
    object_key    text NOT NULL,
    original_name text NOT NULL CHECK (char_length(original_name) <= 255),
    mime_type     text NOT NULL CHECK (mime_type IN ('image/avif', 'image/webp')),
    width         integer NOT NULL DEFAULT 0 CHECK (width BETWEEN 0 AND 1220),
    height        integer NOT NULL DEFAULT 0 CHECK (height >= 0),
    size_bytes    bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL,
    deleted_at    timestamptz
);

CREATE INDEX live_classroom_note_images_auth_idx
    ON live_classroom_note_images (id, student_id)
    WHERE deleted_at IS NULL;

CREATE INDEX live_classroom_note_images_block_idx
    ON live_classroom_note_images (note_block_id)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE live_classroom_note_images;
DROP TABLE live_classroom_note_blocks;
