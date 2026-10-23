-- Multi-notable rollback step r2 (lab).
-- This step runs on lab (publisher). One transaction.
-- Requires r1 (REPLICA IDENTITY FULL) and the publication precheck in
-- replication-checks.sql (puballtables = false, no _bak table published).
-- Copies every seq > 0 row (only notables can have seq > 0) into the
-- lab-local person_events_multi_notable_bak, snapshots people.events for the
-- affected people into people_events_multi_notable_bak, checks the copy, and
-- only then DELETEs the seq > 0 rows. The DELETEs replicate to Render.
-- No TRUNCATE. No CASCADE. Idempotent: a re-run copies nothing new and
-- deletes nothing.
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
  IF (SELECT relreplident FROM pg_class
       WHERE oid = 'public.person_events'::regclass) <> 'f' THEN
    RAISE EXCEPTION 'r2 needs r1 first: person_events is not REPLICA IDENTITY FULL';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.person_events_multi_notable_bak AS
  SELECT pe.*, now() AS bak_at
    FROM public.person_events pe
   WHERE false;

CREATE TABLE IF NOT EXISTS public.people_events_multi_notable_bak (
  person_id TEXT NOT NULL PRIMARY KEY,
  events JSONB NOT NULL,
  bak_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.person_events_multi_notable_bak
SELECT pe.*, now()
  FROM public.person_events pe
 WHERE pe.seq > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.person_events_multi_notable_bak b
      WHERE b.person_id = pe.person_id AND b.kind = pe.kind AND b.seq = pe.seq
   );

INSERT INTO public.people_events_multi_notable_bak (person_id, events, bak_at)
SELECT p.id, p.events, now()
  FROM public.people p
 WHERE EXISTS (
   SELECT 1 FROM public.person_events e
    WHERE e.person_id = p.id AND e.seq > 0
 )
ON CONFLICT (person_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.person_events pe
     WHERE pe.seq > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.person_events_multi_notable_bak b
          WHERE b.person_id = pe.person_id AND b.kind = pe.kind AND b.seq = pe.seq
       )
  ) THEN
    RAISE EXCEPTION 'r2 copy check failed: a seq > 0 row is missing from person_events_multi_notable_bak';
  END IF;
END $$;

DELETE FROM public.person_events WHERE seq > 0;

COMMIT;
