# New-kind place (lab → Render logical)

ExitTrace streaming is logical replication from lab to Render: publication `exittrace_lab_pub` to subscription `exittrace_lab_sub`, with `SYNC_MODE=logical`. Media moves on the separate media-delta path. The HTTPS peer path is not this replication path.

Gap-upsert is the explicit backfill for rows that already exist. It is not a second writer beside an enabled dump cron.

## Existing-table kinds

A kind that already has its table is categories, store, HTML, and server only. Do not add a publication entry for a new label on `people`, `person_events`, `operations`, or `categories`.

## New table

A new table is all of the following, in order:

1. Bootstrap both sides from `scripts/bootstrap-db.sql` so the table exists before it is published.
2. Lab: `scripts/add-*-publication.sql` (`ALTER PUBLICATION exittrace_lab_pub ADD TABLE …` when the table is missing).
3. Render: `ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false)`.
4. Explicit backfill. After `ADD TABLE`, `REFRESH … WITH (copy_data = false)` does not copy rows already stored. Export from lab and gap-upsert onto Render.
5. Extend gap-upsert (`app/lib/gap-upsert.mjs` column lists, `scripts/export-published-tables.mjs`, `scripts/gap-upsert-published.mjs`, `COUNT_SQL`, proofs, tests) so the new table is in the export and the upsert.
6. Media on the media-delta path. Do not pack stills into the publication or the gap JSON.

## Prove

- Publication: `pg_publication_tables` lists the table on `exittrace_lab_pub`.
- Subscription: `pg_subscription_rel` has the relation on `exittrace_lab_sub`.
- LSN advances after a later insert.
- Counts: lab export row counts versus Render after gap-upsert (non-decreasing; `PROOF` lines from `scripts/gap-upsert-published.mjs`).
- Media: media-delta stills for the new paths, separate from the logical stream.

## Locks

- No dual-write. Do not run dump/restore while the subscription is the primary writer.
- Never `copy_data=true`. Never omit `WITH (copy_data = false)`.
- Gap-upsert is `INSERT … ON CONFLICT DO UPDATE` only. Never `DELETE` / `TRUNCATE` / `DROP` / `--clean`.
- Do not touch the parked database.
- Do not wipe media or datasets.

## This amend

`red_folder_comms` is a `dog_comms` twin (same columns, conflict on `id`).

`central_casting_comms` is that twin plus `person_id` (required; blank becomes SQL NULL and the insert fails closed). It is harvest under an existing person. It is not the parent list.

`people.central_casting` is a JSON array of cite URLs on the existing person row. Gap-upsert writes that array when the export has one. A missing value, a blank, or any non-array becomes `'[]'`. Cite URLs are not derived from objects or from `central_casting_comms`.

`person_events.unsealed` stays annotate-only: a stored `TRUE` is kept; an incoming value is written only when it is boolean `true`, otherwise NULL.

## Operator steps

Prints the same commands, and does not connect:

```bash
node scripts/prove-new-kind-render-sync.mjs
```

Lab publisher (table must already exist):

```bash
psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-red-folder-comms-publication.sql
psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-central-casting-comms-publication.sql
```

Render subscriber. This does not copy existing rows:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);"
```

Backfill. Point export at lab and upsert at Render. Do not print the URLs.

```bash
DATABASE_URL="$LAB_DATABASE_URL" node scripts/export-published-tables.mjs --out published.json
DATABASE_URL="$RENDER_TARGET" node scripts/gap-upsert-published.mjs --from published.json
```

`$RENDER_TARGET` is the Render `DATABASE_URL` for that second process only. The repo workflow `et-gap-upsert` uses the `production` secret `DATABASE_URL` for the upsert and does not store a URL in git.

Absent tables are skipped (`SKIP … reason=table_absent`). A missing relation does not delete anything else.
