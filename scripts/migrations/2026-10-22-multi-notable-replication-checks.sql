-- Multi-notable replication checks (read-only).
-- Step c of rollback, and the record-before-step queries for phase A,
-- phase B, and each rollback step.
-- Phase B rollout: run on lab first, then Render.
-- Publisher = lab (publication exittrace_lab_pub). Subscriber = Render
-- (subscription exittrace_lab_sub, slot exittrace_lab_sub on lab).
-- Do not ALTER PUBLICATION.
-- SELECTs only.
--
-- Rollback order (fixed):
--   a. Render: drop CHECK person_events_seq_notable_only.
--      2026-10-22-multi-notable-rollback-a-render-drop-check.sql
--   b. Lab: copy extra notables to the lab-local retired tables, drop the
--      CHECK, re-key, and keep PRIMARY KEY (person_id, kind, seq).
--      One transaction.
--      2026-10-22-multi-notable-rollback-b-lab-retire-rekey.sql
--   c. Wait for LSN catch-up (Render applied the re-key). Read-only.
--      This file.
--   d. Render: restore PRIMARY KEY (person_id, kind). Keep seq and unique
--      index person_events_person_kind_seq_key. REPLICA IDENTITY DEFAULT.
--      Guard aborts if kind = 'notable' AND seq > 0 still exists.
--      2026-10-22-multi-notable-rollback-d-render-restore-pk.sql
--   e. Lab: restore PRIMARY KEY (person_id, kind). Same shape and same guard.
--      2026-10-22-multi-notable-rollback-e-lab-restore-pk.sql
--
-- Write freeze is REQUIRED (not optional): pause lab person_events writes
-- from before lab phase B until after Render phase B, and from before
-- rollback step b until after step e. Confirm LSN catch-up before
-- unfreezing. The app guard only sees the local DB, so it cannot stop a
-- seq > 0 notable on lab while Render is on a different key.
-- Before step b, run the publication precheck in
-- 2026-10-22-multi-notable-replication-checks.sql: puballtables must be
-- false and neither retired table listed. If puballtables is true, STOP and
-- go back to Worf. No ALTER PUBLICATION.
--
-- Catch-up: lab slot confirmed_flush_lsn and Render latest_end_lsn are >=
-- the lab pg_current_wal_lsn() recorded right after the lab step committed.
-- Stop if Render logs show apply errors or apply_error_count rises.
-- Do not run the next step. Roll back in the a–e order.

-- On Render (subscriber):
SELECT subname, pid, received_lsn, latest_end_lsn, latest_end_time, last_msg_receipt_time
  FROM pg_stat_subscription
 WHERE subname = 'exittrace_lab_sub';

-- PG15+
SELECT subname, apply_error_count, sync_error_count
  FROM pg_stat_subscription_stats
 WHERE subname = 'exittrace_lab_sub';

-- On lab (publisher):
SELECT pg_current_wal_lsn();

SELECT slot_name, active, confirmed_flush_lsn,
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
  FROM pg_replication_slots
 WHERE slot_name = 'exittrace_lab_sub';

-- On lab, before rollback step b (publication precheck). Record both results.
-- Required: puballtables = false, and the second query returns no rows
-- (neither retired table is in any publication). If puballtables is true,
-- STOP: do not run step b; go back to Worf. No ALTER PUBLICATION.
SELECT pubname, puballtables
  FROM pg_publication
 WHERE pubname = 'exittrace_lab_pub';

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE tablename IN ('person_events_multi_notable_retired',
                     'people_events_multi_notable_retired');
