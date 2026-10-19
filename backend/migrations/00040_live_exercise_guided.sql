-- SPEC-071: the guided practice of the lesson. A round can be paused (the start of the pause that is on, and the seconds of the pauses that
-- ended), get more time (duration_seconds is the time in all) and be closed, when the class goes back to the lesson. A result becomes the row of
-- every student of the round: IN_PROGRESS while he works, COMPLETED when the server approved his machine (only then with the time and the points)
-- and NOT_COMPLETED when the round ended without it; with the commands he reported, whether he raised his hand and whether the teacher took over
-- his terminal. The results of SPEC-065 are conclusions, and the rounds that ended before this migration are closed.

-- +goose Up
ALTER TABLE live_exercise_runs
    ADD COLUMN paused_at      timestamptz,
    ADD COLUMN paused_seconds integer NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),
    ADD COLUMN closed_at      timestamptz,
    ADD CONSTRAINT live_exercise_runs_pause_chk CHECK (paused_at IS NULL OR ended_at IS NULL),
    ADD CONSTRAINT live_exercise_runs_close_chk CHECK (closed_at IS NULL OR ended_at IS NOT NULL);
UPDATE live_exercise_runs SET closed_at = ended_at WHERE ended_at IS NOT NULL;

ALTER TABLE live_exercise_results
    ADD COLUMN status         text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED')),
    ADD COLUMN commands       integer NOT NULL DEFAULT 0 CHECK (commands >= 0),
    ADD COLUMN help_requested boolean NOT NULL DEFAULT false,
    ADD COLUMN taken_over     boolean NOT NULL DEFAULT false,
    ALTER COLUMN completed_at DROP NOT NULL,
    ALTER COLUMN elapsed_seconds DROP NOT NULL,
    ALTER COLUMN points DROP NOT NULL,
    DROP CONSTRAINT live_exercise_results_attempts_check,
    -- who did not conclude may have sent nothing
    ADD CONSTRAINT live_exercise_results_attempts_check CHECK (attempts >= 0),
    ADD CONSTRAINT live_exercise_results_completed_chk CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL AND elapsed_seconds IS NOT NULL AND points IS NOT NULL));

-- +goose Down
DELETE FROM live_exercise_results WHERE status <> 'COMPLETED';
ALTER TABLE live_exercise_results
    DROP CONSTRAINT live_exercise_results_completed_chk,
    DROP CONSTRAINT live_exercise_results_attempts_check,
    ADD CONSTRAINT live_exercise_results_attempts_check CHECK (attempts >= 1),
    ALTER COLUMN completed_at SET NOT NULL,
    ALTER COLUMN elapsed_seconds SET NOT NULL,
    ALTER COLUMN points SET NOT NULL,
    DROP COLUMN taken_over,
    DROP COLUMN help_requested,
    DROP COLUMN commands,
    DROP COLUMN status;
ALTER TABLE live_exercise_runs
    DROP CONSTRAINT live_exercise_runs_close_chk,
    DROP CONSTRAINT live_exercise_runs_pause_chk,
    DROP COLUMN closed_at,
    DROP COLUMN paused_seconds,
    DROP COLUMN paused_at;
