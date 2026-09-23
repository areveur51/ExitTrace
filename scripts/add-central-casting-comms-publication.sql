-- Add central_casting_comms to the lab publication so later inserts replicate.
-- Twin of red_folder_comms. Does not invent, delete, or rewrite rows.
-- No seed rows in this script (seed after MERGE+PLACE on lab).
-- sense is NOT NULL: looks_the_part | replacement. Both senses are valid.
--
-- Cite gate (Riker DESIGN LOCK, Admiral CLEAR): ongoing KEEP is official/gov/news-org
-- plus quote-chain standing. Definition seed may park on an Admiral-named cite only
-- when the chain has no official (death_unconfirmed-class, seed only).
--
-- Lab publisher (table must already exist via scripts/bootstrap-db.sql):
--   psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-central-casting-comms-publication.sql
--
-- Subscriber (after the publisher ADD TABLE), only if the relation is missing:
--   ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);
-- Never omit WITH (copy_data = false). Never copy_data=true.
-- Media stills travel on the existing media-delta rsync path, not this publication.
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
