-- Multi-notable rollback step r6 (lab).
-- This step runs on lab (publisher). One transaction. Only after r4 and r5.
-- Guard: lab's primary key must already be (person_id, kind) with no seq,
-- so the DEFAULT identity lab sends equals Render's key.
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
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.person_events'::regclass
       AND c.contype = 'p'
       AND a.attname = 'seq'
  ) THEN
    RAISE EXCEPTION 'r6 needs r5 first: lab primary key still includes seq';
  END IF;
END $$;

ALTER TABLE public.person_events REPLICA IDENTITY DEFAULT;

COMMIT;
