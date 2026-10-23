-- Undo search trigram GIN indexes (H2).
-- Lab :5433 first. Render only after Admiral CLEAR.
-- DROP INDEX CONCURRENTLY cannot run inside a transaction.
-- Run with psql without -1 / --single-transaction.
-- The pg_trgm extension is left installed.

DROP INDEX CONCURRENTLY IF EXISTS source_posts_source_url_trgm;
DROP INDEX CONCURRENTLY IF EXISTS source_posts_text_trgm;
DROP INDEX CONCURRENTLY IF EXISTS source_posts_poster_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS source_posts_poster_handle_trgm;

DROP INDEX CONCURRENTLY IF EXISTS shot_comms_text_trgm;
DROP INDEX CONCURRENTLY IF EXISTS shot_comms_account_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS shot_comms_handle_trgm;

DROP INDEX CONCURRENTLY IF EXISTS ronald_comms_text_trgm;
DROP INDEX CONCURRENTLY IF EXISTS ronald_comms_account_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS ronald_comms_handle_trgm;

DROP INDEX CONCURRENTLY IF EXISTS eagle_comms_text_trgm;
DROP INDEX CONCURRENTLY IF EXISTS eagle_comms_account_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS eagle_comms_handle_trgm;

DROP INDEX CONCURRENTLY IF EXISTS red_folder_comms_text_trgm;
DROP INDEX CONCURRENTLY IF EXISTS red_folder_comms_account_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS red_folder_comms_handle_trgm;

DROP INDEX CONCURRENTLY IF EXISTS dog_comms_text_trgm;
DROP INDEX CONCURRENTLY IF EXISTS dog_comms_account_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS dog_comms_handle_trgm;

DROP INDEX CONCURRENTLY IF EXISTS operations_summary_trgm;
DROP INDEX CONCURRENTLY IF EXISTS operations_name_trgm;

DROP INDEX CONCURRENTLY IF EXISTS people_summary_trgm;
DROP INDEX CONCURRENTLY IF EXISTS people_role_trgm;
DROP INDEX CONCURRENTLY IF EXISTS people_name_trgm;
