-- Multi-notable replication checks (read-only).
-- SELECTs only. Run inside BEGIN READ ONLY ... ROLLBACK.
-- r0 / r3 of the rollback, and the record-before-and-after-every-step queries
-- for phase A, phase B, and each rollback step (r1..r7).
--
-- Rollback order (fixed, Worf form). Freeze lab person_events writes r0..r6.
--   r0. Lab + Render, read-only: freeze lab writes to person_events; record
--       lab pg_current_wal_lsn(), slot confirmed_flush_lsn, Render
--       latest_end_lsn, apply_error_count, srsubstate, counts and md5.
--       2026-10-22-multi-notable-replication-checks.sql
--   r1. Lab: ALTER TABLE public.person_events REPLICA IDENTITY FULL.
--       2026-10-22-multi-notable-rollback-r1-lab-replica-identity-full.sql
--   r2. Lab: copy every seq > 0 row into the lab-local _bak table first, then
--       DELETE those rows. One transaction. No TRUNCATE, no CASCADE.
--       2026-10-22-multi-notable-rollback-r2-lab-bak-delete.sql
--   r3. Read-only: LSN catch-up on Render; counts and md5 match lab.
--       2026-10-22-multi-notable-replication-checks.sql
--   r3a. Render: drop CHECK person_events_seq_notable_only (any time before r4).
--       2026-10-22-multi-notable-rollback-r3a-render-drop-check.sql
--   r4. Render: PRIMARY KEY back to (person_id, kind), guarded on 0 rows with
--       seq > 0 and 0 duplicate (person_id, kind).
--       2026-10-22-multi-notable-rollback-r4-render-restore-pk.sql
--   r5. Lab: PRIMARY KEY back to (person_id, kind), same guards. Keeps
--       REPLICA IDENTITY FULL.
--       2026-10-22-multi-notable-rollback-r5-lab-restore-pk.sql
--   r6. Lab: ALTER TABLE public.person_events REPLICA IDENTITY DEFAULT.
--       2026-10-22-multi-notable-rollback-r6-lab-replica-identity-default.sql
--   r7. Optional, only after the code is reverted: drop seq, lab first, then
--       Render. Leaving seq in place is fine.
--       2026-10-22-multi-notable-rollback-r7a-lab-drop-seq.sql
--       2026-10-22-multi-notable-rollback-r7b-render-drop-seq.sql
--   After every step: apply_error_count flat and every srsubstate = 'r'
--   (replication-checks.sql). If not, STOP; do not run the next step.
--
-- Invariant (forward and back, every step): Render's key columns are a subset
-- of lab's replica identity columns, OR lab is on REPLICA IDENTITY FULL; and
-- lab never has a column Render lacks.
--
-- Publisher = lab (publication exittrace_lab_pub). Subscriber = Render
-- (subscription exittrace_lab_sub, slot exittrace_lab_sub on lab).
-- Phase B rollout: run on lab first, then Render.
-- Do not ALTER PUBLICATION. No file-deletion commands anywhere.
--
-- Catch-up: lab slot confirmed_flush_lsn and Render latest_end_lsn are >=
-- the lab pg_current_wal_lsn() recorded right after the lab step committed.
-- Stop if Render logs show apply errors or apply_error_count rises.

-- Both sides: server version.
SELECT version();

-- On Render (subscriber):
SELECT subname, pid, received_lsn, latest_end_lsn, latest_end_time, last_msg_receipt_time
  FROM pg_stat_subscription
 WHERE subname = 'exittrace_lab_sub';

-- PG15+
SELECT subname, apply_error_count, sync_error_count
  FROM pg_stat_subscription_stats
 WHERE subname = 'exittrace_lab_sub';

-- Every row must be 'r'.
SELECT srsubstate, count(*) AS n
  FROM pg_subscription_rel
 GROUP BY srsubstate;

-- On lab (publisher):
SELECT pg_current_wal_lsn();

SELECT slot_name, active, confirmed_flush_lsn,
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
  FROM pg_replication_slots
 WHERE slot_name = 'exittrace_lab_sub';

-- Both sides: person_events shape (column list must be equal on lab and
-- Render after each phase; lab never has a column Render lacks).
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'person_events'
 ORDER BY column_name;

SELECT conname, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'public.person_events'::regclass
   AND contype IN ('p', 'u', 'c')
 ORDER BY conname;

SELECT i.relname AS index_name, x.indisprimary, x.indisunique,
       pg_get_indexdef(x.indexrelid) AS def
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
 WHERE x.indrelid = 'public.person_events'::regclass
 ORDER BY i.relname;

-- 'd' = DEFAULT (primary key), 'f' = FULL.
SELECT relreplident FROM pg_class WHERE oid = 'public.person_events'::regclass;

-- Both sides: counts and md5 (must match lab = Render). Before phase A the
-- seq column does not exist: use the variant without seq.
SELECT count(*) AS n,
       count(*) FILTER (WHERE seq > 0) AS seq_gt_0
  FROM person_events;

SELECT md5(string_agg(row_text, '' ORDER BY person_id, kind, seq))
  FROM (
    SELECT person_id, kind, seq,
           person_id || '|' || kind || '|' || seq::text
           || '|' || coalesce(event_date::text, '') AS row_text
      FROM person_events
  ) s;

-- Before phase A (no seq column):
SELECT md5(string_agg(row_text, '' ORDER BY person_id, kind))
  FROM (
    SELECT person_id, kind,
           person_id || '|' || kind || '|' || coalesce(event_date::text, '') AS row_text
      FROM person_events
  ) s;

-- Both sides, before r4 / r5: must return 0 rows.
SELECT person_id, kind, count(*) AS n
  FROM person_events
 GROUP BY person_id, kind
HAVING count(*) > 1;

-- On lab, before r2 (publication precheck). Record both results.
-- Required: puballtables = false, and the second query returns no rows
-- (neither _bak table is in any publication). If puballtables is true,
-- STOP: do not run r2; go back to Worf. No ALTER PUBLICATION.
SELECT pubname, puballtables
  FROM pg_publication
 WHERE pubname = 'exittrace_lab_pub';

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE tablename IN ('person_events_multi_notable_bak',
                     'people_events_multi_notable_bak');

-- On lab, after r2: the _bak copy (rows and people).
SELECT count(*) FROM person_events_multi_notable_bak;
SELECT count(*) FROM people_events_multi_notable_bak;
