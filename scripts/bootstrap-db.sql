-- ExitTrace schema. Safe to re-run.
-- Database name: exittrace (created by the operator; this file only creates tables).

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  event_date DATE NOT NULL,
  death_date DATE,
  photo TEXT,
  photo_credit TEXT,
  net_worth_usd BIGINT,
  net_worth_note TEXT,
  net_worth_source TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  CHECK (
    (category LIKE 'death_%' AND death_date IS NOT NULL)
    OR (category NOT LIKE 'death_%')
  )
);

CREATE INDEX IF NOT EXISTS people_category_idx ON people (category);
CREATE INDEX IF NOT EXISTS people_event_date_idx ON people (event_date DESC);

CREATE TABLE IF NOT EXISTS dog_comms (
  id TEXT PRIMARY KEY,
  posted_at DATE NOT NULL,
  handle TEXT NOT NULL,
  account_name TEXT,
  text TEXT NOT NULL,
  still TEXT,
  still_credit TEXT,
  source_url TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS dog_comms_posted_at_idx ON dog_comms (posted_at DESC);

CREATE TABLE IF NOT EXISTS et_meta (
  k TEXT PRIMARY KEY,
  v JSONB NOT NULL
);
