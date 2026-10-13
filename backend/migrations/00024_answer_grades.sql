-- SPEC-039: the correction of the descriptive answers. A grade is the suggestion of an AI (through the MCP) and the grade the teacher
-- confirms, always one of the five bands. Every suggestion, confirmation and revision is an event that is never changed nor removed
-- (ARCHITECTURE.md, section 2); the events keep the id of the grade without a foreign key, so they outlive it.

-- +goose Up
CREATE TABLE answer_grades (
    id                     uuid PRIMARY KEY,
    progress_id            uuid NOT NULL UNIQUE REFERENCES exercise_progress (id) ON DELETE CASCADE,
    suggested_score        integer CHECK (suggested_score IN (0, 25, 50, 75, 100)),
    suggestion_reason      text,
    suggested_student_note text,
    suggested_at           timestamptz,
    suggested_by           uuid REFERENCES users (id),
    score                  integer CHECK (score IN (0, 25, 50, 75, 100)),
    source                 text CHECK (source IN ('AI_ACCEPTED', 'TEACHER')),
    student_note           text,
    private_note           text,
    graded_by              uuid REFERENCES users (id),
    graded_at              timestamptz,
    created_at             timestamptz NOT NULL,
    updated_at             timestamptz NOT NULL,
    CONSTRAINT answer_grades_source_with_score CHECK ((score IS NULL) = (source IS NULL))
);

CREATE TABLE answer_grade_events (
    id             uuid PRIMARY KEY,
    grade_id       uuid NOT NULL,
    kind           text NOT NULL CHECK (kind IN ('SUGGESTED', 'CONFIRMED', 'REVISED')),
    score          integer CHECK (score IN (0, 25, 50, 75, 100)),
    previous_score integer CHECK (previous_score IN (0, 25, 50, 75, 100)),
    by_user        uuid NOT NULL REFERENCES users (id),
    reason         text,
    created_at     timestamptz NOT NULL
);
CREATE INDEX answer_grade_events_grade_idx ON answer_grade_events (grade_id);

-- +goose StatementBegin
CREATE FUNCTION answer_grade_events_frozen() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'answer_grade_events is append-only';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER answer_grade_events_no_change BEFORE UPDATE OR DELETE ON answer_grade_events
    FOR EACH ROW EXECUTE FUNCTION answer_grade_events_frozen();

-- +goose Down
DROP TABLE answer_grade_events;
DROP FUNCTION answer_grade_events_frozen();
DROP TABLE answer_grades;
