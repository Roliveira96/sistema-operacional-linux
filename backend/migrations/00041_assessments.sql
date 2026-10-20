-- SPEC-075: the assessments of a class on the calendar. The period and the audience live in the assessment itself (D-02); the questions of a
-- manual composition, the rules of a draw and the chosen students have their own tables. The history of the assessment is append-only: its
-- events are never changed nor removed (ARCHITECTURE.md, section 2).

-- +goose Up
CREATE TABLE assessments (
    id                    uuid PRIMARY KEY,
    class_id              uuid NOT NULL REFERENCES classes (id),
    module_id             uuid NOT NULL REFERENCES course_modules (id),
    class_session_id      uuid REFERENCES class_sessions (id),
    title                 text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
    description           text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
    type                  text NOT NULL CHECK (type IN ('EXAM', 'ASSIGNMENT')),
    status                text NOT NULL CHECK (status IN ('SCHEDULED', 'CANCELED')),
    max_score             numeric(5, 2) NOT NULL CHECK (max_score > 0 AND max_score <= 100),
    duration_minutes      integer CHECK (duration_minutes >= 5),
    starts_at             timestamptz NOT NULL,
    ends_at               timestamptz NOT NULL,
    composition           text NOT NULL CHECK (composition IN ('MANUAL', 'DRAW')),
    draw_total            integer CHECK (draw_total BETWEEN 1 AND 50),
    audience              text NOT NULL CHECK (audience IN ('ALL_CLASS', 'SELECTED')),
    teacher_private_notes text CHECK (char_length(teacher_private_notes) <= 5000),
    created_by            uuid NOT NULL REFERENCES users (id),
    updated_by            uuid NOT NULL REFERENCES users (id),
    canceled_by           uuid REFERENCES users (id),
    canceled_at           timestamptz,
    cancel_reason         text CHECK (char_length(cancel_reason) BETWEEN 1 AND 500),
    created_at            timestamptz NOT NULL,
    updated_at            timestamptz NOT NULL,
    deleted_at            timestamptz,
    CONSTRAINT assessments_period CHECK (ends_at > starts_at),
    CONSTRAINT assessments_draw_total CHECK ((composition = 'DRAW') = (draw_total IS NOT NULL)),
    CONSTRAINT assessments_cancel_reason CHECK ((status = 'CANCELED') = (cancel_reason IS NOT NULL))
);
CREATE INDEX assessments_class_start_idx ON assessments (class_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX assessments_class_status_idx ON assessments (class_id, status) WHERE deleted_at IS NULL;
-- A lesson has at most one active assessment; a canceled one frees it (RN-04).
CREATE UNIQUE INDEX assessments_one_active_per_session ON assessments (class_session_id)
    WHERE class_session_id IS NOT NULL AND status = 'SCHEDULED' AND deleted_at IS NULL;

CREATE TABLE assessment_items (
    id            uuid PRIMARY KEY,
    assessment_id uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    question_id   uuid NOT NULL REFERENCES questions (id),
    position      integer NOT NULL CHECK (position > 0),
    weight        numeric(5, 2) NOT NULL CHECK (weight > 0 AND weight <= 100),
    CONSTRAINT assessment_items_question_once UNIQUE (assessment_id, question_id)
);
CREATE INDEX assessment_items_question_idx ON assessment_items (question_id);

CREATE TABLE assessment_draw_rules (
    id                  uuid PRIMARY KEY,
    assessment_id       uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    difficulty          text NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    quantity            integer NOT NULL CHECK (quantity >= 0),
    points_per_question numeric(5, 2) NOT NULL CHECK (points_per_question > 0 AND points_per_question <= 100),
    CONSTRAINT assessment_draw_rules_level_once UNIQUE (assessment_id, difficulty)
);

CREATE TABLE assessment_students (
    id            uuid PRIMARY KEY,
    assessment_id uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    student_id    uuid NOT NULL REFERENCES users (id),
    created_at    timestamptz NOT NULL,
    CONSTRAINT assessment_students_student_once UNIQUE (assessment_id, student_id)
);

CREATE TABLE assessment_events (
    id             uuid PRIMARY KEY,
    assessment_id  uuid NOT NULL REFERENCES assessments (id),
    kind           text NOT NULL CHECK (kind IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELED')),
    actor_id       uuid NOT NULL REFERENCES users (id),
    reason         text CHECK (char_length(reason) <= 500),
    old_starts_at  timestamptz,
    old_ends_at    timestamptz,
    new_starts_at  timestamptz,
    new_ends_at    timestamptz,
    changed_fields jsonb,
    created_at     timestamptz NOT NULL
);
CREATE INDEX assessment_events_assessment_idx ON assessment_events (assessment_id, created_at);

-- +goose StatementBegin
CREATE FUNCTION assessment_events_frozen() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'assessment_events is append-only';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER assessment_events_no_change BEFORE UPDATE OR DELETE ON assessment_events
    FOR EACH ROW EXECUTE FUNCTION assessment_events_frozen();

-- +goose Down
DROP TABLE assessment_events;
DROP FUNCTION assessment_events_frozen();
DROP TABLE assessment_students;
DROP TABLE assessment_draw_rules;
DROP TABLE assessment_items;
DROP TABLE assessments;
