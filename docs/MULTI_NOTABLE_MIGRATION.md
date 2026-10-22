# Multiple dated notables per person

A person may carry more than one dated `notable` event. Every other kind stays one row per `(person_id, kind)` — one firing, not two.

## Design

`person_events` gains `seq INTEGER NOT NULL DEFAULT 0` and is keyed by `PRIMARY KEY (person_id, kind, seq)` with

```sql
CHECK (kind = 'notable' OR seq = 0)
```

so only `notable` may have `seq > 0`. Existing rows are `seq = 0` by the constant default (metadata-only `ADD COLUMN`, identical on lab and Render, no row rewrite, no `UPDATE`).

`seq` is stable identity. It is carried on `people.events[]` entries for notable as integer `seq`. Existing notables without `seq` are `seq 0`. A new notable that is a different event gets `max(existing notable seq)+1`. Non-notable events are always `seq 0` and do not grow a `seq` field in JSON.

Dedup (`sameNotable` in `app/lib/promote.mjs`): two notable entries are the same event (cites, attrs, media, and screenshot merge as today) when they share an explicit `seq`, or when the incoming row has no `seq` and they share `event_date` plus an overlapping cite URL, identical comments, or both lack a date. Different dates never fold unless `seq` matches.

## Why this key

- A `bigserial` / surrogate id would get different values on publisher and subscriber and would break gap-upsert `ON CONFLICT`.
- `event_date` is nullable and mutable, so it cannot be in a PK. Two notables may share a date.
- `seq` is a deterministic, replication-safe key that is identical on both sides. Non-notable kinds stay one row via the CHECK.

## Replication

Logical replication: lab publication `exittrace_lab_pub` → Render subscription `exittrace_lab_sub`. DDL is not replicated. The subscriber must have every published column. Subscriber replica identity columns must exist in the remote relation.

`exittrace_lab_pub` is a table list (`ALTER PUBLICATION … ADD TABLE …`). There is no `FOR ALL TABLES` in this repo. Retired rollback tables are lab-local and are not published. Do not `ALTER PUBLICATION`. Never `copy_data=true`. No `REFRESH PUBLICATION` (no new published table).

## Rollout

A merge to `main` auto-deploys Render (`docs/github-auto-deploy.md`: "Render Git auto-deploy on `main` is the deploy plane"). That doc does not describe lab auto-deploy from a merge. Apply phase A on Render and then lab **before** the PR is merged. The new code's `ON CONFLICT (person_id, kind, seq)` needs the `seq` column and unique index; a merge that auto-deploys Render would boot those writers against a database that still has only `(person_id, kind)`.

Hold the code merge/deploy until phase A is on both sides.

0. Proofs before: row counts of `person_events` on lab and Render, and a checksum on both, for example:

   ```sql
   SELECT count(*) FROM person_events;

   SELECT md5(string_agg(row_text, '' ORDER BY person_id, kind, seq))
     FROM (
       SELECT person_id || '|' || kind || '|' || coalesce(seq::text, '0')
              || '|' || coalesce(event_date::text, '') AS row_text
         FROM person_events
     ) s;
   ```

   Before phase A the `seq` term is omitted (column missing). Counts and checksums must match.

1. **Render: phase A** (`scripts/migrations/2026-10-22-multi-notable-phase-a.sql`). Subscriber gets the column first; an extra subscriber column is allowed.
2. **Lab: phase A.** Lab now sends `seq` (=0).
3. Confirm the subscriber applied past the lab DDL LSN (`pg_stat_subscription.latest_end_lsn` / `pg_replication_slots.confirmed_flush_lsn` for slot `exittrace_lab_sub` on the lab). Counts/checksums unchanged.
4. **Deploy code.** It works with both the old PK and the phase A unique index. Do **not** write a second notable yet.
5. **Render: phase B** (`scripts/migrations/2026-10-22-multi-notable-phase-b.sql`).
6. **Lab: phase B.** Replica identity becomes the new PK `(person_id, kind, seq)`. Because `seq` is a published column the subscriber can match it. Verify:

   ```sql
   SELECT relreplident FROM pg_class WHERE relname = 'person_events';  -- 'd'
   SELECT indisprimary FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'person_events' AND i.indisprimary;
   SELECT srrelid::regclass, srsubstate FROM pg_subscription_rel;
   ```

   `relreplident` is `d` (DEFAULT). `pg_subscription_rel` state is `r`. No apply errors in Render logs.

7. Only then add a second notable. Gap-upsert `ON CONFLICT (person_id, kind, seq)` requires phase A on Render first.

`scripts/bootstrap-db.sql` is applied on every boot (lab and Render). It must not contain the PK swap. Fresh databases get `seq`, `PRIMARY KEY (person_id, kind, seq)`, and the CHECK from the `CREATE TABLE IF NOT EXISTS person_events` block only.

## Rollback

Documented in `scripts/migrations/2026-10-22-multi-notable-rollback.sql`. Not run as part of place.

1. Render: drop CHECK `person_events_seq_notable_only` so replicated re-key UPDATEs can set `kind = notable_retired_N` with `seq > 0`.
2. Lab: run the rollback file (copy extra notables into lab-local retired tables, drop CHECK, re-key, restore `PRIMARY KEY (person_id, kind)`). Wait for the subscriber to apply the re-key UPDATEs.
3. Render: restore `PRIMARY KEY (person_id, kind)` (keep `seq` and the unique index on `(person_id, kind, seq)`).

`people.events` JSON snapshot in `people_events_multi_notable_retired` is the source to restore extra notables. Do not `ALTER PUBLICATION`.

After rollback, old code's `syncPersonEvents` does DELETE+reinsert from `people.events`, and old `uniqueEvents` folds extra notables, so the next save of an affected person removes its `notable_retired_N` rows from `person_events` and the folded JSON loses the extra notables. The lab-local retired tables are the durable copy. Do not edit affected people until restored.

### Old code and `notable_retired_N`

Verified against this tree: `isDisplayedEventKind` is `PROMOTE_CATEGORY_IDS` plus `death_unconfirmed` only (`app/lib/categories.mjs`). The person timeline (`isPersonTimelineKind` in `app/lib/html.mjs`) skips unknown kinds. Notable blocks render only `kind === "notable"`. Catalog lists, keymap chips, and `listPathForPerson` have no path for `notable` itself, let alone `notable_retired_1`. Dashboard ranks filter to `PROMOTE_CATEGORY_IDS`. `uniqueEvents` would keep an unknown dated kind as its own one-row kind; old main code does not put it on the timeline, Notable section, or nav. Supporting-media walk skips only known special kinds, so a retired row that still had `media` could appear as a generic supporting tile if `people.events` were rewritten to that kind. Rollback leaves `people.events` as-is (folded by old `uniqueEvents` on read) and re-keys only `person_events`.

## Files

- `app/lib/promote.mjs` — `sameNotable`, `eventKey`, `notableEvents`, `uniqueEvents`
- `app/lib/store.mjs` — `syncPersonEvents` `ON CONFLICT (person_id, kind, seq)`
- `app/lib/gap-upsert.mjs` — key `["person_id","kind","seq"]`, `seq` on `EVENT_COLS` (default 0)
- `scripts/migrations/2026-10-22-multi-notable-phase-a.sql`
- `scripts/migrations/2026-10-22-multi-notable-phase-b.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback.sql`
