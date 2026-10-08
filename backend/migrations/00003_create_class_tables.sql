-- SPEC-009: classes and class_enrollments.
-- Classes represent academic course offerings managed by teachers.
-- Class enrollments represent student memberships and join requests.

-- +goose Up
CREATE TABLE classes (
    id                         uuid PRIMARY KEY,
    teacher_id                 uuid NOT NULL REFERENCES users (id),
    name                       text NOT NULL,
    course_code                text NOT NULL,
    semester                   text NOT NULL,
    syllabus                   text,
    institutional_guidelines   text,
    start_date                 timestamptz NOT NULL,
    end_date                   timestamptz NOT NULL,
    schedule_description       text,
    enable_virtual_classroom   boolean NOT NULL DEFAULT false,
    enable_invite_link         boolean NOT NULL DEFAULT false,
    invite_link_token          text,
    invite_link_start          timestamptz,
    invite_link_end            timestamptz,
    status                     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    archive_reason             text,
    created_at                 timestamptz NOT NULL,
    updated_at                 timestamptz NOT NULL,
    deleted_at                 timestamptz,
    CONSTRAINT classes_date_range CHECK (start_date <= end_date)
);

CREATE UNIQUE INDEX classes_invite_link_token_unique ON classes (invite_link_token)
    WHERE invite_link_token IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX classes_teacher_status_idx ON classes (teacher_id, status)
    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX classes_teacher_course_semester_unique ON classes (teacher_id, course_code, semester)
    WHERE deleted_at IS NULL AND status != 'ARCHIVED';
CREATE INDEX classes_deleted_at_idx ON classes (deleted_at);

CREATE TABLE class_enrollments (
    id               uuid PRIMARY KEY,
    class_id         uuid NOT NULL REFERENCES classes (id),
    user_id          uuid NOT NULL REFERENCES users (id),
    status           text NOT NULL CHECK (status IN ('PENDING_MODERATION', 'ACTIVE', 'REJECTED', 'TRANSFERRED', 'UNENROLLED')),
    origin           text NOT NULL CHECK (origin IN ('INVITE_LINK', 'DIRECT_BY_TEACHER', 'CSV_IMPORT')),
    rejection_reason text,
    requested_at     timestamptz NOT NULL,
    decided_at       timestamptz,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    deleted_at       timestamptz
);

CREATE UNIQUE INDEX class_enrollments_class_user_unique ON class_enrollments (class_id, user_id)
    WHERE deleted_at IS NULL;
CREATE INDEX class_enrollments_class_status_idx ON class_enrollments (class_id, status)
    WHERE deleted_at IS NULL;
CREATE INDEX class_enrollments_user_idx ON class_enrollments (user_id)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE class_enrollments;
DROP TABLE classes;
