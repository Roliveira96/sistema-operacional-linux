-- SPEC-042: schedule of a class. Weekly meetings generate the sessions of each date; sessions can be changed one by
-- one, added by hand or changed by a special period; events and holidays are shown on the calendar; e-mails wait in
-- an outbox delivered by the scheduler.

-- +goose Up
ALTER TABLE classes ADD COLUMN color text NOT NULL DEFAULT 'orange'
    CHECK (color IN ('orange', 'blue', 'green', 'purple', 'pink', 'teal', 'yellow', 'red'));

ALTER TABLE users ADD COLUMN email_session_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN email_weekly_digest boolean NOT NULL DEFAULT true;

CREATE TABLE class_weekly_meetings (
    id           uuid PRIMARY KEY,
    class_id     uuid NOT NULL REFERENCES classes (id),
    weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time   time NOT NULL,
    end_time     time NOT NULL,
    lesson_count smallint NOT NULL CHECK (lesson_count BETWEEN 1 AND 8),
    mode         text NOT NULL CHECK (mode IN ('IN_PERSON', 'ONLINE')),
    room         text CHECK (char_length(room) <= 60),
    online_url   text,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz,
    CONSTRAINT class_weekly_meetings_time_range CHECK (start_time < end_time)
);
CREATE INDEX class_weekly_meetings_class_idx ON class_weekly_meetings (class_id) WHERE deleted_at IS NULL;

CREATE TABLE special_periods (
    id         uuid PRIMARY KEY,
    class_id   uuid NOT NULL REFERENCES classes (id),
    first_day  date NOT NULL,
    last_day   date NOT NULL,
    action     text NOT NULL CHECK (action IN ('NO_CLASSES', 'ONLINE')),
    label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
    online_url text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz,
    CONSTRAINT special_periods_range CHECK (first_day <= last_day)
);
CREATE INDEX special_periods_class_idx ON special_periods (class_id, first_day) WHERE deleted_at IS NULL;

CREATE TABLE class_sessions (
    id               uuid PRIMARY KEY,
    class_id         uuid NOT NULL REFERENCES classes (id),
    meeting_id       uuid REFERENCES class_weekly_meetings (id),
    date             date NOT NULL,
    start_time       time NOT NULL,
    end_time         time NOT NULL,
    lesson_count     smallint NOT NULL CHECK (lesson_count BETWEEN 1 AND 8),
    mode             text NOT NULL CHECK (mode IN ('IN_PERSON', 'ONLINE')),
    room             text CHECK (char_length(room) <= 60),
    online_url       text,
    status           text NOT NULL CHECK (status IN ('SCHEDULED', 'CANCELED')),
    origin           text NOT NULL CHECK (origin IN ('WEEKLY', 'EXTRA')),
    overridden       boolean NOT NULL DEFAULT false,
    change_reason    text CHECK (char_length(change_reason) <= 300),
    period_id        uuid REFERENCES special_periods (id),
    on_holiday       boolean NOT NULL DEFAULT false,
    reminder_sent_at timestamptz,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    deleted_at       timestamptz,
    CONSTRAINT class_sessions_time_range CHECK (start_time < end_time)
);
CREATE UNIQUE INDEX class_sessions_meeting_date_unique ON class_sessions (class_id, meeting_id, date)
    WHERE deleted_at IS NULL AND meeting_id IS NOT NULL;
CREATE INDEX class_sessions_class_date_idx ON class_sessions (class_id, date) WHERE deleted_at IS NULL;
CREATE INDEX class_sessions_date_idx ON class_sessions (date) WHERE deleted_at IS NULL;

CREATE TABLE class_events (
    id          uuid PRIMARY KEY,
    class_id    uuid NOT NULL REFERENCES classes (id),
    title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
    date        date NOT NULL,
    all_day     boolean NOT NULL DEFAULT false,
    start_time  time,
    end_time    time,
    location    text,
    online_url  text,
    created_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    deleted_at  timestamptz
);
CREATE INDEX class_events_class_date_idx ON class_events (class_id, date) WHERE deleted_at IS NULL;

CREATE TABLE holidays (
    id         uuid PRIMARY KEY,
    date       date NOT NULL,
    name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    scope      text NOT NULL CHECK (scope IN ('NATIONAL', 'LOCAL', 'RECESS')),
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
CREATE UNIQUE INDEX holidays_date_name_unique ON holidays (date, name) WHERE deleted_at IS NULL;

CREATE TABLE email_outbox (
    id                uuid PRIMARY KEY,
    recipient_user_id uuid REFERENCES users (id),
    recipient         text NOT NULL,
    kind              text NOT NULL,
    subject           text NOT NULL,
    body_text         text NOT NULL,
    body_html         text NOT NULL,
    dedupe_key        text,
    status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    attempts          integer NOT NULL DEFAULT 0,
    send_after        timestamptz NOT NULL,
    sent_at           timestamptz,
    last_error        text,
    created_at        timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL
);
CREATE UNIQUE INDEX email_outbox_dedupe_unique ON email_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX email_outbox_due_idx ON email_outbox (send_after) WHERE status = 'PENDING';

-- RN-11: the fixed national holidays of 2026 to 2030; the movable ones are added by the scheduler.
INSERT INTO holidays (id, date, name, scope, active, created_at, updated_at)
SELECT gen_random_uuid(), make_date(y, f.m, f.d), f.name, 'NATIONAL', true, now(), now()
FROM generate_series(2026, 2030) AS y
CROSS JOIN (VALUES
    (1, 1, 'Confraternização Universal'),
    (4, 21, 'Tiradentes'),
    (5, 1, 'Dia do Trabalhador'),
    (9, 7, 'Independência do Brasil'),
    (10, 12, 'Nossa Senhora Aparecida'),
    (11, 2, 'Finados'),
    (11, 15, 'Proclamação da República'),
    (11, 20, 'Dia Nacional de Zumbi e da Consciência Negra'),
    (12, 25, 'Natal')
) AS f (m, d, name);

-- +goose Down
DROP TABLE email_outbox;
DROP TABLE holidays;
DROP TABLE class_events;
DROP TABLE class_sessions;
DROP TABLE special_periods;
DROP TABLE class_weekly_meetings;
ALTER TABLE users DROP COLUMN email_weekly_digest;
ALTER TABLE users DROP COLUMN email_session_reminders;
ALTER TABLE classes DROP COLUMN color;
