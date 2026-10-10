-- SPEC-023 RN-11: an exercise of the module can continue from where the previous one of the trail ended. Its machine is
-- built again from the recipe of the chain (the solutions recorded), never from a machine in use.

-- +goose Up
ALTER TABLE questions ADD COLUMN continues_previous boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE questions DROP COLUMN continues_previous;
