-- SPEC-093: the conversation of the exam between the student and the teacher, kept with the attempt for the assessment. Only inserted: nothing edits
-- nor deletes a message (RN-04). A message to all has no attempt and keeps who received it (D-01).

-- +goose Up
CREATE TABLE assessment_chat_messages (
    id            uuid PRIMARY KEY,
    assessment_id uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    attempt_id    uuid REFERENCES assessment_attempts (id) ON DELETE CASCADE,
    sender_id     uuid NOT NULL REFERENCES users (id),
    sender_role   text NOT NULL CHECK (sender_role IN ('TEACHER', 'STUDENT')),
    position      integer,
    body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    created_at    timestamptz NOT NULL,
    CONSTRAINT assessment_chat_messages_student_attempt CHECK (sender_role = 'TEACHER' OR attempt_id IS NOT NULL)
);
CREATE INDEX assessment_chat_messages_attempt_idx ON assessment_chat_messages (attempt_id, created_at);
CREATE INDEX assessment_chat_messages_assessment_idx ON assessment_chat_messages (assessment_id, created_at);

CREATE TABLE assessment_chat_recipients (
    message_id uuid NOT NULL REFERENCES assessment_chat_messages (id) ON DELETE CASCADE,
    attempt_id uuid NOT NULL REFERENCES assessment_attempts (id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, attempt_id)
);
CREATE INDEX assessment_chat_recipients_attempt_idx ON assessment_chat_recipients (attempt_id);

-- +goose Down
DROP TABLE assessment_chat_recipients;
DROP TABLE assessment_chat_messages;
