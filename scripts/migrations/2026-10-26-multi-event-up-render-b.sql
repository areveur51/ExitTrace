-- Multi-event UP, step F5 (RENDER, the subscriber): PRIMARY KEY swap to
-- (person_id, kind, seq), promoting the phase A unique index (no new index build).
--
-- Runs on Render ONLY, after F3 (2026-10-26-multi-event-up-lab.sql on lab) and the
-- F4 catch-up with apply_error_count flat. Before F3 it would break apply: lab
-- would still send the key (person_id, kind) and every UPDATE / DELETE would fail
-- with "publisher did not send replica identity column expected by the logical
-- replication target relation". Order: docs/MIGRATION.md.
--
-- Refuses unless F2 ran (seq column and CHECK person_events_seq_nonneg present).
-- One transaction. Rows are not changed. Idempotent.
-- Undo: 2026-10-26-multi-event-down-render-b.sql.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.person_events'::regclass
       AND attname = 'seq' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.person_events'::regclass
       AND conname = 'person_events_seq_nonneg'
  ) THEN
    RAISE EXCEPTION 'multi-event render-b needs render-a first (seq column and person_events_seq_nonneg)';
  END IF;
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
    RAISE EXCEPTION 'multi-event render-b needs the unique index person_events_person_kind_seq_key (render-a)';
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
