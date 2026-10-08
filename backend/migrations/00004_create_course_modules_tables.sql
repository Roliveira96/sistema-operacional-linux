-- SPEC-010: course_modules, module_class_assignments, module_exercise_items, module_materials.
-- Course modules organize learning units with visibility modes and sequential exercises.

-- +goose Up
CREATE TABLE course_modules (
    id               uuid PRIMARY KEY,
    teacher_id       uuid NOT NULL REFERENCES users (id),
    title            text NOT NULL,
    description      text NOT NULL,
    visibility       text NOT NULL CHECK (visibility IN ('PUBLIC', 'AUTHENTICATED', 'PRIVATE')),
    status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    activation_start timestamptz,
    activation_end   timestamptz,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    deleted_at       timestamptz,
    CONSTRAINT course_modules_date_range CHECK (activation_start IS NULL OR activation_end IS NULL OR activation_start <= activation_end)
);

CREATE INDEX course_modules_teacher_idx ON course_modules (teacher_id, status)
    WHERE deleted_at IS NULL;
CREATE INDEX course_modules_public_visibility_idx ON course_modules (visibility, status, activation_start, activation_end)
    WHERE deleted_at IS NULL;
CREATE INDEX course_modules_deleted_at_idx ON course_modules (deleted_at);

CREATE TABLE module_class_assignments (
    id          uuid PRIMARY KEY,
    module_id   uuid NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
    class_id    uuid NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    assigned_by uuid NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL
);

CREATE UNIQUE INDEX module_class_unique ON module_class_assignments (module_id, class_id);
CREATE INDEX module_class_class_idx ON module_class_assignments (class_id);

CREATE TABLE module_exercise_items (
    id             uuid PRIMARY KEY,
    module_id      uuid NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
    exercise_id    uuid NOT NULL,
    sequence_order integer NOT NULL CHECK (sequence_order >= 1),
    is_mandatory   boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL
);

CREATE UNIQUE INDEX module_exercise_unique ON module_exercise_items (module_id, exercise_id);
CREATE UNIQUE INDEX module_exercise_order_unique ON module_exercise_items (module_id, sequence_order);

CREATE TABLE module_materials (
    id          uuid PRIMARY KEY,
    module_id   uuid NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
    title       text NOT NULL,
    description text,
    url         text NOT NULL,
    created_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    deleted_at  timestamptz
);

CREATE INDEX module_materials_module_idx ON module_materials (module_id)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE module_materials;
DROP TABLE module_exercise_items;
DROP TABLE module_class_assignments;
DROP TABLE course_modules;
