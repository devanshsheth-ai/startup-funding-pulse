-- Trigram similarity for dedupe layer 4 candidate selection (PRD §10 Stage D).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS companies_normalized_name_trgm_idx ON companies USING gin (normalized_name gin_trgm_ops);
