-- SPEC-002: student_profiles.
-- Student profiles store additional contact information and avatar object keys for student users.

-- +goose Up
CREATE TABLE student_profiles (
    id                uuid PRIMARY KEY,
    user_id           uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    whatsapp          text,
    discord           text,
    avatar_object_key text,
    created_at        timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL,
    deleted_at        timestamptz
);

CREATE INDEX student_profiles_user_id_idx ON student_profiles (user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX student_profiles_deleted_at_idx ON student_profiles (deleted_at);

-- +goose Down
DROP TABLE student_profiles;
