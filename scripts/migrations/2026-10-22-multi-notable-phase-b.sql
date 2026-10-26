-- SUPERSEDED (Worf r4 LOW-1, 2026-10-26). DO NOT RUN.
-- Replaced by the 2026-10-26-multi-event-* steps (docs/MIGRATION.md), which add
-- no CHECK. The old phase B body (it added person_events_seq_notable_only and
-- swapped the PK, which would leave lab's and Render's CHECK sets different)
-- is removed (Worf r5 LOW-3): it is in git history only, for example
--   git show abe4c21a:scripts/migrations/2026-10-22-multi-notable-phase-b.sql
-- and is described in docs/MULTI_NOTABLE_MIGRATION.md.
--
-- The whole executable body is this one refusing DO block, with no BEGIN,
-- COMMIT or DDL around it. So it changes nothing under any psql setting:
-- ON_ERROR_STOP off, ON_ERROR_ROLLBACK on (a per-statement savepoint only
-- rolls back this block; there is nothing after it to continue into), -1 or
-- a client that sends the file as one query.

DO $$
BEGIN
  RAISE EXCEPTION 'superseded: 2026-10-22-multi-notable-phase-b.sql must not run; use the 2026-10-26-multi-event-* steps (docs/MIGRATION.md)';
END $$;
