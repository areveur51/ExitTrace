-- Multi-event UP, step F3 (LAB, the publisher): person_events PRIMARY KEY
-- (person_id, kind, seq) and seq >= 0 for every kind (notable and red_folder
-- repeat in the app; REPEATABLE_EVENT_KINDS in app/lib/promote.mjs).
--
-- Runs on lab ONLY, after F2 (2026-10-26-multi-event-up-render-a.sql on Render)
-- and under the F1 write freeze. Then F4 catch-up, F5 Render
-- (2026-10-26-multi-event-up-render-b.sql). Order: docs/MIGRATION.md.
--
-- One transaction, so the published table never has a committed moment without
-- a primary key (replica identity). Rows are not changed: no UPDATE / DELETE /
-- TRUNCATE, no DROP TABLE / DROP COLUMN. Idempotent: the column and the phase A
-- unique index are added only if missing; a re-run is a no-op.
-- Undo: 2026-10-26-multi-event-down-lab.sql (after the r1/r2 steps it names).

BEGIN;

ALTER TABLE public.person_events ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0;

-- The phase A unique index becomes the primary key below. Skip when a re-run
-- finds it already promoted (renamed person_events_pkey, which contains seq).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'person_events_person_kind_seq_key' AND relkind = 'i'
  ) AND NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.person_events'::regclass
       AND c.contype = 'p'
       AND a.attname = 'seq'
  ) THEN
    CREATE UNIQUE INDEX person_events_person_kind_seq_key
      ON public.person_events (person_id, kind, seq);
  END IF;
END $$;

-- Drop a primary key that does not contain seq (the old (person_id, kind)).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.person_events'::regclass
       AND c.contype = 'p'
       AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.conrelid
            AND a.attnum = ANY (c.conkey)
            AND a.attname = 'seq'
       )
  ) THEN
    ALTER TABLE public.person_events DROP CONSTRAINT person_events_pkey;
  END IF;
END $$;

-- Promote the phase A unique index to the primary key (no new index build).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.person_events'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.person_events
      ADD CONSTRAINT person_events_pkey
      PRIMARY KEY USING INDEX person_events_person_kind_seq_key;
  END IF;
END $$;

-- Any kind may have seq > 0 now; the app decides which kinds repeat.
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

-- The primary key is the replica identity on both sides.
ALTER TABLE public.person_events REPLICA IDENTITY DEFAULT;

COMMIT;
