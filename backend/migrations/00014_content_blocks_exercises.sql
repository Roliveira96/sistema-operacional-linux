-- SPEC-022: the group of exercises of a card is a block of the type EXERCISES.

-- +goose Up
ALTER TABLE content_blocks DROP CONSTRAINT content_blocks_block_type_check;
ALTER TABLE content_blocks ADD CONSTRAINT content_blocks_block_type_check
    CHECK (block_type IN ('TEXT', 'COMMAND', 'TIP', 'CURIOSITY', 'STEP_BY_STEP', 'CARDS', 'WIDGET', 'LEGACY_HTML', 'EXERCISES'));

-- +goose Down
DELETE FROM content_blocks WHERE block_type = 'EXERCISES';
ALTER TABLE content_blocks DROP CONSTRAINT content_blocks_block_type_check;
ALTER TABLE content_blocks ADD CONSTRAINT content_blocks_block_type_check
    CHECK (block_type IN ('TEXT', 'COMMAND', 'TIP', 'CURIOSITY', 'STEP_BY_STEP', 'CARDS', 'WIDGET', 'LEGACY_HTML'));
