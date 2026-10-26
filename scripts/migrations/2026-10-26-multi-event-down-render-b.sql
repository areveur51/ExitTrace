-- Multi-event DOWN for RENDER step F5 (undoes 2026-10-26-multi-event-up-render-b.sql):
-- back to PRIMARY KEY (person_id, kind) and re-creates the unique index
-- person_events_person_kind_seq_key. Keeps the seq column and CHECK
-- person_events_seq_nonneg (render-a state).
--
-- Rollback order (docs/MIGRATION.md): freeze; r1 lab REPLICA IDENTITY FULL; r2 lab
-- backup + delete of seq > 0 rows (Admiral's words at that moment); r3 catch-up
-- (Render has applied the deletes); THIS FILE on Render; down-lab on lab; r6.
-- While lab is FULL it sends the whole old row, which covers either key.
--
-- One transaction. Does not change rows. Refuses while any seq > 0 row or
-- duplicate (person_id, kind) exists. Idempotent.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.person_events WHERE seq > 0) THEN
    RAISE EXCEPTION 'multi-event down-render-b guard: person_events still has seq > 0 rows (run r2 first)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.person_events GROUP BY person_id, kind HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multi-event down-render-b guard: duplicate (person_id, kind) rows';
  END IF;
END $$;

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
