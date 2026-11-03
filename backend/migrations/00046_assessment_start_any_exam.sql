-- SPEC-089: every exam, in person or online, is started by the teacher; an assignment never is. Nothing is started by this migration (RN-04).

-- +goose Up
ALTER TABLE assessments DROP CONSTRAINT assessments_started_in_person;
ALTER TABLE assessments ADD CONSTRAINT assessments_started_exam CHECK (started_at IS NULL OR type = 'EXAM');

-- +goose Down
UPDATE assessments SET started_at = NULL, started_by = NULL WHERE modality <> 'IN_PERSON';
ALTER TABLE assessments DROP CONSTRAINT assessments_started_exam;
ALTER TABLE assessments ADD CONSTRAINT assessments_started_in_person CHECK (started_at IS NULL OR modality = 'IN_PERSON');
