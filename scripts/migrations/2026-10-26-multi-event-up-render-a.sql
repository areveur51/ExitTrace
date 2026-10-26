-- Multi-event UP, step F2 (RENDER, the subscriber): ADDITIVE ONLY. The primary
-- key stays (person_id, kind), so UPDATE / DELETE from lab (which still sends the
-- key (person_id, kind) until F3) keep applying.
--
-- Adds, only if missing: the seq column (INTEGER NOT NULL DEFAULT 0; a constant
-- default is a catalog-only change), CHECK person_events_seq_nonneg (seq >= 0),
-- and the phase A unique index person_events_person_kind_seq_key, which public
-- code (main 702c3642: INSERT ... ON CONFLICT (person_id, kind, seq)) needs for
-- its own writes. Drops the phase B notable-only CHECK if a database has it.
--
-- Runs under the F1 write freeze, BEFORE 2026-10-26-multi-event-up-lab.sql (F3).
-- Logical replication does not carry DDL, so lab's seq column reaches Render
-- only through this file. Order: docs/MIGRATION.md.
--
-- One transaction. Rows are not changed. Idempotent. Refuses on a database whose
-- primary key already contains seq (that is F5's state; run nothing here).
-- Undo: 2026-10-26-multi-event-down-render-a.sql.

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
    RAISE EXCEPTION 'multi-event render-a: primary key already contains seq (F5 already ran); STOP';
  END IF;
END $$;

ALTER TABLE public.person_events ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.person_events'::regclass
       AND conname = 'person_events_seq_nonneg'
  ) THEN
    ALTER TABLE public.person_events
      ADD CONSTRAINT person_events_seq_nonneg CHECK (seq >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key
  ON public.person_events (person_id, kind, seq);

COMMIT;
