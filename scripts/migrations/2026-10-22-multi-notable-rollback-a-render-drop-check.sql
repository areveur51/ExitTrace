-- Multi-notable rollback step a (Render).
-- Phase B rollout: run on lab first, then Render.
-- Publisher = lab (publication exittrace_lab_pub). Subscriber = Render
-- (subscription exittrace_lab_sub, slot exittrace_lab_sub on lab).
-- Lab keeps sending seq as a key column until Render is back on
-- (person_id, kind). At every moment Render's PK columns are a subset of
-- the key columns lab sends.
--
-- Rollback order (fixed):
--   a. Render: drop CHECK person_events_seq_notable_only.
--      2026-10-22-multi-notable-rollback-a-render-drop-check.sql
--   b. Lab: copy extra notables to the lab-local retired tables, drop the
--      CHECK, re-key, and keep PRIMARY KEY (person_id, kind, seq).
--      One transaction.
--      2026-10-22-multi-notable-rollback-b-lab-retire-rekey.sql
--   c. Wait for LSN catch-up (Render applied the re-key). Read-only.
--      docs/MULTI_NOTABLE_MIGRATION.md and
--      2026-10-22-multi-notable-replication-checks.sql
--   d. Render: restore PRIMARY KEY (person_id, kind). Keep seq and unique
--      index person_events_person_kind_seq_key. REPLICA IDENTITY DEFAULT.
--      Guard aborts if kind = 'notable' AND seq > 0 still exists.
--      2026-10-22-multi-notable-rollback-d-render-restore-pk.sql
--   e. Lab: restore PRIMARY KEY (person_id, kind). Same shape and same guard.
--      2026-10-22-multi-notable-rollback-e-lab-restore-pk.sql
--
-- This step runs on Render (subscriber exittrace_lab_sub).
-- Do not ALTER PUBLICATION.
-- Idempotent. One transaction. Drops the CHECK only, so a later replicated
-- re-key can set kind = notable_retired_N with seq > 0.

BEGIN;

ALTER TABLE person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;

COMMIT;
