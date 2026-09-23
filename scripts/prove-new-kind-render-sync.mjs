#!/usr/bin/env node
/**
 * Print the new-kind place order. Does not connect and does not mutate.
 * Live ALTER / REFRESH stay operator steps. No URLs in this file.
 */
export const PLACE_STEPS = `
ExitTrace streaming = lab to Render logical replication
  publication exittrace_lab_pub -> subscription exittrace_lab_sub
  SYNC_MODE=logical
Media is the separate media-delta path. The HTTPS peer path is not this path.
No dual-write. Never copy_data=true. Do not touch the parked database.
Do not wipe media or datasets. Gap-upsert never DELETE / TRUNCATE / DROP / --clean.

1. Bootstrap both sides (scripts/bootstrap-db.sql) before ADD TABLE.
2. Lab publisher:
   psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-red-folder-comms-publication.sql
   psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-central-casting-comms-publication.sql
   psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-request-attributions-publication.sql
3. Render subscriber. REFRESH does not copy rows already stored:
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);"
4. Export from lab, then gap-upsert onto Render (second process DATABASE_URL is Render):
   DATABASE_URL="$LAB_DATABASE_URL" node scripts/export-published-tables.mjs --out published.json
   DATABASE_URL="$RENDER_TARGET" node scripts/gap-upsert-published.mjs --from published.json
5. Prove publication membership, subscription relation, LSN advance, row counts, and media-delta.
   people.central_casting rides the people upsert (json array, empty default, never invented).
   red_folder_comms and central_casting_comms (plus person_id) are in the gap-upsert table list.
   request_attributions is in the gap-upsert table list. Conflict is id.
   Partial unique is (channel, subject_status_id) WHERE subject_status_id IS NOT NULL.
   Empty backfill is OK. Media-delta does not apply to request_attributions.
   REFRESH copy_data=false does not copy attribution rows already stored.
   Prove publication membership, subscription relation, and non-decreasing counts.
mention_queue is Render-only and is excluded from exittrace_lab_pub / publication SQL / NEW_KIND_RENDER_SYNC checklist. Do not gap-upsert mention_queue.
`.trim();

const invoked = process.argv[1] && process.argv[1].endsWith("prove-new-kind-render-sync.mjs");
if (invoked) {
  console.log(PLACE_STEPS);
}
