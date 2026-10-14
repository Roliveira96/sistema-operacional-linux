-- SPEC-051: the live classroom. A room (one open per class), the slide decks the teacher uploads, the queue of raised hands and the
-- private notes of each student. Everything is soft deleted; nothing cascades.

-- +goose Up
CREATE TABLE slide_decks (
    id          uuid PRIMARY KEY,
    class_id    uuid NOT NULL REFERENCES classes (id),
    uploaded_by uuid NOT NULL REFERENCES users (id),
    title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    object_key  text NOT NULL,
    page_count  smallint NOT NULL CHECK (page_count BETWEEN 1 AND 100),
    created_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    deleted_at  timestamptz
);
CREATE INDEX slide_decks_class_idx ON slide_decks (class_id) WHERE deleted_at IS NULL;

CREATE TABLE live_classroom_sessions (
    id               uuid PRIMARY KEY,
    class_id         uuid NOT NULL REFERENCES classes (id),
    teacher_id       uuid NOT NULL REFERENCES users (id),
    class_session_id uuid REFERENCES class_sessions (id),
    deck_id          uuid REFERENCES slide_decks (id),
    active_module_id uuid REFERENCES course_modules (id),
    title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    display_mode     text NOT NULL CHECK (display_mode IN ('SLIDES', 'MODULE')),
    current_slide    integer NOT NULL DEFAULT 1 CHECK (current_slide >= 1),
    status           text NOT NULL CHECK (status IN ('ACTIVE', 'FINISHED')),
    started_at       timestamptz NOT NULL,
    ended_at         timestamptz,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    deleted_at       timestamptz
);
-- One open room per class (SPEC-051 RN-01): a second start finds the first one.
CREATE UNIQUE INDEX live_classroom_sessions_one_active_idx ON live_classroom_sessions (class_id)
    WHERE status = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX live_classroom_sessions_class_idx ON live_classroom_sessions (class_id, started_at) WHERE deleted_at IS NULL;

CREATE TABLE live_hand_raises (
    id           uuid PRIMARY KEY,
    session_id   uuid NOT NULL REFERENCES live_classroom_sessions (id),
    student_id   uuid NOT NULL REFERENCES users (id),
    status       text NOT NULL CHECK (status IN ('PENDING', 'ANSWERED', 'LOWERED')),
    requested_at timestamptz NOT NULL,
    resolved_at  timestamptz,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz
);
CREATE INDEX live_hand_raises_queue_idx ON live_hand_raises (session_id, status, requested_at) WHERE deleted_at IS NULL;

CREATE TABLE live_classroom_notes (
    id         uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live_classroom_sessions (id),
    student_id uuid NOT NULL REFERENCES users (id),
    content    text NOT NULL CHECK (char_length(content) <= 20000),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
-- One notebook per student and room.
CREATE UNIQUE INDEX live_classroom_notes_student_idx ON live_classroom_notes (session_id, student_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE live_classroom_notes;
DROP TABLE live_hand_raises;
DROP TABLE live_classroom_sessions;
DROP TABLE slide_decks;
