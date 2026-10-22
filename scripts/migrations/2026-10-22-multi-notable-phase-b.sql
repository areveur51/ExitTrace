-- Multi-notable phase B (PK swap).
-- One transaction so there is never a committed moment with no replica identity
-- on this published table. Existing rows are seq = 0, so the CHECK is valid.
-- Does not UPDATE / DELETE / TRUNCATE any row. Does not DROP TABLE or DROP COLUMN.
--
-- Requires phase A (column + unique index person_events_person_kind_seq_key).
-- Rollout: run on lab first, then Render. See docs/MULTI_NOTABLE_MIGRATION.md.
-- Lab moves to PRIMARY KEY (person_id, kind, seq) and sends seq. Render's old
-- PRIMARY KEY (person_id, kind) is a subset, so UPDATE/DELETE still apply.
-- Render-first leaves seq on Render's key while lab does not send it, and
-- apply fails with "publisher did not send replica identity column".
-- Idempotent via pg_constraint / pg_index guards.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.person_events'::regclass
       AND conname = 'person_events_seq_notable_only'
  ) THEN
    ALTER TABLE person_events
      ADD CONSTRAINT person_events_seq_notable_only
      CHECK (kind = 'notable' OR seq = 0);
  END IF;
END $$;

-- Drop the old two-column primary key only. Default name is person_events_pkey.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.person_events'::regclass
       AND c.contype = 'p'
       AND NOT EXISTS (
         SELECT 1
           FROM pg_attribute a
          WHERE a.attrelid = c.conrelid
            AND a.attnum = ANY (c.conkey)
            AND a.attname = 'seq'
       )
  ) THEN
    ALTER TABLE person_events DROP CONSTRAINT person_events_pkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.person_events'::regclass
       AND contype = 'p'
  ) AND EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
     WHERE i.indrelid = 'public.person_events'::regclass
       AND idx.relname = 'person_events_person_kind_seq_key'
       AND i.indisunique
       AND NOT i.indisprimary
  ) THEN
    ALTER TABLE person_events
      ADD CONSTRAINT person_events_pkey
      PRIMARY KEY USING INDEX person_events_person_kind_seq_key;
  END IF;
END $$;

ALTER TABLE person_events REPLICA IDENTITY DEFAULT;

COMMIT;
