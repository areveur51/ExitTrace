-- Path-only heal: dog_comms.posted_at DATE → TEXT so lab ISO clocks can apply.
-- Idempotent: no-op if already TEXT. No truncate. No media wipe. leftover untouched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'dog_comms'
       AND column_name = 'posted_at' AND data_type = 'date'
  ) THEN
    ALTER TABLE dog_comms
      ALTER COLUMN posted_at TYPE TEXT
      USING to_char(posted_at, 'YYYY-MM-DD');
    RAISE NOTICE 'healed: dog_comms.posted_at date→text';
  ELSE
    RAISE NOTICE 'skip: dog_comms.posted_at already not date';
  END IF;
END $$;

UPDATE dog_comms
   SET posted_at = snapshot->>'posted_at'
 WHERE snapshot ? 'posted_at'
   AND (snapshot->>'posted_at') ~ '[Tt ][0-9]{2}:'
   AND posted_at !~ '[Tt ][0-9]{2}:';

SELECT 'dog_comms.posted_at=' || data_type AS col_type
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='dog_comms' AND column_name='posted_at';
