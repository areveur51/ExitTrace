# Multi-event person_events (several events of one kind per person)

Status: code and migrations in this PR. **No DDL has run on lab or Render.** Nothing here runs without the Admiral's batch CLEAR plus Worf's and O'Brien's gates.

## What changes

- **Schema.** `person_events` primary key becomes `(person_id, kind, seq)` (it is `(person_id, kind)` on lab today). The phase B CHECK `person_events_seq_notable_only` (`kind = 'notable' OR seq = 0`) is replaced by `person_events_seq_nonneg` (`seq >= 0`). The database allows any kind to repeat; the app decides which kinds do.
  - Up: `scripts/migrations/2026-10-26-multi-event-up.sql`
  - Down: `scripts/migrations/2026-10-26-multi-event-down.sql`
  - Both are one transaction, idempotent, and change no rows. Up needs phase A (the `seq` column and the unique index `person_events_person_kind_seq_key`), which lab has.
- **App.** `REPEATABLE_EVENT_KINDS = ["notable", "red_folder"]` in `app/lib/promote.mjs`. Every other kind stays one event per kind at `seq = 0`, unchanged.
  - Save and upsert: `syncPersonEvents` writes one companion row per `(kind, seq)`.
  - Read and merge: `uniqueEvents`, `attachPersonEvent` and `mergePersonAnnotate` match a repeatable event by explicit seq, or by the same date plus an overlapping cite or identical comments. Anything else is a new row with the next free seq for that kind.
  - Headline: still the newest catalog event. `red_folder` is not a catalog kind, so it never takes the headline.
  - Renderers: one Red Folder block per `red_folder` event (sentence, office line, media with captions, label "Red Folder") and "date · Red Folder" in the source list. Its media no longer fall into the generic supporting block. Several notables already render one Notable block each.
  - API: `/api/people` returns every event with its `seq`.
  - List and kind pages: they already read `MAX(event_date)` per kind, so a person is listed once.
- **Write guard.** `assertMultiNotableReady` refuses a `seq > 0` event until *this* database has the new key (`multi_notable_needs_phase_b`). It also refuses a `seq > 0` event of a kind other than notable while the notable-only CHECK is still there (`multi_event_needs_migration`). The guard sees only its own database.
- **Fresh databases.** `scripts/bootstrap-db.sql` creates the table with the new CHECK. Bootstrap never swaps the PK on an existing table.

## Replication: lab → Render (DDL is not replicated)

Lab is the publisher (publication `exittrace_lab_pub`, slot `exittrace_lab_sub`). Render is the subscriber (`exittrace_lab_sub`). Logical replication carries row changes only, so **DDL is not replicated**: each side runs the SQL itself, and the subscriber cannot be migrated before the batch CLEAR.

### Replica identity

`person_events` uses `REPLICA IDENTITY DEFAULT` on lab (`relreplident = d`), so its identity is its primary key.
- Today the key the publisher sends is `(person_id, kind)`.
- After Up on lab it is `(person_id, kind, seq)`. Up keeps DEFAULT, and the PK swap happens inside one transaction, so the published table never has a committed moment without a replica identity.
- On the subscriber, apply locates rows by the subscriber's own replica identity (its PK). That works only if every subscriber key column is among the columns the publisher sent.

### What UPDATE and DELETE carry after the PK change

- **DELETE** sends the old key: `person_id, kind, seq`.
- **UPDATE**
  - When no key column changes, the message carries the new tuple only, and the subscriber takes the key columns from it.
  - When a key column changes, it also carries the old key (`K`) with `person_id, kind, seq`.
  - App writes delete and re-insert companion rows, so they replicate as DELETE plus INSERT.
- **Render still on `(person_id, kind)`:** its key is a subset of what lab sends, so UPDATE and DELETE keep applying.
- **Render moved first to `(person_id, kind, seq)` while lab still sends `(person_id, kind)`:** every UPDATE or DELETE fails with `publisher did not send replica identity column expected by the logical replication target relation`, and the apply worker retries forever. **Never migrate the subscriber first.**

### INSERTs on an unmigrated subscriber

Render is expected to be on phase A (see the evidence below): it has the `seq` column, PK `(person_id, kind)`, and no CHECK.

| Row lab sends | Unmigrated Render (phase A) | Render without the `seq` column | Render on phase B only (notable-only CHECK) |
|---|---|---|---|
| first red_folder, `seq = 0` | applies | `missing replicated column: seq` | applies |
| keith-self second notable, `seq = 1` | **duplicate key** on `person_events_pkey (person_id, kind)`, apply stalls | missing column | applies |
| a second red_folder, `seq = 1` | **duplicate key** if that person already has a red_folder row | missing column | **check violation** `person_events_seq_notable_only` |

So on an unmigrated subscriber the failure is a **duplicate (person_id, kind)**, not the missing `seq` column. The missing-column error would only happen if Render lacked phase A. Every one of these stalls the whole subscription, not just one row. The scratch model is `repl-sim.mjs`. It ran against real constraint errors on PGlite, and its output is in the PR body.

### Does public already have `seq`?

The public API shows `seq: 0` on keith-self's notable. That comes from the app, not from the database:
- `normalizePersonEvent` and `uniqueEvents` give every notable a seq, even from `people.events` JSON.
- Non-notable events show no seq.

So the API does not prove the schema. The evidence that Render has the `seq` column:
- Lab has phase A (dump at 12:14 ET: `seq INTEGER DEFAULT 0` and the unique index).
- Lab publishes every column.
- Person_events writes made after that still reached public.
- A subscriber without `seq` would fail every person_events change with `missing replicated column`.

Render's PK is reconstructed as `(person_id, kind)` (phase A only). **Confirm both read-only at F0** with `2026-10-22-multi-notable-replication-checks.sql`. If Render is already on 3-column PK, STOP and go back to Worf: that shape would already break UPDATE/DELETE apply.

This does not change the order. It confirms that the subscriber-first order would be wrong, and that expand on lab first, then contract on the subscriber, is the safe order.

## Safe batch-window order (expand/contract, publisher first)

F0–F6 extends `docs/MULTI_NOTABLE_MIGRATION.md`'s phase B order, with Up in place of phase B.

- **F0. Record, read-only, on both sides:**
  - phase A present on both;
  - PK and `relreplident`;
  - `count(*)`, `count(*) FILTER (WHERE seq > 0)` (must be 0), and duplicate `(person_id, kind)` (must be 0);
  - md5 by key;
  - lab `pg_current_wal_lsn()` and slot `confirmed_flush_lsn`;
  - Render `latest_end_lsn`, `apply_error_count` (aec) and `srsubstate`.

  The aec baseline is not zero (216558 at 12:22 ET) and steps +1 on reconnects, so compare deltas.
- **F1. Write freeze** on lab `person_events` (ingest and app writes). Required, because the guard cannot see Render.
- **F2. Lab: Up.** Lab's PK becomes `(person_id, kind, seq)`. Render's `(person_id, kind)` is a subset of the sent key, so UPDATE and DELETE apply.
- **F3. Catch-up.** The slot `confirmed_flush_lsn` and Render `latest_end_lsn` are at or past lab's LSN after F2. aec is flat. Counts and md5 are equal.
- **F4. Render: Up** (same file). Both sides have PK `(person_id, kind, seq)`, `seq >= 0`, `relreplident = d`, and `srsubstate = r`.
- **F5. Unfreeze**, after a second catch-up check.
- **F6. Only now** may a `seq > 0` row be written (keith-self's second notable, a second red_folder).

The first `red_folder` event of a person is `seq = 0` and is safe at any step. Melania's and Trump's current red folders need no migration.

**Stop rule.** Any aec rise, an apply error in Render logs, or `srsubstate` other than `r` means STOP. Do not run the next step. Roll back.

**Deploy.** The code is safe before Up: the guard refuses `seq > 0`. A merge auto-deploys Render, so this order works either way. Do not run Up on lab before the code that knows about `seq > 0` is deployed on lab, or lab could accept a second event that Render rejects (keep the freeze).

## Rollback (contract in reverse, subscriber first for the key)

1. Freeze lab writes and record the F0 data.
2. **r1** lab `REPLICA IDENTITY FULL`.
3. **r2** lab: copy every `seq > 0` row, of any kind, plus the owning `people.events` into the lab-local `_bak` tables, then delete those rows. Before r2, check that no `_bak` table is in a publication (`puballtables` must be false).
4. **r3** catch-up: Render has applied the deletes.
5. **Down on Render.**
6. **Down on lab.** Down refuses on a publisher that is not FULL.
7. **r6** lab `REPLICA IDENTITY DEFAULT`.

Down keeps the `seq` column and the phase A index, so the deployed code keeps working. While lab is FULL, it sends the whole old row, which covers either subscriber key.

## Scratch evidence (run dir, PGlite in memory; never lab :5433, never Render)

`migrate-roundtrip.mjs` uses lab's 4445 `person_events` rows from the read-only 12:14 ET dump, loaded into a phase A copy.
- Up gives rows equal by key, PK `(person_id, kind, seq)`, the CHECK `seq >= 0`, and `relreplident = d`. Re-running Up is a no-op.
- After Up, it accepts `seq > 0` for notable and red_folder, and refuses duplicates and negative seq.
- Down refuses while `seq > 0` rows exist.
- r1 + r2 move exactly the `seq > 0` rows to `_bak`.
- Down + r6 give rows equal by key **and** a shape equal to the start. Re-running Down is a no-op.
- The PR's own store code writes, on a second copy:
  - keith-self's second notable (`seq 1`, headline the newest notable, 2026-10-05);
  - Trump's red_folder (`seq 0`, headline still notable 2024-07-09);
  - Melania's red_folder (`seq 0`, headline still corona_comms 2020-10-01).
  No other person's rows change.
- The guard refuses a second notable before Up, and a second red_folder on phase B with the notable-only CHECK.

## Option: lab review against a scratch copy (pending Worf's choice)

This boots the PR for review without touching lab :5433 or replication.

1. Take a read-only snapshot of lab: `pg_dump --no-publications --no-subscriptions --no-owner` (it holds a plain read lock only), into the run dir.
2. Restore it into a **separate scratch Postgres cluster** on a new port, owned by the run, with no `wal_level=logical` slots and no subscription. Alternatively, use PGlite or the in-memory store loaded from that dump.
3. Run Up on the scratch copy only, then apply the review writes (keith-self's second notable, Trump's and Melania's red_folder events with photo 3 and the NYT still).
4. Boot this PR's worktree on a separate port with `DATABASE_URL` pointing at the scratch cluster, and screenshot the three person pages.
5. Lab :5220/:5433, the publication, the slot, the Render subscription and public stay untouched.
6. Tear down by moving the scratch cluster's data directory to `retired/`.

Nothing in this option creates or alters a publication, a subscription or a slot on lab.

## Writer quirk (noted, not changed)

`normalizeEventMedia` (`app/lib/event-attrs.mjs`) stores each media item's link through `canonicalPublicUrl`, and that drops `www.`. Trump's NYT still therefore links to `https://nytimes.com/2023/11/01/...` while its cite keeps `https://www.nytimes.com/...`. The link still resolves. `canonicalPublicUrl` is the shared dedupe key for cites and media across the app, so changing it is not trivial. It is left as is here.
