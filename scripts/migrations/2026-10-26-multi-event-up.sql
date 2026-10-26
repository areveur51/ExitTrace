-- Multi-event UP: person_events PRIMARY KEY (person_id, kind, seq) and seq >= 0
-- for every kind (notable and red_folder repeat in the app; see
-- REPEATABLE_EVENT_KINDS in app/lib/promote.mjs). Supersedes running
-- 2026-10-22-multi-notable-phase-b.sql on its own: this file does phase B's PK
-- swap and then replaces its notable-only CHECK.
--
-- One transaction, so there is never a committed moment with no primary key
-- (no replica identity) on this published table. Rows are not changed: no
-- UPDATE / DELETE / TRUNCATE, no DROP TABLE / DROP COLUMN. Idempotent.
--
-- Requires phase A (seq column + unique index person_events_person_kind_seq_key).
-- Order and the write freeze: docs/MIGRATION.md. Lab (publisher)
-- first, LSN catch-up, then Render (subscriber). No seq > 0 row may be written
-- until BOTH sides have run this file.
-- Undo: 2026-10-26-multi-event-down.sql (after the r1/r2 steps it names).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.person_events'::regclass
       AND attname = 'seq' AND NOT attisdropped
  ) OR (
    NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'person_events_person_kind_seq_key' AND relkind = 'i'
    )
    -- A re-run finds the phase A index already promoted (renamed person_events_pkey).
    AND NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = 'public.person_events'::regclass
         AND c.contype = 'p'
         AND a.attname = 'seq'
    )
  ) THEN
    RAISE EXCEPTION 'multi-event up needs phase A first (seq column and person_events_person_kind_seq_key)';
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
