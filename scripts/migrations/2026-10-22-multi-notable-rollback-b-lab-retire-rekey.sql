-- Multi-notable rollback step b (lab).
-- Phase B rollout: run on lab first, then Render.
-- Publisher = lab (publication exittrace_lab_pub). Subscriber = Render
-- (subscription exittrace_lab_sub, slot exittrace_lab_sub on lab).
-- Lab keeps sending seq as a key column until Render is back on
-- (person_id, kind). At every moment Render's PK columns are a subset of
-- the key columns lab sends.
--
-- Rollback order (fixed):
--   a. Render: drop CHECK person_events_seq_notable_only.
--      2026-10-22-multi-notable-rollback-a-render-drop-check.sql
--   b. Lab: copy extra notables to the lab-local retired tables, drop the
--      CHECK, re-key, and keep PRIMARY KEY (person_id, kind, seq).
--      One transaction.
--      2026-10-22-multi-notable-rollback-b-lab-retire-rekey.sql
--   c. Wait for LSN catch-up (Render applied the re-key). Read-only.
--      docs/MULTI_NOTABLE_MIGRATION.md and
--      2026-10-22-multi-notable-replication-checks.sql
--   d. Render: restore PRIMARY KEY (person_id, kind). Keep seq and unique
--      index person_events_person_kind_seq_key. REPLICA IDENTITY DEFAULT.
--      Guard aborts if kind = 'notable' AND seq > 0 still exists.
--      2026-10-22-multi-notable-rollback-d-render-restore-pk.sql
--   e. Lab: restore PRIMARY KEY (person_id, kind). Same shape and same guard.
--      2026-10-22-multi-notable-rollback-e-lab-restore-pk.sql
--
-- Write freeze is REQUIRED (not optional): pause lab person_events writes
-- from before lab phase B until after Render phase B, and from before
-- rollback step b until after step e. Confirm LSN catch-up before
-- unfreezing. The app guard only sees the local DB, so it cannot stop a
-- seq > 0 notable on lab while Render is on a different key.
-- Before step b, run the publication precheck in
-- 2026-10-22-multi-notable-replication-checks.sql: puballtables must be
-- false and neither retired table listed. If puballtables is true, STOP and
-- go back to Worf. No ALTER PUBLICATION.
--
-- This step runs on lab (publisher exittrace_lab_pub).
-- Do not ALTER PUBLICATION.
-- Requires step a on Render first, so the replicated re-key can land.
-- One transaction: copies, CHECK drop, re-key. Keeps PRIMARY KEY
-- (person_id, kind, seq). Does not drop or replace person_events_pkey.
-- Idempotent via IF NOT EXISTS and ON CONFLICT DO NOTHING.
--
-- Retired tables are lab-local. Publication exittrace_lab_pub is a table list
-- (no FOR ALL TABLES in this repo), so they are not published.
-- people.events JSON snapshot in people_events_multi_notable_retired is the
-- source to restore extra notables after rollback.
-- The lab-local retired tables are the durable copy.
-- Do not edit affected people until restored.

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
-- old code ignores. seq values are kept. The primary key stays
-- (person_id, kind, seq) so lab still sends seq.

ALTER TABLE person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;

UPDATE person_events
   SET kind = 'notable_retired_' || seq
 WHERE kind = 'notable' AND seq > 0;

COMMIT;
