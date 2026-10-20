-- SPEC-076: the modality of an assessment (in person or online) and the clearance of the students for an in-person exam. The decisions of the
-- teacher live in their own table, one row for each student, the last decision only (D-07); "waiting" is not stored, it is the lack of a row (D-06).
-- The assessments already stored get the modality their type has by default and do not require the clearance, so nothing starts requiring it alone.

-- +goose Up
ALTER TABLE assessments ADD COLUMN modality text, ADD COLUMN requires_clearance boolean NOT NULL DEFAULT false;
UPDATE assessments SET modality = CASE type WHEN 'EXAM' THEN 'IN_PERSON' ELSE 'ONLINE' END;
ALTER TABLE assessments ALTER COLUMN modality SET NOT NULL;
ALTER TABLE assessments
    ADD CONSTRAINT assessments_modality CHECK (modality IN ('IN_PERSON', 'ONLINE')),
    ADD CONSTRAINT assessments_assignment_online CHECK (type = 'EXAM' OR modality = 'ONLINE'),
    ADD CONSTRAINT assessments_clearance_in_person CHECK (NOT requires_clearance OR modality = 'IN_PERSON');

ALTER TABLE assessment_events DROP CONSTRAINT assessment_events_kind_check;
ALTER TABLE assessment_events ADD CONSTRAINT assessment_events_kind_check
    CHECK (kind IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELED', 'CLEARANCE_UPDATED'));

CREATE TABLE assessment_clearances (
    id               uuid PRIMARY KEY,
    assessment_id    uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    student_id       uuid NOT NULL REFERENCES users (id),
    status           text NOT NULL CHECK (status IN ('APPROVED', 'REJECTED')),
    rejection_reason text CHECK (char_length(rejection_reason) <= 300),
    cleared_by       uuid NOT NULL REFERENCES users (id),
    cleared_at       timestamptz NOT NULL,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    CONSTRAINT assessment_clearances_student_once UNIQUE (assessment_id, student_id),
    CONSTRAINT assessment_clearances_reason_on_rejection CHECK (rejection_reason IS NULL OR status = 'REJECTED')
);

-- +goose Down
DROP TABLE assessment_clearances;
ALTER TABLE assessment_events DISABLE TRIGGER assessment_events_no_change;
DELETE FROM assessment_events WHERE kind = 'CLEARANCE_UPDATED';
ALTER TABLE assessment_events ENABLE TRIGGER assessment_events_no_change;
ALTER TABLE assessment_events DROP CONSTRAINT assessment_events_kind_check;
ALTER TABLE assessment_events ADD CONSTRAINT assessment_events_kind_check
    CHECK (kind IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELED'));
ALTER TABLE assessments
    DROP CONSTRAINT assessments_clearance_in_person,
    DROP CONSTRAINT assessments_assignment_online,
    DROP CONSTRAINT assessments_modality,
    DROP COLUMN requires_clearance,
    DROP COLUMN modality;
