-- Add red_folder_comms to the lab publication so later inserts replicate.
-- Does not invent, delete, or rewrite the existing lab harvest rows.
--
-- Lab publisher:
--   psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-red-folder-comms-publication.sql
--
-- Subscriber (after the publisher ADD TABLE):
--   ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);
-- Never omit WITH (copy_data = false). Never copy_data=true.
-- That refresh does not copy rows already stored. Backfill with gap-upsert
-- (docs/NEW_KIND_RENDER_SYNC.md). Media stills travel on the media-delta path.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'exittrace_lab_pub'
       AND schemaname = 'public'
       AND tablename = 'red_folder_comms'
  ) THEN
    ALTER PUBLICATION exittrace_lab_pub ADD TABLE red_folder_comms;
  END IF;
END $$;

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE pubname = 'exittrace_lab_pub'
   AND tablename = 'red_folder_comms';
