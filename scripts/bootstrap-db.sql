-- ExitTrace schema. Safe to re-run.
-- Database name: exittrace (created by the operator; this file only creates tables).

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  event_date DATE,
  death_date DATE,
  birth_date DATE,
  photo TEXT,
  photo_credit TEXT,
  screenshot TEXT,
  screenshot_credit TEXT,
  net_worth_usd BIGINT,
  net_worth_note TEXT,
  net_worth_source TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  CHECK (
    (
      category IN ('death_celebrity', 'death_official', 'death_ceo')
      AND death_date IS NOT NULL
    )
    OR (category = 'death_unconfirmed' AND death_date IS NULL)
    OR (
      category NOT IN (
        'death_celebrity',
        'death_official',
        'death_ceo',
        'death_unconfirmed'
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS people_category_idx ON people (category);
CREATE INDEX IF NOT EXISTS people_event_date_idx ON people (event_date DESC);

-- Unique person entry: identity on people, KEEP tags on person_events.
ALTER TABLE people ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Optional calendar birth date. No gold backfill; UI reads it when present.
ALTER TABLE people ADD COLUMN IF NOT EXISTS birth_date DATE;
-- Person-level origin. Not event.country. Empty stays empty until backfill.
ALTER TABLE people ADD COLUMN IF NOT EXISTS country_of_origin TEXT;
-- Identity tags (civilian, non_civilian, celebrity, official, ceo). Multi-tag.
ALTER TABLE people ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Person-level occupation / service years. Not event-tag attrs. Empty stays empty.
ALTER TABLE people ADD COLUMN IF NOT EXISTS career JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Optional local X-post screenshot. Empty stays empty. Does not replace photo.
ALTER TABLE people ADD COLUMN IF NOT EXISTS screenshot TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS screenshot_credit TEXT;

CREATE TABLE IF NOT EXISTS person_events (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  event_date DATE,
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
-- Whole years from people.birth_date + this tag's event_date. Null if either date is missing.
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS age_at_event INTEGER;
-- Indictment events only (indictment_civilian | indictment_non_civilian).
-- Nullable boolean. NULL until cites clearly state unsealed or made public.
-- Not a KEEP kind. Adding the column does not update people, operations,
-- dog rows, or existing event values. Leave existing rows null.
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS unsealed BOOLEAN;

CREATE INDEX IF NOT EXISTS person_events_kind_idx ON person_events (kind);
CREATE INDEX IF NOT EXISTS person_events_event_date_idx ON person_events (event_date DESC);

-- death_unconfirmed is not a confirmed death. death_date stays NULL.
-- event_date may be NULL on that kind only. Cause and location are not columns.
-- The asterisk is a UI label (Death* / Unconfirmed*), not a column.
-- Existing databases keep their rows; this only relaxes the confirmed-death checks.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'people'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%death_date%'
  LOOP
    EXECUTE format('ALTER TABLE people DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE people DROP CONSTRAINT IF EXISTS people_death_date_confirmed;
ALTER TABLE people ADD CONSTRAINT people_death_date_confirmed CHECK (
  (
    category IN ('death_celebrity', 'death_official', 'death_ceo')
    AND death_date IS NOT NULL
  )
  OR (category = 'death_unconfirmed' AND death_date IS NULL)
  OR (
    category NOT IN (
      'death_celebrity',
      'death_official',
      'death_ceo',
      'death_unconfirmed'
    )
  )
);

ALTER TABLE people ALTER COLUMN event_date DROP NOT NULL;
ALTER TABLE people DROP CONSTRAINT IF EXISTS people_event_date_required;
ALTER TABLE people ADD CONSTRAINT people_event_date_required CHECK (
  event_date IS NOT NULL OR category = 'death_unconfirmed'
);

ALTER TABLE person_events ALTER COLUMN event_date DROP NOT NULL;
ALTER TABLE person_events DROP CONSTRAINT IF EXISTS person_events_event_date_kind;
ALTER TABLE person_events ADD CONSTRAINT person_events_event_date_kind CHECK (
  event_date IS NOT NULL OR kind = 'death_unconfirmed'
);

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
  posted_at TEXT NOT NULL,
  handle TEXT NOT NULL,
  account_name TEXT,
  text TEXT NOT NULL,
  still TEXT,
  still_credit TEXT,
  screenshot TEXT,
  screenshot_credit TEXT,
  source_url TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS dog_comms_posted_at_idx ON dog_comms (posted_at DESC);

-- Keep X clocks for CITE: DATE truncated ISO to a day. TEXT holds YYYY-MM-DD or full ISO.
-- Existing DATE columns promote to TEXT without inventing a clock (date-only stays date-only).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'dog_comms'
       AND column_name = 'posted_at' AND data_type = 'date'
  ) THEN
    ALTER TABLE dog_comms
      ALTER COLUMN posted_at TYPE TEXT
      USING to_char(posted_at, 'YYYY-MM-DD');
  END IF;
END $$;

-- Prefer snapshot ISO clock into column when column is still date-only (no invented midnight).
UPDATE dog_comms
   SET posted_at = snapshot->>'posted_at'
 WHERE snapshot ? 'posted_at'
   AND (snapshot->>'posted_at') ~ '[Tt ][0-9]{2}:'
   AND posted_at !~ '[Tt ][0-9]{2}:';

-- Optional local X-post screenshot. Empty stays empty. Does not replace still.
ALTER TABLE dog_comms ADD COLUMN IF NOT EXISTS screenshot TEXT;
ALTER TABLE dog_comms ADD COLUMN IF NOT EXISTS screenshot_credit TEXT;

-- Red-folder comms: twin of dog_comms. Lab harvest rows stay annotate-only.
CREATE TABLE IF NOT EXISTS red_folder_comms (
  id TEXT PRIMARY KEY,
  posted_at TEXT NOT NULL,
  handle TEXT NOT NULL,
  account_name TEXT,
  text TEXT NOT NULL,
  still TEXT,
  still_credit TEXT,
  screenshot TEXT,
  screenshot_credit TEXT,
  source_url TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS red_folder_comms_posted_at_idx ON red_folder_comms (posted_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'red_folder_comms'
       AND column_name = 'posted_at' AND data_type = 'date'
  ) THEN
    ALTER TABLE red_folder_comms
      ALTER COLUMN posted_at TYPE TEXT
      USING to_char(posted_at, 'YYYY-MM-DD');
  END IF;
END $$;

ALTER TABLE red_folder_comms ADD COLUMN IF NOT EXISTS screenshot TEXT;
ALTER TABLE red_folder_comms ADD COLUMN IF NOT EXISTS screenshot_credit TEXT;

-- Central Casting comms: twin of dog_comms / red_folder_comms. Not a person KEEP tag.
-- Riker formal lock: sense NOT NULL, only looks_the_part | replacement. Both valid.
-- No seed rows here. Seed after PLACE is two separate rows, one sense each.
-- Cite gate (Admiral CLEAR): ongoing KEEP is official/gov/news-org plus quote-chain
-- standing. All post media belongs on the detail page; screenshot omit is fail-closed.
-- Definition seed may park on an Admiral-named cite only when the chain has no
-- official (death_unconfirmed-class, seed only).
CREATE TABLE IF NOT EXISTS central_casting_comms (
  id TEXT PRIMARY KEY,
  posted_at TEXT NOT NULL,
  handle TEXT NOT NULL,
  account_name TEXT,
  text TEXT NOT NULL,
  still TEXT,
  still_credit TEXT,
  screenshot TEXT,
  screenshot_credit TEXT,
  source_url TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  sense TEXT NOT NULL,
  CONSTRAINT central_casting_comms_sense_check CHECK (sense IN ('looks_the_part', 'replacement'))
);

CREATE INDEX IF NOT EXISTS central_casting_comms_posted_at_idx ON central_casting_comms (posted_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'central_casting_comms'
       AND column_name = 'posted_at' AND data_type = 'date'
  ) THEN
    ALTER TABLE central_casting_comms
      ALTER COLUMN posted_at TYPE TEXT
      USING to_char(posted_at, 'YYYY-MM-DD');
  END IF;
END $$;

ALTER TABLE central_casting_comms ADD COLUMN IF NOT EXISTS screenshot TEXT;
ALTER TABLE central_casting_comms ADD COLUMN IF NOT EXISTS screenshot_credit TEXT;

-- Idempotent sense column for a table created before the formal lock.
ALTER TABLE central_casting_comms ADD COLUMN IF NOT EXISTS sense TEXT;
ALTER TABLE central_casting_comms DROP CONSTRAINT IF EXISTS central_casting_comms_sense_check;
ALTER TABLE central_casting_comms ADD CONSTRAINT central_casting_comms_sense_check
  CHECK (sense IN ('looks_the_part', 'replacement'));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM central_casting_comms WHERE sense IS NULL) THEN
    RAISE EXCEPTION 'central_casting_comms.sense is NOT NULL; backfill looks_the_part or replacement before boot';
  END IF;
END $$;
ALTER TABLE central_casting_comms ALTER COLUMN sense SET NOT NULL;
CREATE INDEX IF NOT EXISTS central_casting_comms_sense_idx ON central_casting_comms (sense);

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
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  announced_date DATE,
  agencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  victim_count INTEGER,
  arrest_count INTEGER,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  screenshot TEXT
);

CREATE INDEX IF NOT EXISTS operations_event_date_idx ON operations (event_date DESC);
CREATE INDEX IF NOT EXISTS operations_tags_idx ON operations USING GIN (tags);

-- Optional local X-post screenshot. Empty stays empty. Operations have no still/credit pair.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS screenshot TEXT;

-- Distinct from unique-person KEEP. No child-name column.

CREATE TABLE IF NOT EXISTS add_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'dog', 'operation')),
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

ALTER TABLE add_requests DROP CONSTRAINT IF EXISTS add_requests_kind_check;
ALTER TABLE add_requests ADD CONSTRAINT add_requests_kind_check
  CHECK (kind IN ('person', 'dog', 'operation'));
