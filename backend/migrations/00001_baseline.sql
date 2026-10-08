-- Baseline migration. The runner creates the schema before goose starts,
-- because goose keeps its version table inside it; this file records the
-- starting point of the migration history. The schema name is configurable
-- (DB_SCHEMA), so it is resolved from the connection search_path.

-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE format('COMMENT ON SCHEMA %I IS %L', current_schema(), 'Linux na Pratica platform (TCC 2)');
END
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE format('COMMENT ON SCHEMA %I IS NULL', current_schema());
END
$$;
-- +goose StatementEnd
