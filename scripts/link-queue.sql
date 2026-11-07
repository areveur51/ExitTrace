-- link_queue holds X and Truth Social post links pasted on /queue.
-- Lab and public each store a copy. The lab watcher reads the lab copy.
-- A lab syncer merges the two over HTTP. This table is not in
-- exittrace_lab_pub, publication SQL, gap-upsert, or the media-delta path.

CREATE TABLE IF NOT EXISTS link_queue (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'truth')),
  status_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'held', 'done')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS link_queue_platform_status_uidx
  ON link_queue (platform, status_id);

CREATE INDEX IF NOT EXISTS link_queue_status_created_idx
  ON link_queue (status, created_at ASC);

ALTER TABLE link_queue DROP CONSTRAINT IF EXISTS link_queue_status_check;
ALTER TABLE link_queue ADD CONSTRAINT link_queue_status_check
  CHECK (status IN ('pending', 'processing', 'held', 'done'));
