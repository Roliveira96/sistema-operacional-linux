-- SPEC-011: content blocks, scenarios, questions and assessment templates;
-- seed metadata on course_modules; foreign key for module exercise items.

-- +goose Up
ALTER TABLE course_modules
    ADD COLUMN source_key           text,
    ADD COLUMN icon                 text,
    ADD COLUMN color                text,
    ADD COLUMN display_order        integer,
    ADD COLUMN edited_by_teacher_at timestamptz;
CREATE UNIQUE INDEX course_modules_source_key_unique ON course_modules (source_key) WHERE source_key IS NOT NULL;

CREATE TABLE content_blocks (
    id                   uuid PRIMARY KEY,
    module_id            uuid NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
    source_key           text,
    block_type           text NOT NULL CHECK (block_type IN ('TEXT', 'COMMAND', 'TIP', 'CURIOSITY', 'STEP_BY_STEP',
                             'CARDS', 'WIDGET', 'LEGACY_HTML')),
    position             integer NOT NULL CHECK (position >= 1),
    payload              jsonb NOT NULL,
    edited_by_teacher_at timestamptz,
    created_at           timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL,
    -- Deferred so a reordering inside one transaction does not collide midway.
    CONSTRAINT content_blocks_position_unique UNIQUE (module_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX content_blocks_source_key_unique ON content_blocks (source_key) WHERE source_key IS NOT NULL;

CREATE TABLE scenarios (
    id               uuid PRIMARY KEY,
    source_key       text,
    base_scenario_id uuid REFERENCES scenarios (id),
    snapshot         jsonb NOT NULL,
    format_version   integer NOT NULL,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL
);
CREATE UNIQUE INDEX scenarios_source_key_unique ON scenarios (source_key) WHERE source_key IS NOT NULL;

CREATE TABLE questions (
    id                    uuid PRIMARY KEY,
    source_key            text,
    module_id             uuid NOT NULL REFERENCES course_modules (id),
    kind                  text NOT NULL CHECK (kind IN ('PRACTICAL', 'THEORETICAL_SINGLE', 'THEORETICAL_MULTIPLE',
                              'THEORETICAL_BOOLEAN', 'DISCURSIVE')),
    usage                 text NOT NULL CHECK (usage IN ('EXERCISE', 'ASSESSMENT')),
    difficulty            text NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    status                text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    title                 text NOT NULL,
    statement             text NOT NULL,
    hint                  text,
    explanation           text,
    scenario_id           uuid REFERENCES scenarios (id),
    reference_solution    jsonb,
    validation_conditions jsonb,
    choices               jsonb,
    answer_key            jsonb,
    tags                  jsonb,
    edited_by_teacher_at  timestamptz,
    created_at            timestamptz NOT NULL,
    updated_at            timestamptz NOT NULL,
    deleted_at            timestamptz,
    CONSTRAINT questions_practical_fields CHECK (kind <> 'PRACTICAL' OR (scenario_id IS NOT NULL AND validation_conditions IS NOT NULL)),
    CONSTRAINT questions_objective_fields CHECK (kind NOT IN ('THEORETICAL_SINGLE', 'THEORETICAL_MULTIPLE', 'THEORETICAL_BOOLEAN')
        OR (choices IS NOT NULL AND answer_key IS NOT NULL))
);
CREATE UNIQUE INDEX questions_source_key_unique ON questions (source_key) WHERE source_key IS NOT NULL;
CREATE INDEX questions_module_usage_status_idx ON questions (module_id, usage, status);
CREATE INDEX questions_difficulty_idx ON questions (difficulty);
CREATE INDEX questions_deleted_at_idx ON questions (deleted_at);

CREATE TABLE assessment_templates (
    id                   uuid PRIMARY KEY,
    source_key           text,
    title                text NOT NULL,
    description          text NOT NULL,
    duration_minutes     integer NOT NULL CHECK (duration_minutes > 0),
    max_score            numeric(6, 2) NOT NULL CHECK (max_score > 0),
    status               text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    edited_by_teacher_at timestamptz,
    created_at           timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL,
    deleted_at           timestamptz
);
CREATE UNIQUE INDEX assessment_templates_source_key_unique ON assessment_templates (source_key) WHERE source_key IS NOT NULL;

CREATE TABLE assessment_template_questions (
    id          uuid PRIMARY KEY,
    template_id uuid NOT NULL REFERENCES assessment_templates (id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES questions (id),
    position    integer NOT NULL CHECK (position >= 1),
    weight      numeric(6, 2) NOT NULL CHECK (weight > 0),
    CONSTRAINT assessment_template_questions_unique UNIQUE (template_id, question_id),
    CONSTRAINT assessment_template_questions_position_unique UNIQUE (template_id, position) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE module_exercise_items
    ADD CONSTRAINT module_exercise_items_exercise_fk FOREIGN KEY (exercise_id) REFERENCES questions (id);

-- +goose Down
ALTER TABLE module_exercise_items DROP CONSTRAINT module_exercise_items_exercise_fk;
DROP TABLE assessment_template_questions;
DROP TABLE assessment_templates;
DROP TABLE questions;
DROP TABLE scenarios;
DROP TABLE content_blocks;
DROP INDEX course_modules_source_key_unique;
ALTER TABLE course_modules
    DROP COLUMN source_key,
    DROP COLUMN icon,
    DROP COLUMN color,
    DROP COLUMN display_order,
    DROP COLUMN edited_by_teacher_at;
