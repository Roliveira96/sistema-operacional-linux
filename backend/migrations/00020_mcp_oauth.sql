-- SPEC-024 RN-14: OAuth login of MCP clients. Clients register themselves; the authorization code is single use and
-- only its hash is stored.

-- +goose Up
CREATE TABLE oauth_clients (
    id            uuid PRIMARY KEY,
    client_name   text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 80),
    redirect_uris jsonb NOT NULL,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL,
    deleted_at    timestamptz
);

CREATE TABLE oauth_authorization_codes (
    id              uuid PRIMARY KEY,
    client_id       uuid NOT NULL REFERENCES oauth_clients (id),
    user_id         uuid NOT NULL REFERENCES users (id),
    code_hash       text NOT NULL UNIQUE,
    redirect_uri    text NOT NULL,
    code_challenge  text NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    access_token_id uuid REFERENCES access_tokens (id),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    deleted_at      timestamptz
);

-- +goose Down
DROP TABLE oauth_authorization_codes;
DROP TABLE oauth_clients;
