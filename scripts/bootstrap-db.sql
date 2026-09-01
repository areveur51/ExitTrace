-- ExitTrace schema. Safe to re-run.
-- Database name: exittrace (created by the operator; this file only creates tables).

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  event_date DATE NOT NULL,
  death_date DATE,
  birth_date DATE,
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

-- Unique person entry: identity on people, KEEP tags on person_events.
ALTER TABLE people ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Optional calendar birth date. No gold backfill; UI reads it when present.
ALTER TABLE people ADD COLUMN IF NOT EXISTS birth_date DATE;
-- Identity tags (civilian, non_civilian, celebrity, official, ceo). Multi-tag.
ALTER TABLE people ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS person_events (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  event_date DATE NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (person_id, kind)
);

-- Harvest / dashboard attrs live on the event. Empty stays empty.
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS announced_date DATE;
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS comments TEXT;

CREATE INDEX IF NOT EXISTS person_events_kind_idx ON person_events (kind);
CREATE INDEX IF NOT EXISTS person_events_event_date_idx ON person_events (event_date DESC);

UPDATE people
   SET events = jsonb_build_array(
     jsonb_build_object(
       'kind', category,
       'event_date', to_char(event_date, 'YYYY-MM-DD'),
       'sources', COALESCE(sources, '[]'::jsonb)
     )
   )
 WHERE COALESCE(jsonb_array_length(events), 0) = 0
   AND category IS NOT NULL
   AND event_date IS NOT NULL;

INSERT INTO person_events (person_id, kind, event_date, sources)
SELECT id, category, event_date, COALESCE(sources, '[]'::jsonb)
  FROM people
 WHERE category IS NOT NULL
   AND event_date IS NOT NULL
ON CONFLICT (person_id, kind) DO NOTHING;

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

-- Parked public posts (not identified people). Gold people stay in `people`.
CREATE TABLE IF NOT EXISTS source_posts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  quoted_url TEXT,
  card_url TEXT,
  text TEXT,
  poster_handle TEXT,
  poster_name TEXT,
  posted_at DATE,
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  gold_person_id TEXT,
  CHECK (
    category IN (
      'firings',
      'resignations',
      'government_stepdowns',
      'arrests',
      'death_unspecified'
    )
  )
);

CREATE INDEX IF NOT EXISTS source_posts_category_idx ON source_posts (category);
CREATE INDEX IF NOT EXISTS source_posts_posted_at_idx ON source_posts (posted_at DESC);
CREATE INDEX IF NOT EXISTS source_posts_gold_idx ON source_posts (gold_person_id);

CREATE TABLE IF NOT EXISTS et_meta (
  k TEXT PRIMARY KEY,
  v JSONB NOT NULL
);

-- Queued add requests. Cites are supplied at process time, not invent at submit.
CREATE TABLE IF NOT EXISTS add_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'dog')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  subject TEXT,
  category TEXT,
  event_date DATE,
  hint_url TEXT,
  handle TEXT,
  source_url TEXT,
  posted_at DATE,
  cite_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS add_requests_status_idx ON add_requests (status, created_at ASC);
