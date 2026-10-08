-- SPEC-003: users, login sessions, password reset tokens and the append-only
-- security audit log. Enumerations are stored as text with CHECK constraints.

-- +goose Up
CREATE TABLE users (
    id                   uuid PRIMARY KEY,
    name                 text,
    email                text NOT NULL,
    academic_id          text CHECK (academic_id ~ '^[0-9]{7}$'),
    password_hash        text,
    role                 text NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'STUDENT')),
    status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    must_change_password boolean NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL,
    deleted_at           timestamptz,
    CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_academic_id_unique ON users (academic_id) WHERE deleted_at IS NULL AND academic_id IS NOT NULL;
CREATE INDEX users_deleted_at_idx ON users (deleted_at);

CREATE TABLE auth_sessions (
    id               uuid PRIMARY KEY,
    user_id          uuid NOT NULL REFERENCES users (id),
    token_hash       text NOT NULL UNIQUE,
    ip_address       text NOT NULL,
    user_agent       text NOT NULL,
    status           text NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED_IDLE', 'EXPIRED_ABSOLUTE',
                         'REVOKED_LOGOUT', 'REVOKED_CONCURRENCY', 'REVOKED_PASSWORD_RESET')),
    last_activity_at timestamptz NOT NULL,
    expires_at       timestamptz NOT NULL,
    created_at       timestamptz NOT NULL,
    revoked_at       timestamptz,
    CONSTRAINT auth_sessions_revoked_consistency CHECK ((status = 'ACTIVE') = (revoked_at IS NULL))
);
CREATE INDEX auth_sessions_user_status_idx ON auth_sessions (user_id, status);

CREATE TABLE password_reset_tokens (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id),
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL
);

CREATE TABLE security_audit_logs (
    id                   uuid PRIMARY KEY,
    user_id              uuid REFERENCES users (id),
    event_type           text NOT NULL CHECK (event_type IN ('LOGIN_SUCCEEDED', 'LOGIN_FAILED_WRONG_PASSWORD',
                             'LOGIN_FAILED_UNKNOWN_USER', 'LOGIN_FAILED_ACCOUNT_NOT_ACTIVE', 'LOGIN_BLOCKED_RATE_LIMIT',
                             'LOGOUT', 'SESSION_EXPIRED_IDLE', 'SESSION_EXPIRED_ABSOLUTE', 'SESSION_REVOKED_CONCURRENCY',
                             'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGED', 'ADMIN_SEEDED')),
    attempted_identifier text,
    ip_address           text NOT NULL,
    user_agent           text NOT NULL,
    metadata             jsonb,
    occurred_at          timestamptz NOT NULL
);
CREATE INDEX security_audit_logs_user_idx ON security_audit_logs (user_id, occurred_at);
CREATE INDEX security_audit_logs_event_idx ON security_audit_logs (event_type, occurred_at);

-- The audit log is append-only: updates and deletes are rejected.
-- +goose StatementBegin
CREATE FUNCTION security_audit_logs_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'security_audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER security_audit_logs_no_update_delete
    BEFORE UPDATE OR DELETE ON security_audit_logs
    FOR EACH ROW EXECUTE FUNCTION security_audit_logs_append_only();

-- +goose Down
DROP TABLE security_audit_logs;
DROP FUNCTION security_audit_logs_append_only();
DROP TABLE password_reset_tokens;
DROP TABLE auth_sessions;
DROP TABLE users;
