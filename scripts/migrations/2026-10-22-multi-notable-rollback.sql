-- Multi-notable rollback (documented, not run).
-- Reverses phase B without data loss and without DELETE / TRUNCATE / DROP TABLE / DROP COLUMN.
-- Keeps the seq column and a unique index on (person_id, kind, seq).
--
-- After rollback, old code's syncPersonEvents does DELETE+reinsert from
-- people.events, and old uniqueEvents folds extra notables, so the next save
-- of an affected person removes its notable_retired_N rows from person_events
-- and the folded JSON loses the extra notables.
-- The lab-local retired tables are the durable copy.
-- Do not edit affected people until restored.
--
-- Run order (lab first for the re-key, wait for the subscriber to apply the
-- re-key UPDATEs, then Render for the PK restore):
--   1. Render: drop CHECK person_events_seq_notable_only only (replicated re-key
--      UPDATEs set kind = notable_retired_N with seq > 0; that fails the CHECK).
--      Use the commented RENDER-ONLY STEP 1 below; do not run this whole file
--      on Render first.
--   2. Lab: run this whole file. The executable body is one BEGIN/COMMIT
--      (copies, CHECK drop, re-key UPDATEs, PK restore, unique index,
--      REPLICA IDENTITY DEFAULT). Wait until the subscriber applied the
--      re-key UPDATEs (pg_stat_subscription latest_end_lsn / slot
--      exittrace_lab_sub confirmed_flush_lsn on lab).
--   3. Render: PK restore (RENDER-ONLY STEP 2 below). CHECK already gone;
--      re-key UPDATE is a no-op if replication already applied it; retired
--      copies stay lab-local.
--
-- Running this file on lab executes only the lab sequence. Render-only steps
-- are commented out so they are not part of the lab transaction.
--
-- Retired tables are lab-local. Publication exittrace_lab_pub is a table list
-- (no FOR ALL TABLES in this repo), so they are not published. Do not ALTER PUBLICATION.
-- people.events JSON snapshot in people_events_multi_notable_retired is the source
-- to restore extra notables after rollback.
--
-- Old main code ignores unknown kinds such as notable_retired_1: they are not in
-- PROMOTE_CATEGORY_IDS, isDisplayedEventKind, the person timeline, Notable blocks,
-- catalog lists, or the keymap. See docs/MULTI_NOTABLE_MIGRATION.md.

-- =============================================================================
-- LAB SEQUENCE (executable body)
-- Retired-table copies, CHECK drop, re-key UPDATE, PK restore, unique index,
-- REPLICA IDENTITY DEFAULT. One transaction so the re-key and PK restore are
-- atomic.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS person_events_multi_notable_retired (
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_date DATE,
  sources JSONB,
  announced_date DATE,
  position TEXT,
  organization TEXT,
  country TEXT,
  branch TEXT,
  comments TEXT,
  notable_group TEXT,
  title_note TEXT,
  status TEXT,
  age_at_event INTEGER,
  unsealed BOOLEAN,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, kind, seq)
);

CREATE TABLE IF NOT EXISTS people_events_multi_notable_retired (
  person_id TEXT NOT NULL PRIMARY KEY,
  events JSONB NOT NULL,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO person_events_multi_notable_retired (
  person_id, kind, seq, event_date, sources, announced_date,
  position, organization, country, branch, comments,
  notable_group, title_note, status, age_at_event, unsealed, retired_at
)
SELECT
  person_id, kind, seq, event_date, sources, announced_date,
  position, organization, country, branch, comments,
  notable_group, title_note, status, age_at_event, unsealed, now()
  FROM person_events
 WHERE kind = 'notable' AND seq > 0
ON CONFLICT DO NOTHING;

INSERT INTO people_events_multi_notable_retired (person_id, events, retired_at)
SELECT p.id, p.events, now()
  FROM people p
 WHERE EXISTS (
   SELECT 1 FROM person_events e
    WHERE e.person_id = p.id AND e.kind = 'notable' AND e.seq > 0
 )
ON CONFLICT DO NOTHING;

-- CHECK must drop before re-key: notable_retired_N with seq > 0 would violate
-- person_events_seq_notable_only. Data stays in the live table under a kind
-- old code ignores. seq values are kept.

ALTER TABLE person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;

UPDATE person_events
   SET kind = 'notable_retired_' || seq
 WHERE kind = 'notable' AND seq > 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.person_events'::regclass
       AND c.contype = 'p'
       AND EXISTS (
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
  ) THEN
    ALTER TABLE person_events
      ADD CONSTRAINT person_events_pkey PRIMARY KEY (person_id, kind);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key
  ON person_events (person_id, kind, seq);

ALTER TABLE person_events REPLICA IDENTITY DEFAULT;

COMMIT;

-- =============================================================================
-- RENDER-ONLY STEP 1 (before lab). Commented out: running this file on lab
-- must not execute it. On Render, drop CHECK first so replicated re-key
-- UPDATEs can set kind = notable_retired_N with seq > 0.
-- =============================================================================
-- ALTER TABLE person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;

-- =============================================================================
-- RENDER-ONLY STEP 2 (after lab re-key applied). Commented out: running this
-- file on lab must not execute it. CHECK already gone; re-key UPDATE is a
-- no-op if replication already applied it; retired copies stay lab-local.
-- =============================================================================
-- BEGIN;
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1
--       FROM pg_constraint c
--      WHERE c.conrelid = 'public.person_events'::regclass
--        AND c.contype = 'p'
--        AND EXISTS (
--          SELECT 1
--            FROM pg_attribute a
--           WHERE a.attrelid = c.conrelid
--             AND a.attnum = ANY (c.conkey)
--             AND a.attname = 'seq'
--        )
--   ) THEN
--     ALTER TABLE person_events DROP CONSTRAINT person_events_pkey;
--   END IF;
-- END $$;
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1
--       FROM pg_constraint
--      WHERE conrelid = 'public.person_events'::regclass
--        AND contype = 'p'
--   ) THEN
--     ALTER TABLE person_events
--       ADD CONSTRAINT person_events_pkey PRIMARY KEY (person_id, kind);
--   END IF;
-- END $$;
-- CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key
--   ON person_events (person_id, kind, seq);
-- ALTER TABLE person_events REPLICA IDENTITY DEFAULT;
-- COMMIT;
