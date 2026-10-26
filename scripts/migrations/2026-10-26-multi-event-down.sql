-- Multi-event DOWN: back to phase A, PRIMARY KEY (person_id, kind). Keeps the
-- seq column and the unique index person_events_person_kind_seq_key (phase A),
-- so the code that writes ON CONFLICT (person_id, kind, seq) still works.
--
-- One transaction. Does not change rows. It refuses while any seq > 0 row or
-- any duplicate (person_id, kind) exists: move those rows first with the
-- multi-notable r1/r2 steps (r2 copies EVERY seq > 0 row, of any kind, into
-- the lab-local person_events_multi_notable_bak, then deletes them).
--
-- Order (docs/MIGRATION.md, Rollback): freeze; r1 lab REPLICA
-- IDENTITY FULL; r2 lab bak + delete; r3 catch-up; THIS FILE on Render; THIS
-- FILE on lab; r6 lab REPLICA IDENTITY DEFAULT. On lab this file needs FULL
-- (r1) so the subscriber can still find rows while its key differs.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE schemaname = 'public' AND tablename = 'person_events'
  ) AND (SELECT relreplident FROM pg_class
          WHERE oid = 'public.person_events'::regclass) <> 'f' THEN
    RAISE EXCEPTION 'multi-event down on a publisher needs REPLICA IDENTITY FULL first (r1)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.person_events WHERE seq > 0) THEN
    RAISE EXCEPTION 'multi-event down guard: person_events still has seq > 0 rows (run r2 first)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.person_events GROUP BY person_id, kind HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multi-event down guard: duplicate (person_id, kind) rows';
  END IF;
END $$;

ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_nonneg;
ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.person_events'::regclass
       AND c.contype = 'p'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.conrelid
            AND a.attnum = ANY (c.conkey)
            AND a.attname = 'seq'
       )
  ) THEN
    ALTER TABLE public.person_events DROP CONSTRAINT person_events_pkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.person_events'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.person_events
      ADD CONSTRAINT person_events_pkey PRIMARY KEY (person_id, kind);
  END IF;
END $$;

-- PRIMARY KEY USING INDEX consumed the phase A index; put it back.
CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key
  ON public.person_events (person_id, kind, seq);

COMMIT;
