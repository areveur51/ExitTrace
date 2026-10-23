-- Search trigram GIN indexes for ILIKE '%q%' (H2).
-- Lab :5433 first. Render only after Admiral CLEAR.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Run with psql without -1 / --single-transaction.
-- Do not append this file to bootstrap-db.sql. Do not run at boot.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS people_name_trgm ON people USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS people_role_trgm ON people USING gin (role gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS people_summary_trgm ON people USING gin (summary gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS operations_name_trgm ON operations USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS operations_summary_trgm ON operations USING gin (summary gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS dog_comms_handle_trgm ON dog_comms USING gin (handle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS dog_comms_account_name_trgm ON dog_comms USING gin (account_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS dog_comms_text_trgm ON dog_comms USING gin (text gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS red_folder_comms_handle_trgm ON red_folder_comms USING gin (handle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS red_folder_comms_account_name_trgm ON red_folder_comms USING gin (account_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS red_folder_comms_text_trgm ON red_folder_comms USING gin (text gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS eagle_comms_handle_trgm ON eagle_comms USING gin (handle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS eagle_comms_account_name_trgm ON eagle_comms USING gin (account_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS eagle_comms_text_trgm ON eagle_comms USING gin (text gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ronald_comms_handle_trgm ON ronald_comms USING gin (handle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ronald_comms_account_name_trgm ON ronald_comms USING gin (account_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ronald_comms_text_trgm ON ronald_comms USING gin (text gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS shot_comms_handle_trgm ON shot_comms USING gin (handle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS shot_comms_account_name_trgm ON shot_comms USING gin (account_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS shot_comms_text_trgm ON shot_comms USING gin (text gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS source_posts_poster_handle_trgm ON source_posts USING gin (poster_handle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS source_posts_poster_name_trgm ON source_posts USING gin (poster_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS source_posts_text_trgm ON source_posts USING gin (text gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS source_posts_source_url_trgm ON source_posts USING gin (source_url gin_trgm_ops);
