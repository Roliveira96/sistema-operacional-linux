-- SPEC-012/SPEC-016: progress of each student on content block reading.

-- +goose Up
CREATE TABLE block_progress (
    id           uuid PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    block_id     uuid NOT NULL REFERENCES content_blocks (id) ON DELETE CASCADE,
    completed_at timestamptz NOT NULL,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    CONSTRAINT block_progress_user_block_unique UNIQUE (user_id, block_id)
);

CREATE INDEX block_progress_user_idx ON block_progress (user_id);
CREATE INDEX block_progress_block_idx ON block_progress (block_id);

-- +goose Down
DROP TABLE block_progress;
