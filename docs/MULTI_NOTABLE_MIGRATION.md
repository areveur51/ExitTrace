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

`exittrace_lab_pub` is a table list (`ALTER PUBLICATION … ADD TABLE …`). There is no `FOR ALL TABLES` in this repo. The rollback `_bak` tables are lab-local and are not published. Do not `ALTER PUBLICATION`. Never `copy_data=true`. No `REFRESH PUBLICATION` (no new published table).

Gap-upsert (lab to Render) only copies rows lab already has. Lab has `seq > 0` rows only after lab phase B. That is why the required write freeze below matters: a second notable must not be written until both sides have phase B.

## Before every step

Record these read-only results before **every** step: phase A on each side, phase B on each side, and each rollback step (r0 to r7). Record them again **after** every step: `apply_error_count` must be flat and every `srsubstate` must be `r`. Always record the LSNs (lab `pg_current_wal_lsn()` and slot `confirmed_flush_lsn`; Render `received_lsn` and `latest_end_lsn`) and Render `apply_error_count` before every step, so a stall or a new apply error can be tied to the step that caused it. The same queries are in `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql` (`SELECT` only).

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

Stop rule: if Render logs show apply errors (for example `publisher did not send replica identity column`, a duplicate key, or `logical replication apply worker` exited), or `apply_error_count` rises, halt. Do not run the next step. Roll back in the r0–r7 order below.

### Before rollback step r2: publication precheck

Record on lab before r2 (also in `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql`, read-only):

```sql
SELECT pubname, puballtables
  FROM pg_publication
 WHERE pubname = 'exittrace_lab_pub';

SELECT pubname, schemaname, tablename
  FROM pg_publication_tables
 WHERE tablename IN ('person_events_multi_notable_bak',
                     'people_events_multi_notable_bak');
```

Required result: `puballtables` is `false`, and the second query returns no rows (neither `_bak` table is in any publication). If `puballtables` is `true`, STOP: do not run r2 and go back to Worf. Do not `ALTER PUBLICATION`. A `FOR ALL TABLES` publication would publish the `_bak` tables that r2 creates, and Render has no such tables. If a `_bak` table is listed (for example from an earlier partial run), also STOP and go back to Worf.

## Rollout

A merge to `main` auto-deploys Render (`docs/github-auto-deploy.md`: "Render Git auto-deploy on `main` is the deploy plane"). That doc does not describe lab auto-deploy from a merge. Apply phase A on Render and then lab **before** the PR is merged. The new code's `ON CONFLICT (person_id, kind, seq)` needs the `seq` column and unique index; a merge that auto-deploys Render would boot those writers against a database that still has only `(person_id, kind)`.

Hold the code merge/deploy until phase A is on both sides.

Phase A order stays Render first, then lab. Phase B order is lab first, then Render. Lab moves to `(person_id, kind, seq)` and sends `seq`. Render's old `(person_id, kind)` is a subset of that key, so `UPDATE`/`DELETE` still apply. Render-first would put `seq` on Render's primary key while lab was still sending only `(person_id, kind)`.

Run phase A off-ingest (outside the ingest window). The non-concurrent `CREATE UNIQUE INDEX` takes a `SHARE` lock and briefly blocks writes to `person_events`.

0. Proofs before: row counts of `person_events` on lab and Render, and a checksum on both, for example:

   ```sql
   SELECT count(*) FROM person_events;

   SELECT md5(string_agg(row_text, '' ORDER BY person_id COLLATE "C", kind COLLATE "C", seq))
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

## Replication invariant

At every step, forward and back:

1. Render's key columns (its primary key, which is its replica identity) are a subset of lab's replica identity columns, **or** lab is on `REPLICA IDENTITY FULL`; and
2. lab never has a column Render lacks.

| Step | Lab columns / PK / replica identity | Render columns / PK | (1) | (2) |
|---|---|---|---|---|
| start | no seq / (person_id, kind) / DEFAULT | no seq / (person_id, kind) | equal | equal |
| Render phase A | no seq / same / DEFAULT | + seq / (person_id, kind) | equal | Render has extra |
| Lab phase A | + seq / (person_id, kind) / DEFAULT | + seq / (person_id, kind) | equal | equal |
| Lab phase B | + seq / (person_id, kind, seq) / DEFAULT | + seq / (person_id, kind) | subset | equal |
| Render phase B | same | + seq / (person_id, kind, seq) | equal | equal |
| r1 | + seq / (person_id, kind, seq) / **FULL** | + seq / (person_id, kind, seq) | FULL | equal |
| r2, r3, r3a | same (seq > 0 rows deleted) | same (deletes applied; CHECK dropped) | FULL | equal |
| r4 | same / FULL | + seq / (person_id, kind) | FULL | equal |
| r5 | + seq / (person_id, kind) / FULL | same | FULL | equal |
| r6 | + seq / (person_id, kind) / DEFAULT | + seq / (person_id, kind) | equal | equal |
| r7a (optional) | no seq / (person_id, kind) / DEFAULT | + seq / (person_id, kind) | equal | Render has extra |
| r7b (optional) | no seq | no seq | equal | equal |

Render-first phase B, or a lab PK restore before Render's, would break (1): Render's key would hold a column lab does not send, and apply fails with `publisher did not send replica identity column expected by the logical replication target relation`. Dropping `seq` on Render before lab would break (2).

## Rollback

Documented in `scripts/migrations/2026-10-22-multi-notable-rollback.sql` (comments only; that file has no executable SQL). Not run as part of place. Run the step files in this order. Before **and after** every step, run `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql` (read-only, including `SELECT version();` on both sides): `apply_error_count` flat and every `srsubstate` = `r`, or STOP and do not run the next step.

**Write freeze (REQUIRED) across the rollback.** Pause lab writes to `person_events` from r0 until after r6 (and, if the code is reverted, until the reverted build is live). Confirm catch-up before unfreezing. The app guard only sees the local database, so it cannot stop a `seq > 0` notable on lab while Render is on a different key.

**r0. Freeze and record (lab + Render, read-only).** Freeze lab writes to `person_events`. Record lab `pg_current_wal_lsn()` and slot `confirmed_flush_lsn`, Render `received_lsn`, `latest_end_lsn`, `apply_error_count`, `srsubstate`, and counts and md5 on both sides.

**r1. Lab:** `scripts/migrations/2026-10-22-multi-notable-rollback-r1-lab-replica-identity-full.sql`

```sql
BEGIN;
ALTER TABLE public.person_events REPLICA IDENTITY FULL;
COMMIT;
```

Lab now sends the whole old row for `UPDATE`/`DELETE`, which covers any key Render has.

**r2. Lab:** publication precheck first (above). Then `scripts/migrations/2026-10-22-multi-notable-rollback-r2-lab-bak-delete.sql`, one transaction: a guard that lab is on `REPLICA IDENTITY FULL`; copy every `seq > 0` row into lab-local `person_events_multi_notable_bak` and the affected `people.events` into `people_events_multi_notable_bak`; a guard that every `seq > 0` row is in the `_bak` table; then

```sql
DELETE FROM public.person_events WHERE seq > 0;
```

No `TRUNCATE`, no `CASCADE`. Record lab `pg_current_wal_lsn()` right after commit (LSN_R2).

**r3. Catch-up (read-only).** Render `latest_end_lsn` and lab slot `confirmed_flush_lsn` are both at least LSN_R2. `count(*)`, `count(*) FILTER (WHERE seq > 0)` (= 0) and the md5 match between lab and Render.

**r3a. Render** (any time before r4): `scripts/migrations/2026-10-22-multi-notable-rollback-r3a-render-drop-check.sql`

```sql
BEGIN;
ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;
COMMIT;
```

**r4. Render:** `scripts/migrations/2026-10-22-multi-notable-rollback-r4-render-restore-pk.sql`, one transaction. Guards (`RAISE EXCEPTION` aborts): 0 rows with `seq > 0`, and 0 duplicate `(person_id, kind)`. Then:

```sql
ALTER TABLE public.person_events DROP CONSTRAINT person_events_pkey;            -- only if it includes seq
ALTER TABLE public.person_events ADD CONSTRAINT person_events_pkey PRIMARY KEY (person_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key
  ON public.person_events (person_id, kind, seq);
ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only;
```

Lab is still on `REPLICA IDENTITY FULL`, so Render's `(person_id, kind)` is covered.

**r5. Lab:** `scripts/migrations/2026-10-22-multi-notable-rollback-r5-lab-restore-pk.sql`, one transaction. Guard: lab is still `REPLICA IDENTITY FULL`. Same guards and the same DDL as r4 (drop the three-column PK, add `PRIMARY KEY (person_id, kind)`, keep the unique index, drop the CHECK). Lab stays on `REPLICA IDENTITY FULL`.

**r6. Lab:** `scripts/migrations/2026-10-22-multi-notable-rollback-r6-lab-replica-identity-default.sql`. Guard: lab's PK no longer includes `seq`. Then:

```sql
BEGIN;
ALTER TABLE public.person_events REPLICA IDENTITY DEFAULT;
COMMIT;
```

**r7 (optional). Drop `seq`, lab first, then Render.** Leaving `seq` in place is fine and is the default. Only after the code is reverted to a build that does not write `seq` (the merged code's `INSERT … seq … ON CONFLICT (person_id, kind, seq)` fails without the column). Each side guards that its PK has no `seq` and its replica identity is DEFAULT, then:

```sql
BEGIN;
ALTER TABLE public.person_events DROP COLUMN IF EXISTS seq;  -- also drops person_events_person_kind_seq_key
COMMIT;
```

r7a lab: `scripts/migrations/2026-10-22-multi-notable-rollback-r7a-lab-drop-seq.sql`. Record lab LSN and wait for Render catch-up. r7b Render: `scripts/migrations/2026-10-22-multi-notable-rollback-r7b-render-drop-seq.sql`.

### Which DB runs what

| Step | Lab (publisher) | Render (subscriber) |
|---|---|---|
| r0 | freeze; record (read-only) | record (read-only) |
| r1 | `REPLICA IDENTITY FULL` | — |
| r2 | copy to `_bak`, `DELETE … WHERE seq > 0` | (deletes replicate) |
| r3 | record LSN, counts, md5 | catch-up, counts, md5 |
| r3a | — | drop CHECK |
| r4 | — | PK `(person_id, kind)` + unique index |
| r5 | PK `(person_id, kind)` + unique index, drop CHECK | — |
| r6 | `REPLICA IDENTITY DEFAULT` | — |
| r7a / r7b (optional) | drop `seq` | then drop `seq` |

### After the rollback

The `_bak` tables on lab are the durable copy of the extra notables. `people.events` is not rewritten (it is a published table, and r2 only touches `person_events`), so affected people still carry the extra notables in JSON. With the merged code still deployed, saving such a person fails with `multi_notable_needs_phase_b` because lab's PK is `(person_id, kind)` again; with old code, `syncPersonEvents` and `uniqueEvents` fold the extra notables on the next save. Do not edit affected people until they are restored. After r6, `person_events` is back in the phase A shape (`seq` column plus the three-column unique index), so the merged code's `ON CONFLICT (person_id, kind, seq)` still has its arbiter and phase B can be re-run with `USING INDEX`.

### Old code and the phase A shape

Old main code does not name `seq`. Its `INSERT INTO person_events (person_id, kind, …) … ON CONFLICT (person_id, kind)` works with the extra `seq` column (default 0) and the unique index, because the primary key is `(person_id, kind)` again after r5/r6.

## Files

- `app/lib/promote.mjs` — `sameNotable`, `eventKey`, `notableEvents`, `uniqueEvents`
- `app/lib/store.mjs` — `syncPersonEvents` `ON CONFLICT (person_id, kind, seq)`; `personEventsKeyHasSeq`; `assertMultiNotableReady` (`multi_notable_needs_phase_b`); `insertPersonTx` / `savePersonTx` (one transaction); `maxEventHeadcountByKind`
- `app/lib/gap-upsert.mjs` — key `["person_id","kind","seq"]`, `seq` on `EVENT_COLS` (default 0)
- `scripts/migrations/2026-10-22-multi-notable-phase-a.sql`
- `scripts/migrations/2026-10-22-multi-notable-phase-b.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback.sql` (index; comments only)
- `scripts/migrations/2026-10-22-multi-notable-rollback-r1-lab-replica-identity-full.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-r2-lab-bak-delete.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-r3a-render-drop-check.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-r4-render-restore-pk.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-r5-lab-restore-pk.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-r6-lab-replica-identity-default.sql`
- `scripts/migrations/2026-10-22-multi-notable-rollback-r7a-lab-drop-seq.sql` (optional)
- `scripts/migrations/2026-10-22-multi-notable-rollback-r7b-render-drop-seq.sql` (optional)
- `scripts/migrations/2026-10-22-multi-notable-replication-checks.sql` (read-only; r0, r3, and before/after every step)
