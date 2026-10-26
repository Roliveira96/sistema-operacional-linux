-- SPEC-083: the start of an in-person exam by the teacher. Until she starts it nobody enters and the clearance of the students is not decided.
-- Nothing is started by this migration (RN-09): the assessments already stored have no start. The event STARTED joins the kinds of the history.

-- +goose Up
ALTER TABLE assessments ADD COLUMN started_at timestamptz, ADD COLUMN started_by uuid REFERENCES users (id);
ALTER TABLE assessments
    ADD CONSTRAINT assessments_started_together CHECK ((started_at IS NULL) = (started_by IS NULL)),
    ADD CONSTRAINT assessments_started_in_person CHECK (started_at IS NULL OR modality = 'IN_PERSON');

ALTER TABLE assessment_events DROP CONSTRAINT assessment_events_kind_check;
ALTER TABLE assessment_events ADD CONSTRAINT assessment_events_kind_check
    CHECK (kind IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELED', 'CLEARANCE_UPDATED', 'STARTED'));

-- +goose Down
ALTER TABLE assessment_events DISABLE TRIGGER assessment_events_no_change;
DELETE FROM assessment_events WHERE kind = 'STARTED';
ALTER TABLE assessment_events ENABLE TRIGGER assessment_events_no_change;
ALTER TABLE assessment_events DROP CONSTRAINT assessment_events_kind_check;
ALTER TABLE assessment_events ADD CONSTRAINT assessment_events_kind_check
    CHECK (kind IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELED', 'CLEARANCE_UPDATED'));
ALTER TABLE assessments
    DROP CONSTRAINT assessments_started_in_person,
    DROP CONSTRAINT assessments_started_together,
    DROP COLUMN started_by,
    DROP COLUMN started_at;
