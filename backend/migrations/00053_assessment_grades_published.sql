-- SPEC-098: the teacher publishes the grades of the exam once every delivered attempt is reviewed; the publication is never undone (RN-02).

-- +goose Up
ALTER TABLE assessments
    ADD COLUMN grades_published_at timestamptz,
    ADD COLUMN grades_published_by uuid REFERENCES users (id);

-- +goose Down
ALTER TABLE assessments
    DROP COLUMN grades_published_by,
    DROP COLUMN grades_published_at;
