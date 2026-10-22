-- Multi-notable phase A (additive, safe with old code).
-- Lab and Render: ADD COLUMN with a constant DEFAULT is metadata-only.
-- Existing rows become seq = 0 without a rewrite or UPDATE.
-- Old PRIMARY KEY (person_id, kind) stays. New code's
-- ON CONFLICT (person_id, kind, seq) is satisfied by the unique index.
--
-- Rollout: run on Render first, then lab. See docs/MULTI_NOTABLE_MIGRATION.md.
-- Idempotent. No UPDATE / DELETE / TRUNCATE / DROP TABLE / DROP COLUMN.

BEGIN;

ALTER TABLE person_events ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key
  ON person_events (person_id, kind, seq);

COMMIT;
