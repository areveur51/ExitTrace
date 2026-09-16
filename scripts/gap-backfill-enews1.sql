-- et-gap-backfill-enews1: Admiral via Picard 2026-09-16 ~5:50pm ET
-- Targeted upsert only for 1 dog_comms row (enews) missing on Render.
-- Does NOT DROP/recreate subscription. No dump dual. No media wipe.
BEGIN;
WITH src AS (
  SELECT * FROM json_populate_recordset(NULL::dog_comms, $ej$[{"id": "enews-2026-09-16-a242c9e0", "posted_at": "2026-09-16", "handle": "@enews", "account_name": "E! News", "text": "Sally Field is taking it easy with some remarkably cute creatures the day after winning her fourth Emmy Award. 🐙", "still": "/media/dog-comms/enews-sally-field-2026.jpg", "still_credit": "E! News posted still", "source_url": "https://x.com/enews/status/2100011896808312926", "snapshot": {"text": "Sally Field is taking it easy with some remarkably cute creatures the day after winning her fourth Emmy Award. 🐙", "handle": "@enews", "posted_at": "2026-09-16"}}]$ej$::json)
)
INSERT INTO dog_comms AS t
SELECT * FROM src
ON CONFLICT (id) DO UPDATE SET
  posted_at = EXCLUDED.posted_at,
  handle = EXCLUDED.handle,
  account_name = EXCLUDED.account_name,
  text = EXCLUDED.text,
  still = EXCLUDED.still,
  still_credit = EXCLUDED.still_credit,
  source_url = EXCLUDED.source_url,
  snapshot = EXCLUDED.snapshot;

SELECT 'dog_comms=' || count(*) FROM dog_comms;
SELECT 'gap_present=' || count(*) FROM dog_comms WHERE id = 'enews-2026-09-16-a242c9e0';
COMMIT;
