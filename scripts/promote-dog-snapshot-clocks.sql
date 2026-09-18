-- Promote snapshot ISO clocks into dog_comms.posted_at (TEXT).
-- Does not invent times: only copies snapshot.posted_at when it already has a clock.
-- Safe to re-run. Requires posted_at already TEXT (see bootstrap-db.sql).
UPDATE dog_comms
   SET posted_at = snapshot->>'posted_at'
 WHERE snapshot ? 'posted_at'
   AND (snapshot->>'posted_at') ~ '[Tt ][0-9]{2}:'
   AND posted_at !~ '[Tt ][0-9]{2}:';
