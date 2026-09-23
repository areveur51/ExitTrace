-- Add request_attributions to the lab publication so later attribution inserts replicate.
-- Does not invent, delete, or rewrite rows. No seed rows in this script.
-- Not a cite table. mention_url on the row is meta only.
--
-- Lab publisher (table must already exist via scripts/bootstrap-db.sql):
--   psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-request-attributions-publication.sql
--
-- Subscriber (after the publisher ADD TABLE):
--   ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);
-- Never omit WITH (copy_data = false). Never copy_data=true.
-- That refresh does not copy rows already stored. Backfill with gap-upsert
-- (docs/NEW_KIND_RENDER_SYNC.md). No media on this table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'exittrace_lab_pub'
       AND schemaname = 'public'
       AND tablename = 'request_attributions'
  ) THEN
    ALTER PUBLICATION exittrace_lab_pub ADD TABLE request_attributions;
  END IF;
END $$;

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE pubname = 'exittrace_lab_pub'
   AND tablename = 'request_attributions';
