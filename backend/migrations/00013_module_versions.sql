-- SPEC-021: versions of a module. The draft is what the tables hold now; a version is a frozen copy
-- of it (the blocks and the snapshot of the module) that students read.
-- content_hash is the SHA-256 of the jsonb text of the content, to tell whether the draft changed.

-- +goose Up
CREATE TABLE module_versions (
    id           uuid PRIMARY KEY,
    module_id    uuid        NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
    number       integer     NOT NULL CHECK (number > 0),
    note         text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
    content      jsonb       NOT NULL,
    content_hash text        NOT NULL,
    created_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT module_versions_number_unique UNIQUE (module_id, number)
);

-- Version 1 of the modules that exist, with what students see today.
-- +goose StatementBegin
INSERT INTO module_versions (id, module_id, number, note, content, content_hash, created_by)
SELECT gen_random_uuid(), c.id, 1, 'Versão inicial', c.content,
       encode(sha256(convert_to(c.content::text, 'UTF8')), 'hex'), c.teacher_id
FROM (
    SELECT m.id, m.teacher_id,
           jsonb_build_object(
               'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'type', b.block_type, 'position', b.position,
                                                                       'payload', b.payload, 'active', b.inactive_at IS NULL)
                                                    ORDER BY b.position)
                                   FROM content_blocks b WHERE b.module_id = m.id), '[]'::jsonb),
               'setup', m.setup) AS content
    FROM course_modules m
) c;
-- +goose StatementEnd

-- A module is born with an empty version 1, so there is always a published version (RN-11).
-- +goose StatementBegin
CREATE FUNCTION course_modules_first_version() RETURNS trigger AS $$
DECLARE
    empty jsonb := '{"blocks": [], "setup": null}'::jsonb;
BEGIN
    INSERT INTO module_versions (id, module_id, number, note, content, content_hash, created_by)
    VALUES (gen_random_uuid(), NEW.id, 1, 'Versão inicial', empty,
            encode(sha256(convert_to(empty::text, 'UTF8')), 'hex'), NEW.teacher_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER course_modules_first_version AFTER INSERT ON course_modules
    FOR EACH ROW EXECUTE FUNCTION course_modules_first_version();

-- +goose Down
DROP TRIGGER course_modules_first_version ON course_modules;
DROP FUNCTION course_modules_first_version();
DROP TABLE module_versions;
