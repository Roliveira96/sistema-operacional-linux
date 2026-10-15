-- SPEC-063: the chat of the lesson. The messages of a room: a student writes to the teacher, in his own conversation; the teacher writes to
-- one student (a private conversation) or to everybody (no student). Text of 1 to 500 characters (char_length counts characters, not
-- bytes). Soft deleted; nothing cascades, and a room that ends keeps its messages.

-- +goose Up
CREATE TABLE live_chat_messages (
    id          uuid PRIMARY KEY,
    session_id  uuid NOT NULL REFERENCES live_classroom_sessions (id),
    sender_id   uuid NOT NULL REFERENCES users (id),
    sender_role text NOT NULL CHECK (sender_role IN ('TEACHER', 'STUDENT')),
    -- the owner of the conversation: the student, whoever wrote; null is a message of the teacher to everybody
    student_id  uuid REFERENCES users (id),
    body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    created_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    deleted_at  timestamptz,
    -- a student writes only in his own conversation (a null student_id would pass a plain comparison, so it is tested apart)
    CONSTRAINT live_chat_messages_student_own_chk CHECK (sender_role = 'TEACHER' OR (student_id IS NOT NULL AND student_id = sender_id))
);
CREATE INDEX live_chat_messages_session_idx ON live_chat_messages (session_id, created_at) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE live_chat_messages;
