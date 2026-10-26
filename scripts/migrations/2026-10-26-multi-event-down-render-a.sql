-- Multi-event DOWN for RENDER step F2 (2026-10-26-multi-event-up-render-a.sql).
-- Checks only: render-a adds nothing a rollback should take away. It KEEPS the seq
-- column and the unique index person_events_person_kind_seq_key: lab keeps seq
-- (phase A), so a subscriber without the column would fail every replicated
-- INSERT/UPDATE with "logical replication target relation ... is missing
-- replicated column", and public code writes ON CONFLICT (person_id, kind, seq).
-- render-a adds no CHECK, so there is none to drop.
--
-- Last step of the rollback (docs/MIGRATION.md), and optional: it proves Render is
-- back at the F0 shape. Refuses while the primary key contains seq (run
-- 2026-10-26-multi-event-down-render-b.sql first) or any seq <> 0 row exists.
-- One transaction. Rows are not changed. Idempotent.

BEGIN;
-- Fail fast instead of queueing behind (and in front of) the apply worker or the app.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF (SELECT array_agg(a.attname::text ORDER BY k.ord)
       FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = 'public.person_events'::regclass AND c.contype = 'p') IS DISTINCT FROM ARRAY['person_id', 'kind'] THEN
    RAISE EXCEPTION 'multi-event down-render-a: primary key still contains seq or is unexpected (run down-render-b first)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.person_events WHERE seq <> 0) THEN
    RAISE EXCEPTION 'multi-event down-render-a guard: person_events still has seq > 0 (or negative) rows (run r2 first)';
  END IF;
END $$;

COMMIT;
