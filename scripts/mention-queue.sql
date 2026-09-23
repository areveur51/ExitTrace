-- mention_queue is excluded from exittrace_lab_pub / publication SQL / NEW_KIND_RENDER_SYNC checklist.
-- Render app database only. The X mention bot POSTs here. The worker claims here.
-- Do not add this table to the lab publication. Do not gap-upsert it.
-- Do not export it from published tables. KEEP rows stay on the lab database
-- and reach Render through logical replication and media-delta.
-- This file does not wipe media and does not connect to a parked database.

CREATE TABLE IF NOT EXISTS mention_queue (
  subject_status_id TEXT PRIMARY KEY,
  mention_status_id TEXT NOT NULL,
  subject_url TEXT NOT NULL,
  mention_url TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_handle TEXT NOT NULL DEFAULT '',
  author_display_name TEXT DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  media_json JSONB,
  referenced_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'kept', 'fail_closed', 'rejected')),
  claim_owner TEXT,
  claim_until TIMESTAMPTZ,
  kept_person_slug TEXT,
  reply_soft_at TIMESTAMPTZ,
  reply_final_at TIMESTAMPTZ,
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing Render databases already have the table. Add the author name column.
ALTER TABLE mention_queue ADD COLUMN IF NOT EXISTS author_display_name TEXT DEFAULT '';
ALTER TABLE mention_queue ALTER COLUMN author_display_name DROP NOT NULL;
ALTER TABLE mention_queue ALTER COLUMN author_display_name SET DEFAULT '';

-- uniqueness on subject_status_id is the primary key above.
CREATE UNIQUE INDEX IF NOT EXISTS mention_queue_subject_status_id_uidx
  ON mention_queue (subject_status_id);

CREATE INDEX IF NOT EXISTS mention_queue_status_idx
  ON mention_queue (status, created_at ASC);

CREATE INDEX IF NOT EXISTS mention_queue_author_idx
  ON mention_queue (author_id, created_at DESC);

CREATE OR REPLACE FUNCTION mention_queue_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'mention_queue_set_updated_at'
  ) THEN
    CREATE TRIGGER mention_queue_set_updated_at
      BEFORE UPDATE ON mention_queue
      FOR EACH ROW
      EXECUTE FUNCTION mention_queue_set_updated_at();
  END IF;
END $$;
