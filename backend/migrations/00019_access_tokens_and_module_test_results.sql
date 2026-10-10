-- SPEC-024: personal access tokens for the MCP server (only the hash is stored) and the results of the module tests that
-- publishing requires (RN-13).

-- +goose Up
CREATE TABLE access_tokens (
    id           uuid PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users (id),
    name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    token_hash   text NOT NULL UNIQUE,
    expires_at   timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz
);
CREATE INDEX access_tokens_user_idx ON access_tokens (user_id);

CREATE TABLE module_test_results (
    id           uuid PRIMARY KEY,
    module_id    uuid NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('MODULE', 'EXERCISE_BANK')),
    content_hash text NOT NULL,
    passed       boolean NOT NULL,
    summary      jsonb,
    tested_by    uuid NOT NULL REFERENCES users (id),
    created_at   timestamptz NOT NULL
);
CREATE INDEX module_test_results_latest_idx ON module_test_results (module_id, kind, created_at DESC);

-- +goose Down
DROP TABLE module_test_results;
DROP TABLE access_tokens;
