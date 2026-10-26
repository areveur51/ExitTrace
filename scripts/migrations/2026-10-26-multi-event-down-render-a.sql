-- Multi-event DOWN for RENDER step F2 (undoes 2026-10-26-multi-event-up-render-a.sql
-- as far as is safe): drops CHECK person_events_seq_nonneg. It KEEPS the seq
-- column and the unique index person_events_person_kind_seq_key: lab keeps seq
-- (phase A), so a subscriber without the column would fail every replicated
-- INSERT/UPDATE with "logical replication target relation ... is missing
-- replicated column", and public code writes ON CONFLICT (person_id, kind, seq).
--
-- Last step of the rollback (docs/MIGRATION.md), and optional. Refuses while the
-- primary key contains seq (run 2026-10-26-multi-event-down-render-b.sql first) or
-- any seq > 0 row exists. One transaction. Rows are not changed. Idempotent.

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
    RAISE EXCEPTION 'multi-event down-render-a: primary key still contains seq (run down-render-b first)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.person_events WHERE seq > 0) THEN
    RAISE EXCEPTION 'multi-event down-render-a guard: person_events still has seq > 0 rows (run r2 first)';
  END IF;
END $$;

ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_nonneg;

COMMIT;
