-- Add epstein_flight_legs to the lab publication (NEW_KIND_RENDER_SYNC checklist B).
-- Table must already exist via scripts/bootstrap-db.sql.
-- Subscriber: ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);
-- Never omit WITH (copy_data = false). Never copy_data=true.
-- Existing rows are not copied by that refresh — backfill with gap-upsert.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'exittrace_lab_pub'
       AND schemaname = 'public'
       AND tablename = 'epstein_flight_legs'
  ) THEN
    ALTER PUBLICATION exittrace_lab_pub ADD TABLE epstein_flight_legs;
  END IF;
END $$;

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE pubname = 'exittrace_lab_pub'
   AND tablename = 'epstein_flight_legs';
