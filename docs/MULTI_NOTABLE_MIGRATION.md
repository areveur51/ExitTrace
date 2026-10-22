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

Publisher = lab (publication `exittrace_lab_pub`). Subscriber = Render (subscription `exittrace_lab_sub`, slot `exittrace_lab_sub` on lab). DDL is not replicated. The subscriber must have every published column.

The subscriber's replica-identity columns (its primary key) must all be among the key columns the publisher sends for `UPDATE` and `DELETE`. If Render's primary key contains a column lab does not send as a key, `UPDATE`/`DELETE` apply fails with `publisher did not send replica identity column expected by the logical replication target relation`. The apply worker retries forever, and Render goes stale.

`exittrace_lab_pub` is a table list (`ALTER PUBLICATION … ADD TABLE …`). There is no `FOR ALL TABLES` in this repo. Retired rollback tables are lab-local and are not published. Do not `ALTER PUBLICATION`. Never `copy_data=true`. No `REFRESH PUBLICATION` (no new published table).

Gap-upsert (lab to Render) only copies rows lab already has. Lab has `seq > 0` rows only after lab phase B. That is why the required write freeze below matters: a second notable must not be written until both sides have phase B.

## Before every step

Record these read-only results before **every** step: phase A on each side, phase B on each side, and each rollback step (a, b, c, d, e). Always record the LSNs (lab `pg_current_wal_lsn()` and slot `confirmed_flush_lsn`; Render `received_lsn` and `latest_end_lsn`) and Render `apply_error_count` before every step, so a stall or a new apply error can be tied to the step that caused it. The same queries are in `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql` (`SELECT` only).

On Render (subscriber):

```sql
SELECT subname, pid, received_lsn, latest_end_lsn, latest_end_time, last_msg_receipt_time
  FROM pg_stat_subscription
 WHERE subname = 'exittrace_lab_sub';

SELECT subname, apply_error_count, sync_error_count
  FROM pg_stat_subscription_stats
 WHERE subname = 'exittrace_lab_sub';  -- PG15+
```

On lab (publisher):

```sql
SELECT pg_current_wal_lsn();

SELECT slot_name, active, confirmed_flush_lsn,
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
  FROM pg_replication_slots
 WHERE slot_name = 'exittrace_lab_sub';
```

Catch-up means the lab slot `confirmed_flush_lsn` and Render `latest_end_lsn` are both greater than or equal to the lab `pg_current_wal_lsn()` recorded right after the lab step committed.

Stop rule: if Render logs show apply errors (for example `publisher did not send replica identity column`, a duplicate key, or `logical replication apply worker` exited), or `apply_error_count` rises, halt. Do not run the next step. Roll back in the a–e order below.

### Before rollback step b: publication precheck

Record on lab before step b (also in `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql`, read-only):

```sql
SELECT pubname, puballtables
  FROM pg_publication
 WHERE pubname = 'exittrace_lab_pub';

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE tablename IN ('person_events_multi_notable_retired',
                     'people_events_multi_notable_retired');
```

Required result: `puballtables` is `false`, and the second query returns no rows (neither retired table is in any publication). If `puballtables` is `true`, STOP: do not run step b and go back to Worf. Do not `ALTER PUBLICATION`. A `FOR ALL TABLES` publication would publish the retired tables that step b creates, and Render has no such tables. If a retired table is listed (for example from an earlier partial run), also STOP and go back to Worf.

## Rollout

A merge to `main` auto-deploys Render (`docs/github-auto-deploy.md`: "Render Git auto-deploy on `main` is the deploy plane"). That doc does not describe lab auto-deploy from a merge. Apply phase A on Render and then lab **before** the PR is merged. The new code's `ON CONFLICT (person_id, kind, seq)` needs the `seq` column and unique index; a merge that auto-deploys Render would boot those writers against a database that still has only `(person_id, kind)`.

Hold the code merge/deploy until phase A is on both sides.

Phase A order stays Render first, then lab. Phase B order is lab first, then Render. Lab moves to `(person_id, kind, seq)` and sends `seq`. Render's old `(person_id, kind)` is a subset of that key, so `UPDATE`/`DELETE` still apply. Render-first would put `seq` on Render's primary key while lab was still sending only `(person_id, kind)`.

Run phase A off-ingest (outside the ingest window). The non-concurrent `CREATE UNIQUE INDEX` takes a `SHARE` lock and briefly blocks writes to `person_events`.

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
3. Confirm the subscriber applied past the lab DDL LSN (`pg_stat_subscription.latest_end_lsn` / `pg_replication_slots.confirmed_flush_lsn` for slot `exittrace_lab_sub` on the lab). Counts/checksums unchanged. Use the [Before every step](#before-every-step) queries.
4. **Deploy code.** It works with both the old primary key and the phase A unique index. `insertPerson` and `savePerson` write `people` and call `syncPersonEvents` on one client in one transaction (`BEGIN`, then `COMMIT`; any error runs `ROLLBACK` and rethrows). `assertMultiNotableReady` refuses a notable with `seq > 0` until **this** database's `person_events` primary key includes `seq`. The error is `PromoteError` with code `multi_notable_needs_phase_b` (`Second notable not saved: person_events primary key is still (person_id, kind). …`). There is no catalog query when the person has no `seq > 0` notable. The guard sees only the database it is connected to. Do **not** write a second notable yet.

### Write freeze (REQUIRED)

The write freeze is required, not optional. Pause ingest and app writes to `person_events` on lab from before lab phase B until after Render phase B. Confirm LSN catch-up before unfreezing.

Why it is required: the app guard (`assertMultiNotableReady`) only sees the local database. It cannot see whether Render has phase B yet.

Between lab phase B and Render phase B, a `seq > 0` notable written on lab replicates as an `INSERT` that conflicts with Render's old primary key `(person_id, kind)` and stalls apply. No second notable may be written until both sides have phase B. The code guard sees only its own database, so a lab that already has phase B will accept a second notable while Render is still on `(person_id, kind)`.

5. **Lab: phase B** (`scripts/migrations/2026-10-22-multi-notable-phase-b.sql`). Lab's primary key becomes `(person_id, kind, seq)` and lab sends `seq`. Render's primary key is still `(person_id, kind)`, a subset, so `UPDATE`/`DELETE` apply still matches.
6. **Render: phase B.** Render's primary key becomes `(person_id, kind, seq)`. Replica identity on lab is already that primary key. Because `seq` is a published column the subscriber can match it. Verify after Render phase B:

   ```sql
   SELECT relreplident FROM pg_class WHERE relname = 'person_events';  -- 'd'
   SELECT indisprimary FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'person_events' AND i.indisprimary;
   SELECT srrelid::regclass, srsubstate FROM pg_subscription_rel;
   ```

   `relreplident` is `d` (DEFAULT). `pg_subscription_rel` state is `r`. No apply errors in Render logs.

7. Only then add a second notable. Both sides must have phase B. Gap-upsert `ON CONFLICT (person_id, kind, seq)` requires phase A on Render first, and a `seq > 0` row exists on lab only after lab phase B.

`scripts/bootstrap-db.sql` is applied on every boot (lab and Render). It must not contain the PK swap. Fresh databases get `seq`, `PRIMARY KEY (person_id, kind, seq)`, and the CHECK from the `CREATE TABLE IF NOT EXISTS person_events` block only.

## Rollback

Documented in `scripts/migrations/2026-10-22-multi-notable-rollback.sql` (comments only; that file has no executable SQL). Not run as part of place. Run the step files in this order. Lab keeps sending `seq` as a key column until Render is back on `(person_id, kind)`. At every moment Render's primary-key columns are a subset of the key columns lab sends.

**Write freeze (REQUIRED) across the rollback.** Pause lab writes to `person_events` from before step b until after step e, and confirm catch-up before unfreezing. Why it is required: the app guard only sees the local database. Until step e, lab's key still has `seq`, so lab accepts a `seq > 0` notable. Between b and d that row has no CHECK on Render and lands outside the re-key. Between d and e its `INSERT` conflicts with Render's restored `(person_id, kind)` and stalls apply. The guards in d and e abort if such a row exists, but only the freeze prevents it.

a. **Render:** drop CHECK `person_events_seq_notable_only` (`scripts/migrations/2026-10-22-multi-notable-rollback-a-render-drop-check.sql`). Replicated re-key changes set `kind = notable_retired_N` with `seq > 0`. That value fails the CHECK, so the CHECK has to be gone first.

b. **Lab:** first run and record the [publication precheck](#before-rollback-step-b-publication-precheck): `puballtables` must be `false` and neither retired table listed. If `puballtables` is `true`, STOP and go back to Worf; no `ALTER PUBLICATION`. Then one transaction (`scripts/migrations/2026-10-22-multi-notable-rollback-b-lab-retire-rekey.sql`). Copy extra notables into the lab-local retired tables, drop the CHECK, then re-key with `UPDATE person_events SET kind = 'notable_retired_' || seq WHERE kind = 'notable' AND seq > 0`. Keep lab's `PRIMARY KEY (person_id, kind, seq)`.

c. **Wait for LSN catch-up.** Read-only. Render must apply the re-key changes before either side restores `(person_id, kind)`. Record `pg_current_wal_lsn()` on lab right after step b commits. Catch-up means slot `exittrace_lab_sub` `confirmed_flush_lsn` and Render `latest_end_lsn` are both at least that LSN. Queries are in [Before every step](#before-every-step) and `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql`.

d. **Render:** restore `PRIMARY KEY (person_id, kind)` (`scripts/migrations/2026-10-22-multi-notable-rollback-d-render-restore-pk.sql`). Keep the `seq` column and the unique index `person_events_person_kind_seq_key`. `REPLICA IDENTITY DEFAULT`. A `DO` block runs `RAISE EXCEPTION` and aborts the transaction if any row still has `kind = 'notable' AND seq > 0` (the re-key has not been applied yet). This step does not change rows.

e. **Lab:** restore `PRIMARY KEY (person_id, kind)` (`scripts/migrations/2026-10-22-multi-notable-rollback-e-lab-restore-pk.sql`). Same shape and the same guard. Keep the unique index. `REPLICA IDENTITY DEFAULT`. This step does not change rows. Run it only after step d, so Render is already on `(person_id, kind)` before lab stops sending `seq`.

`people.events` JSON snapshot in `people_events_multi_notable_retired` is the source to restore extra notables. Do not `ALTER PUBLICATION`.

After rollback, old code's `syncPersonEvents` does DELETE+reinsert from `people.events`, and old `uniqueEvents` folds extra notables, so the next save of an affected person removes its `notable_retired_N` rows from `person_events` and the folded JSON loses the extra notables. The lab-local retired tables are the durable copy. Do not edit affected people until restored.

### Old code and `notable_retired_N`

Verified against this tree: `isDisplayedEventKind` is `PROMOTE_CATEGORY_IDS` plus `death_unconfirmed` only (`app/lib/categories.mjs`). The person timeline (`isPersonTimelineKind` in `app/lib/html.mjs`) skips unknown kinds. Notable blocks render only `kind === "notable"`. Catalog lists, keymap chips, and `listPathForPerson` have no path for `notable` itself, let alone `notable_retired_1`. Dashboard ranks filter to `PROMOTE_CATEGORY_IDS`. `uniqueEvents` would keep an unknown dated kind as its own one-row kind; old main code does not put it on the timeline, Notable section, or nav. Supporting-media walk skips only known special kinds, so a retired row that still had `media` could appear as a generic supporting tile if `people.events` were rewritten to that kind. Rollback leaves `people.events` as-is (folded by old `uniqueEvents` on read) and re-keys only `person_events`.

### Unique index kept after rollback

After rollback, `person_events` keeps the unique index `person_events_person_kind_seq_key` alongside `PRIMARY KEY (person_id, kind)`. The index overlaps the primary key: it adds write cost and no extra uniqueness, because rows unique on `(person_id, kind)` are already unique on `(person_id, kind, seq)`. It is kept on purpose so a re-run of phase B can promote it with `USING INDEX`. Removing it is a separate reviewed change.

## Files

- `app/lib/promote.mjs` — `sameNotable`, `eventKey`, `notableEvents`, `uniqueEvents`
- `app/lib/store.mjs` — `syncPersonEvents` `ON CONFLICT (person_id, kind, seq)`; `personEventsKeyHasSeq`; `assertMultiNotableReady` (`multi_notable_needs_phase_b`); `insertPersonTx` / `savePersonTx` (one transaction); `maxEventHeadcountByKind`
- `app/lib/gap-upsert.mjs` — key `["person_id","kind","seq"]`, `seq` on `EVENT_COLS` (default 0)
- `scripts/migrations/2026-10-22-multi-notable-phase-a.sql`
- `scripts/migrations/2026-10-22-multi-notable-phase-b.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback.sql` (index; comments only)
- `scripts/migrations/2026-10-22-multi-notable-rollback-a-render-drop-check.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-b-lab-retire-rekey.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-d-render-restore-pk.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-e-lab-restore-pk.sql`
- `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql` (read-only; step c)
