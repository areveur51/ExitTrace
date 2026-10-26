-- Multi-event UP, step F5 (RENDER, the subscriber): PRIMARY KEY swap to
-- (person_id, kind, seq), promoting the phase A unique index (no new index build).
--
-- Runs on Render ONLY, after F3 (2026-10-26-multi-event-up-lab.sql on lab) and the
-- F4 catch-up with apply_error_count flat. Before F3 it would break apply: lab
-- would still send the key (person_id, kind) and every UPDATE / DELETE would fail
-- with "publisher did not send replica identity column expected by the logical
-- replication target relation". Order: docs/MIGRATION.md.
--
-- Refuses unless F2 ran (seq INTEGER NOT NULL and the valid phase A unique index).
-- One transaction. Rows are not changed. Idempotent.
--
-- STOPs with nothing changed when: REPLICA IDENTITY is not DEFAULT ('d'; for
-- example FULL left over from a rollback's r1), the primary key is neither
-- (person_id, kind) nor (person_id, kind, seq), or a relation named
-- person_events_person_kind_seq_key is not a valid unique index on
-- public.person_events (person_id, kind, seq). Every catalog check is
-- schema-qualified (public).
-- No seq CHECK is added: the CHECK set stays identical on lab and Render.
-- Undo: 2026-10-26-multi-event-down-render-b.sql.

BEGIN;
-- Fail fast instead of queueing behind (and in front of) the apply worker or the app.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  ri "char" := (SELECT relreplident FROM pg_class WHERE oid = 'public.person_events'::regclass);
  pk text[] := (SELECT array_agg(a.attname::text ORDER BY k.ord)
       FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = 'public.person_events'::regclass AND c.contype = 'p');
BEGIN
  IF ri IS DISTINCT FROM 'd' THEN
    RAISE EXCEPTION 'multi-event render-b: public.person_events REPLICA IDENTITY is % (expected d, DEFAULT); STOP, nothing changed', ri;
  END IF;
  IF pk IS DISTINCT FROM ARRAY['person_id', 'kind'] AND pk IS DISTINCT FROM ARRAY['person_id', 'kind', 'seq'] THEN
    RAISE EXCEPTION 'multi-event render-b: unexpected primary key % on public.person_events; STOP', pk;
  END IF;
  IF EXISTS (
      SELECT 1 FROM pg_class i JOIN pg_namespace n ON n.oid = i.relnamespace
       WHERE n.nspname = 'public' AND i.relname = 'person_events_person_kind_seq_key') AND NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON n.oid = i.relnamespace
       WHERE n.nspname = 'public'
         AND i.relname = 'person_events_person_kind_seq_key'
         AND x.indrelid = 'public.person_events'::regclass
         AND x.indisunique AND x.indisvalid AND x.indisready
         AND x.indpred IS NULL AND x.indexprs IS NULL
         AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum)
             = ARRAY['person_id', 'kind', 'seq']) THEN
    RAISE EXCEPTION 'multi-event render-b: person_events_person_kind_seq_key is not a valid unique index on public.person_events (person_id, kind, seq); STOP';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.person_events'::regclass AND attname = 'seq' AND NOT attisdropped
         AND atttypid = 'integer'::regtype AND attnotnull) THEN
    RAISE EXCEPTION 'multi-event render-b needs render-a first (seq INTEGER NOT NULL)';
  END IF;
  IF pk = ARRAY['person_id', 'kind'] AND NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON n.oid = i.relnamespace
       WHERE n.nspname = 'public'
         AND i.relname = 'person_events_person_kind_seq_key'
         AND x.indrelid = 'public.person_events'::regclass
         AND x.indisunique AND x.indisvalid AND x.indisready
         AND x.indpred IS NULL AND x.indexprs IS NULL
         AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum)
             = ARRAY['person_id', 'kind', 'seq']) THEN
    RAISE EXCEPTION 'multi-event render-b needs render-a first (the valid unique index person_events_person_kind_seq_key)';
  END IF;
END $$;

-- Swap (person_id, kind) for (person_id, kind, seq) by promoting the phase A
-- unique index (no new index build). A re-run finds the 3-column key and skips.
DO $$
DECLARE
  pk text[] := (SELECT array_agg(a.attname::text ORDER BY k.ord)
       FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = 'public.person_events'::regclass AND c.contype = 'p');
BEGIN
  IF pk = ARRAY['person_id', 'kind'] THEN
    ALTER TABLE public.person_events DROP CONSTRAINT person_events_pkey;
    ALTER TABLE public.person_events
      ADD CONSTRAINT person_events_pkey
      PRIMARY KEY USING INDEX person_events_person_kind_seq_key;
  END IF;
  IF (SELECT array_agg(a.attname::text ORDER BY k.ord)
       FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = 'public.person_events'::regclass AND c.contype = 'p') IS DISTINCT FROM ARRAY['person_id', 'kind', 'seq'] THEN
    RAISE EXCEPTION 'multi-event render-b: primary key is not (person_id, kind, seq) after the swap; STOP';
  END IF;
END $$;

-- Any kind may have seq > 0 now; the app decides which kinds repeat. F0 STOPs
-- unless lab and Render have the same CHECK set, so this is the same on both.
ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;

-- The primary key is the replica identity on both sides. It was 'd' above, so
-- this only restates DEFAULT (the identity index is now the 3-column key).
ALTER TABLE public.person_events REPLICA IDENTITY DEFAULT;

COMMIT;
