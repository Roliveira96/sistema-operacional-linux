-- SPEC-058: the doubt that comes with a raised hand. Optional text that the student writes and only the teacher reads, of up to 300
-- characters (counted by character, as char_length does); null means no question. It is erased when the hand goes down.

-- +goose Up
ALTER TABLE live_hand_raises ADD COLUMN question text CHECK (char_length(question) <= 300);

-- +goose Down
ALTER TABLE live_hand_raises DROP COLUMN question;
