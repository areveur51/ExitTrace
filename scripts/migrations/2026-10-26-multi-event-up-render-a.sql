-- Multi-event UP, step F2 (RENDER, the subscriber): ADDITIVE ONLY. The primary
-- key stays (person_id, kind), so UPDATE / DELETE from lab (which still sends the
-- key (person_id, kind) until F3) keep applying.
--
-- Adds, only if missing: the seq column (INTEGER NOT NULL DEFAULT 0; a constant
-- default is a catalog-only change) and the phase A unique index
-- person_events_person_kind_seq_key, which public code (main 702c3642:
-- INSERT ... ON CONFLICT (person_id, kind, seq)) needs for its own writes. F0
-- expects Render to have both already (phase A), so on Render this file is
-- normally a no-op that proves the shape.
--
-- No CHECK is added or dropped: the CHECK set must stay identical on lab and
-- Render (F0 STOPs when it differs), and a seq CHECK could only be applied to both
-- inside the window as one change. The app writes only seq >= 0
-- (promote.mjs eventSeq).
--
-- Runs under the F1 write freeze, BEFORE 2026-10-26-multi-event-up-lab.sql (F3).
-- Logical replication does not carry DDL. Order: docs/MIGRATION.md.
--
-- One transaction. Rows are not changed. Idempotent. STOPs (nothing changed) on a
-- primary key other than (person_id, kind), or on a relation named
-- person_events_person_kind_seq_key that is not a valid unique index on
-- public.person_events (person_id, kind, seq).
-- Undo: 2026-10-26-multi-event-down-render-a.sql (checks only).

BEGIN;
-- Fail fast instead of queueing behind (and in front of) the apply worker or the app.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  pk text[] := (SELECT array_agg(a.attname::text ORDER BY k.ord)
       FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = 'public.person_events'::regclass AND c.contype = 'p');
BEGIN
  IF pk = ARRAY['person_id', 'kind', 'seq'] THEN
    RAISE EXCEPTION 'multi-event render-a: primary key already contains seq (F5 already ran); STOP';
  END IF;
  IF pk IS DISTINCT FROM ARRAY['person_id', 'kind'] THEN
    RAISE EXCEPTION 'multi-event render-a: unexpected primary key % on public.person_events; STOP', pk;
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
    RAISE EXCEPTION 'multi-event render-a: person_events_person_kind_seq_key is not a valid unique index on public.person_events (person_id, kind, seq); STOP';
  END IF;
END $$;

ALTER TABLE public.person_events ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
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
    CREATE UNIQUE INDEX person_events_person_kind_seq_key
      ON public.person_events (person_id, kind, seq);
  END IF;
END $$;

COMMIT;
