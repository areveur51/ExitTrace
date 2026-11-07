-- link_queue holds X and Truth Social post links pasted on /queue.
-- It is not a catalog table. It is not in exittrace_lab_pub, publication SQL,
-- gap-upsert, or the media-delta path. Catalog rows still replicate on their own.

CREATE TABLE IF NOT EXISTS link_queue (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'truth')),
  status_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'held')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS link_queue_platform_status_uidx
  ON link_queue (platform, status_id);

CREATE INDEX IF NOT EXISTS link_queue_status_created_idx
  ON link_queue (status, created_at ASC);
