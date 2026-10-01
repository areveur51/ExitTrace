-- Admiral CLEAR 2026-10-01 ~6:37pm ET: one-shot DELETE of three orphan ronald_comms
-- peer rows on Render (public). Nested supporting stays on Elon primary.
-- Does NOT DROP subscription. No TRUNCATE. Exact three ids only.

BEGIN;

-- Prove orphans exist
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM ronald_comms
   WHERE id IN (
     'realbobbylevy-2026-06-22-1af21e01',
     'areveur51-2026-06-22-8912550d',
     'theripcord-2026-06-22-b3df19e2'
   );
  IF n <> 3 THEN
    RAISE EXCEPTION 'orphan_before expected 3 got %', n;
  END IF;
END $$;

-- Prove Elon primary present (do not touch snapshot)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ronald_comms WHERE id = 'elonmusk-2024-11-05-9a09001d'
  ) THEN
    RAISE EXCEPTION 'missing primary elonmusk-2024-11-05-9a09001d';
  END IF;
END $$;

DELETE FROM ronald_comms
 WHERE id IN (
   'realbobbylevy-2026-06-22-1af21e01',
   'areveur51-2026-06-22-8912550d',
   'theripcord-2026-06-22-b3df19e2'
 );

-- Prove orphans gone
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM ronald_comms
   WHERE id IN (
     'realbobbylevy-2026-06-22-1af21e01',
     'areveur51-2026-06-22-8912550d',
     'theripcord-2026-06-22-b3df19e2'
   );
  IF n <> 0 THEN
    RAISE EXCEPTION 'orphan_after expected 0 got %', n;
  END IF;
END $$;

-- Prove keepers remain (lab has these four; Render may have had 7)
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM ronald_comms
   WHERE id IN (
     'elonmusk-2024-11-05-9a09001d',
     'livedoornews-2026-10-01-3c3d49a8',
     'mcdonalds-2026-05-18-bfd72a0a',
     'mcdonaldsjapan-2026-10-01-5be45827'
   );
  IF n <> 4 THEN
    RAISE EXCEPTION 'keepers expected 4 got %', n;
  END IF;
END $$;

COMMIT;
