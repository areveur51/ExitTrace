-- Add central_casting_comms to the lab publication so later evidence inserts replicate.
-- Not the parent list. Parent /central-casting is unique-person KEEP cards.
-- Does not invent, delete, or rewrite rows. No seed rows in this script.
--
-- Cite gate (Riker DESIGN LOCK AMEND, Admiral CLEAR): ongoing KEEP is official/gov/news-org
-- plus quote-chain standing. Harvest attaches under the person. Membership is cite URLs.
--
-- Lab publisher (table must already exist via scripts/bootstrap-db.sql):
--   psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-central-casting-comms-publication.sql
--
-- Subscriber (after the publisher ADD TABLE):
--   ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);
-- Never omit WITH (copy_data = false). Never copy_data=true.
-- That refresh does not copy rows already stored. Backfill with gap-upsert
-- (docs/NEW_KIND_RENDER_SYNC.md). Media stills travel on the media-delta path.
-- Paths: media/central-casting-comms/ and media/screenshots/central-casting-comms/
-- including {id}/support/{n}/.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'exittrace_lab_pub'
       AND schemaname = 'public'
       AND tablename = 'central_casting_comms'
  ) THEN
    ALTER PUBLICATION exittrace_lab_pub ADD TABLE central_casting_comms;
  END IF;
END $$;

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE pubname = 'exittrace_lab_pub'
   AND tablename = 'central_casting_comms';
