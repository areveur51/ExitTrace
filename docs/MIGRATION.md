# Multi-event person_events (several events of one kind per person)

Status: code and migrations are in this PR (draft). **No DDL has run on lab or Render.** The Admiral's 13:07 ET words approve the public DDL (F2/F5) and the freeze. Nothing here runs until the batch CLEAR and Worf's and O'Brien's gates pass on this PR. Worf's r2 ruling set the order below.

## What changes

- **Schema.** `person_events` gets PRIMARY KEY `(person_id, kind, seq)` on both sides (today it is `(person_id, kind)`). **No migration adds or changes a CHECK**, so lab and Render keep one CHECK set (today only `person_events_event_date_kind`). The app writes only `seq >= 0` (`eventSeq`). The database lets any kind repeat; the app decides which kinds do. A database that still has the old phase B CHECK `person_events_seq_notable_only` loses it at F3 / F5 (F0 STOPs unless both sides match).
- **Migrations.** Three steps, each in one transaction, idempotent, with no row changes. Each has its own down. All live in `scripts/migrations/`. Every file starts with `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '120s'` before any DDL, so a step that cannot get its lock (for example behind Render's apply worker) rolls back whole instead of queueing; check why, then re-run it. Every catalog check is schema-qualified (`public.person_events`; the phase A index is checked in `pg_index` as a valid, ready, unique `public` index on exactly `(person_id, kind, seq)`).

  | Step | Where | Up | Down |
  |---|---|---|---|
  | F2 | Render (subscriber) | `2026-10-26-multi-event-up-render-a.sql`: **additive only**. Adds the `seq` column (`INTEGER NOT NULL DEFAULT 0`) and the phase A unique index `person_events_person_kind_seq_key`, each only if missing. F0 expects Render to have both already, so on Render it is normally a no-op that proves the shape. **No CHECK, PK or identity change.** STOPs on a PK other than `(person_id, kind)` or on a look-alike index. | `…-down-render-a.sql`: checks only (PK back at `(person_id, kind)`, no `seq <> 0` rows). It keeps `seq` and the index, because lab keeps sending `seq` and public code needs the index. |
  | F3 | lab (publisher) | `…-up-lab.sql`: STOPs, with nothing changed, unless `relreplident` is `d`, the PK is `(person_id, kind)` or already `(person_id, kind, seq)`, and the index is the exact one. Then it adds the column and index only if missing, promotes the index to `PRIMARY KEY (person_id, kind, seq)`, re-checks the key, drops the notable-only CHECK if present, and restates `REPLICA IDENTITY DEFAULT`. | `…-down-lab.sql`: back to `(person_id, kind)` and re-creates the index. Refuses unless lab is `REPLICA IDENTITY FULL` (r1), and while any `seq <> 0` row or duplicate `(person_id, kind)` exists. |
  | F5 | Render | `…-up-render-b.sql`: the same guards and PK swap. Refuses unless F2's shape is there (`seq INTEGER NOT NULL` and the exact index). | `…-down-render-b.sql`: back to `(person_id, kind)` and re-creates the index. Keeps the column (the render-a state). Refuses while any `seq <> 0` row or duplicate exists. |

- **App.**
  - Repeatable kinds: `REPEATABLE_EVENT_KINDS = ["notable", "red_folder"]` (`app/lib/promote.mjs`). Every other kind stays one event per kind at `seq = 0`.
  - Writes and reads: `syncPersonEvents` writes one companion row per `(kind, seq)`. Merge matches on an explicit seq, or on the same date plus an overlapping cite or identical comments; anything else gets the next seq.
  - Headline: still the newest catalog event. `red_folder` never takes it.
  - Person pages: one block per Notable and per Red Folder event (`kindEventSection`). Each shows the sentence, office line, media with captions and the label "Red Folder".
  - API: `/api/people` returns `seq` on repeatable events.
- **Write switch `ET_MULTI_EVENT_WRITES`, off by default.** The write guard (`assertMultiNotableReady`) refuses any `seq > 0` event unless **both** of these hold:
  - the switch is exactly `on`: no trim and no case folding, so `" on "`, `"on\n"` and `"ON"` are off (otherwise it fails with `multi_event_writes_off`, before any catalog query);
  - this database's `public.person_events` has PRIMARY KEY exactly `(person_id, kind, seq)`, in that order (read with `to_regclass('public.person_events')`, never `search_path`; otherwise `multi_notable_needs_phase_b`), and no notable-only CHECK (otherwise `multi_event_needs_migration`).

  The guard only sees its own database. So the switch is the operator's statement that F5 is done on Render, and it is set on **lab only**, at F7, not before. **Render's `ET_MULTI_EVENT_WRITES` stays off** (unset) during and after the window: Render receives `seq > 0` rows through replication, and nothing on Render should write them. The memory store (no database) is not gated.
- **Fresh databases.** `scripts/bootstrap-db.sql` creates the table with PRIMARY KEY `(person_id, kind, seq)` and no seq CHECK, the migrated shape. Bootstrap only does `CREATE TABLE IF NOT EXISTS`, so it never changes an existing table's key or CHECKs.

## Replication: lab → Render (DDL is not replicated)

Lab publishes through `exittrace_lab_pub`, and Render subscribes as `exittrace_lab_sub`. Logical replication carries row changes, not DDL. **DDL is not replicated**, so each side runs its own file.

- **Lab already has `seq`** (phase A; read-only dump at 12:14 ET).
  - pgoutput sends every column of a published row. So every person_events INSERT, and every UPDATE new tuple, already carries `seq` today.
  - A subscriber without `seq` fails the first such change with `logical replication target relation "public.person_events" is missing replicated column: "seq"`, and apply retries forever.
  - That is why Render gets the column **first**, in an additive step that leaves its key alone (F2).
- **Replica identity is DEFAULT, so the identity is the PK.**
  - Until F3, DELETE messages and changed-key UPDATE messages carry the key `(person_id, kind)`. After F3 they carry `(person_id, kind, seq)`.
  - The subscriber finds rows by its own replica identity. Every subscriber key column must be among the columns the publisher sends.
- **Render's key must never be wider than lab's.**
  - If Render swaps to `(person_id, kind, seq)` while lab still sends `(person_id, kind)`, every UPDATE and DELETE fails with `publisher did not send replica identity column expected by the logical replication target relation "public.person_events"`.
  - INSERTs still apply. That is why F5 comes after F3 and its catch-up.
- **A `seq > 0` row before F5 stalls the subscription.**
  - On Render at `(person_id, kind)`, it fails as a duplicate key.
  - On a side that still has the notable-only CHECK, a `red_folder` row with `seq > 0` fails the CHECK.
  - Hence the switch, and F7 last.

### What F0 expects on both sides (Worf r3)

Lab, read at 13:44 ET on 2026-10-26 (read-only, catalog queries): `seq integer NOT NULL DEFAULT 0` (attnum 17, added by `ALTER … ADD COLUMN`), PRIMARY KEY `(person_id, kind)`, the unique index `person_events_person_kind_seq_key (person_id, kind, seq)`, `relreplident` `d`, CHECKs `person_events_event_date_kind` only, 0 rows with `seq <> 0`, `seq` in `exittrace_lab_pub`'s column list, slot active with 0 bytes of lag.

Render is expected to match: phase A ran "Render first, then lab", lab has sent `seq` on every person_events change since, the public health shows apply healthy, and public code (main 702c3642) writes `ON CONFLICT (person_id, kind, seq)`, which fails without the column. The public API's `seq: 0` on keith-self's notable is app-derived and proves nothing about the schema. F0 confirms it, read-only, before anything runs.

## Batch window (Worf r2 order, r3 conditions)

Run order: **F1 (freeze) → F0 (baseline) → F2 → F3 → F4 → F5 → F6 → F7.** The F0 baseline is read after the F1 freeze is confirmed, so its LSNs, counts and md5 are the frozen state every later step is compared with. A shape-only F0 of lab may also be read earlier, as a pre-check, but it does not replace the post-freeze baseline; Render's database is read only inside the window (F0, below).

Any rise in `apply_error_count` (aec), any apply-worker ERROR in Render's logs, or `srsubstate` other than `r` is a **STOP**: do not run the next step. The aec baseline is not zero (216558 at 12:22 ET and still 216558 at 13:49 ET) and steps +1 on reconnects, so compare increases from F0. `srsubstate` stays `r` while apply loops on an error, so it is not enough alone: read the logs and `last_msg_receipt_time` too.

- **F1. Freeze every person_events writer.** Stop on lab and on Render:

  | Writer | Writes | How to freeze |
  |---|---|---|
  | Lab app (`:5220`): add, annotate, promote, add-request processing, admin edits | people + person_events via `savePerson` / `syncPersonEvents` | Operator stops it (`exittracectl.sh stop`), or leaves it up with no editor active. The app has no read-only switch. **Do not restart it inside the window:** boot runs `importSeed`, which rewrites person_events. |
  | Daily ingest (`scripts/et-daily-ingest.sh` → `et-daily-apply.mjs`), host cron at 08:19 ET | people + person_events via the store | Hold the window outside its run, or disable its cron entry for the window, and check that no `et-daily` lock is held. |
  | Mention poll and worker (`x-mention-*`, user timers about every 10 minutes; the worker writes the lab database) | request tables; the dig can promote into people | `systemctl --user stop` both timers for the window. |
  | keep_up stamps and media-delta (host cron every 5 minutes) | `et_meta` only (no person_events), plus media rsync | May keep running; they move the LSN, so the F0 and F4 "LSN unchanged over a minute" check is read with them paused or accounted for. |
  | Daily pack (09:05 ET) and the shared backup (03:15 ET) | read-only `pg_dump` | No freeze needed. |
  | One-off scripts (`gap-upsert-published.mjs`, `process-add-request.mjs`, `promote-source-post.mjs`, `annotate-unsealed-indictments.mjs`, `migrate-*`, `import-*`, `seed-*`, `scripts/ops/et-retire-tag.mjs`) | people / person_events, on lab or **directly on Render** (gap-upsert) | Do not run any during the window. |
  | Render app: boot (`ensureSchema` + bootstrap) and any runtime write endpoint (admin edits, add requests) | DDL `IF NOT EXISTS` only at boot; rows through the store at runtime | No Render deploy or restart during the window, no admin edits on public. Render's `ET_MULTI_EVENT_WRITES` stays off. |
  | Boot of the lab app | DDL `IF NOT EXISTS`, then `importSeed` | No lab boot during the window. |

  Confirm the freeze on lab with `pg_stat_activity` (no client backends besides the operator's psql) and an unchanged `pg_current_wal_lsn()` over a minute.
- **F0. Read-only baseline, after the freeze**, inside `BEGIN READ ONLY` on each side:
  - **Render database reads (Worf r4 MED-2 ruling).** The Render catalog reads and the subscription-stats reads below are allowed **only inside the Admiral-approved F2/F5 window**, and only with **the same Render DB credential the approved F2/F5 DDL uses**. Q plants that credential on the operator host as a file; it is held **path-only** (psql or the client reads the file by path, for example through `PGPASSFILE`), so its value never appears in a command line, argv, output or log. It is **never pulled, minted or revealed through the Render API.** Outside the window nothing reads Render's database.
  - **Both sides**, `public.person_events`: columns with attnum, type, NOT NULL and default; the PK with its ordered columns; every unique index with its columns and `indisvalid`; every CHECK by name and definition; `relreplident`; `SHOW server_version` (lab 16.14; Render major 16 per the Render API); row count; `count(*) FILTER (WHERE seq > 0)` and `count(*) FILTER (WHERE seq < 0)`; duplicate `(person_id, kind)` (must be 0); md5 by key.
  - **Expected on Render, and on lab:** `seq integer NOT NULL DEFAULT 0`, PRIMARY KEY `(person_id, kind)`, `relreplident` `d`, and UNIQUE `person_events_person_kind_seq_key (person_id, kind, seq)`, valid.
  - **STOP** (go back to Worf) if either side has: a 3-column PK, any row with `seq <> 0` (`seq > 0` or `seq < 0`), no `seq` column, `relreplident` other than `d`, or a CHECK set different from the other side's.
  - **Lab:** `pg_current_wal_lsn()`; `exittrace_lab_pub` (`pubviaroot`, the person_events column list and row filter); the slot's `active`, `confirmed_flush_lsn` and `wal_status`, with the lag in bytes (`pg_wal_lsn_diff`). STOP if `seq` is in the column list and the slot lags or is inactive.
  - **Render** (inside the window, with the F2/F5 credential above): `pg_stat_subscription` (`latest_end_lsn`, `last_msg_receipt_time`), `pg_stat_subscription_stats.apply_error_count`, and `pg_subscription_rel.srsubstate` for person_events.
  - **Render apply-worker logs**, read through the Render API's logs endpoint, read-only, for the window since the last deploy: count `logical replication` ERROR lines (`missing replicated column`, `duplicate key`, `replica identity`) and record the newest. The Render API key stays in the operator's key file and is used **path-only**: the client reads that file by path; the key is never `echo`ed, never on a command line or in argv, never printed or logged. Only log reads are made with it; it is never used to read, pull or mint a database credential.

  Use `2026-10-22-multi-notable-replication-checks.sql` for the replication reads.
- **F2. Render:** `up-render-a`, additive. The PK is unchanged. Expected to be a no-op on Render (F0 shape).
- **F3. Lab:** `up-lab`. It adds the column only if missing, then swaps to the 3-column PK.
- **F4. Catch-up:** Render `latest_end_lsn` ≥ lab's LSN after F3. aec is flat, there are no apply errors, and md5 by key is equal.
- **F5. Render:** `up-render-b`, the PK swap.
- **F6. Catch-up again, then unfreeze**, writers back in reverse order. Seq-0 writes are safe now.
- **F7. The first `seq > 0` write.** Set `ET_MULTI_EVENT_WRITES=on` (exactly `on`) on **lab only**, then write (for example keith-self's second notable) through the lab app. Confirm it on Render, with aec flat and no new apply-worker ERROR. Render's `ET_MULTI_EVENT_WRITES` stays off.

## Rollback

Reverse order, all under a freeze. **On the real databases, r2's delete of `seq > 0` rows needs the Admiral's words at that moment.** r2 backs up first, into lab-local `_bak` tables. Any files are moved, never deleted.

1. Freeze (F1). Set lab's `ET_MULTI_EVENT_WRITES` off (unset).
2. **r1** lab `REPLICA IDENTITY FULL` (`2026-10-22-multi-notable-rollback-r1-…`).
3. **r2 precheck:** `puballtables` is false, and no `_bak` table is published.
4. **r2** lab: back up, then delete `seq > 0` (`…-r2-lab-bak-delete.sql`).
5. **r3** catch-up: Render has applied the deletes (Render `seq <> 0` = 0).
6. **Render:** `down-render-b`.
7. **Lab:** `down-lab`.
8. **r6** lab `REPLICA IDENTITY DEFAULT`, then catch-up.
9. Optionally, **Render:** `down-render-a`. Checks only; it keeps `seq` and the index.
10. Unfreeze.

While lab is FULL it sends the whole old row, which covers either subscriber key.

## Proof: native publisher/subscriber pair

Real logical replication, not PGlite. The run below (13:22–13:31 ET) used an intermediate tree and the earlier render-a (with a seq CHECK). It is kept for its negative tests. **The proof for the exact tree of this PR is re-run and recorded outside the tree** (the PR description and the batch RESULTS, with the tree sha, the public-code sha and the subscriber log at each F step), because recording it here would change the tree it proves.

**Setup**
- Two scratch clusters on the lab host, `postgres:16-alpine` (image sha256:57c72fd2…, the same image lab runs, PostgreSQL 16.14).
- Ports 56433 (pub, `wal_level=logical`) and 56434 (sub), checked free first. Host network, `listen_addresses=127.0.0.1`, TCP auth tightened to scram, our uid.
- Run dir on the lab host (`var/et-batch-20261026/repl/`), with a mode 600 scratch env file. Driver: `repl-proof.sh`.

**Restore and empty-catalog check**
- Lab copy, read-only: `pg_dump -d exittrace -Fc --no-publications --no-subscriptions --no-owner --no-acl`. 2382232 bytes, sha256 7485462a….
- Restored into three database pairs. `pg_publication` / `pg_subscription` / `pg_replication_slots` were 0 / 0 / 0 on all six before anything else.
- The subscriber copy for the main pair models Worf's unmigrated Render: no `seq`, no phase A index, PK `(person_id, kind)`.
- Scratch publication `FOR TABLE people, person_events`, subscription `copy_data = false`.

**F0–F7, main pair, 4445 rows**

| Step | What happened | aec | Apply errors |
|---|---|---|---|
| F0 | pub `seq` present, PK `(person_id, kind)`, RI d; sub no `seq`, PK `(person_id, kind)`; md5 equal (f1c4fe68830c) | 0 | — |
| F2 | sub gets `seq`, the (since removed) CHECK and the index; PK unchanged; re-run is a no-op | 0 | none |
| F3 | pub PK `(person_id, kind, seq)`; re-run is a no-op | 0 | none |
| F4 | caught up at the same LSN (0/58AD2A0) | 0 | none |
| F5 | sub PK `(person_id, kind, seq)` | 0 | none |
| F6 | seq-0 INSERT / UPDATE / DELETE replicate; md5 equal | 0 | none |
| F7 | keith-self `notable:1` INSERT and UPDATE replicate; 4446 rows; md5 equal | 0 | none |

**NEGATIVE 1: plain lab-first** (up-lab on the publisher, nothing on the subscriber)
- The next INSERT fails: `missing replicated column: "seq"`. aec went 0 → 3 within 8 s, the row never arrived, and catch-up was not reached.
- Running render-a on the subscriber let the retried transaction apply.
- This error does **not** depend on up-lab. Lab's phase A column alone causes it.

**NEGATIVE 2: subscriber-first PK swap** (sub render-a + render-b, publisher still `(person_id, kind)`)
- The INSERT applies (aec 0).
- The UPDATE fails: `publisher did not send replica identity column expected by the logical replication target relation "public.person_events"`. aec went 0 → 3.

**Rollback, main pair**

| Step | Result |
|---|---|
| r1 | pub FULL |
| r2 | precheck `puballtables=false`, 0 `_bak` tables published; then 1 row in `person_events_multi_notable_bak`, 1 in `people_events_multi_notable_bak`, deleted on pub |
| r3 | sub `seq > 0` = 0 |
| down-render-b | sub PK `(person_id, kind)` |
| down-lab | pub PK `(person_id, kind)`, phase A index back |
| r6 | pub RI d |
| down-render-a | sub keeps `seq` (that run also dropped the since-removed CHECK) |

After unfreeze, seq-0 INSERT / UPDATE / DELETE replicate. md5 is equal, aec 0 throughout, and the publisher ends in exactly its F0 shape.

**Public code (main 702c3642) on the scratch subscriber cluster**, database `exittrace_compat` (no `seq`):
- `getPerson` and `listPeople("notable")` work both before and after F2.
- `savePerson` fails before F2 (`column "seq" … does not exist`, 42703) and works after F2 and after F5, with seq staying 0. **Reads ignore the extra column, and writes need it.**
- An earlier version of `tests/multi-event-pg.test.mjs` passed on that cluster.

## Scratch review option (pending Worf's choice)

1. Use the same pg_dump route (`--no-publications --no-subscriptions`) into a run dir.
2. Restore into a separate scratch cluster on a new localhost port.
3. Apply the three Up steps there.
4. Boot this PR's worktree against it on another port.

Lab `:5433` / `:5220`, `exittrace_lab_pub`, the slot, the Render subscription and public stay untouched.

## Writer quirk (noted, not changed)

`normalizeEventMedia` (`app/lib/event-attrs.mjs`) stores each media link through `canonicalPublicUrl`, which drops `www.`. So Trump's NYT still links to `nytimes.com/…` while its cite keeps `www.nytimes.com`. `canonicalPublicUrl` is the shared dedupe key for cites and media, so it is left alone here.
