# Lab → Render Postgres sync

GitHub Actions workflow [`.github/workflows/lab-to-render-sync.yml`](../.github/workflows/lab-to-render-sync.yml) replaces the existing Render managed Postgres with a dump of the **lab** database. `SYNC_MODE` is `dump` or `logical`. Default is **`dump`** (dump/restore). `logical` is optional and is not configured on this public workflow (no-op skip). A private env may set `SYNC_MODE=logical` later. Media rsync to Render is a separate host path. Do not enable or change [`data-release.yml`](../.github/workflows/data-release.yml) for this — the host pack owns full media releases; the GHA pack stays skinny.

This does **not** create a second Render database or web service. Point the secret at the External URL of the ExitTrace database that already exists. Private fleet wiring stays outside this repository.

## Admiral: secret before the first run

1. In the GitHub repo: **Settings → Environments**. Create an environment named exactly `production` if it is missing.
2. On that environment, add a secret named exactly **`DATABASE_URL`**.
3. Value: the Render Postgres **External** connection string (Dashboard → the existing ExitTrace database → External Database URL). Keep `sslmode=require` (the job also forces it).
4. Do **not** commit the URL. Do **not** put it on the dump-runner host or in a repo-level secret under another name.

The restore job runs on `ubuntu-latest` and reads only `secrets.DATABASE_URL` from environment `production`. Render’s IP allow list must accept GitHub-hosted runner egress for that restore to connect.

## What runs

| Piece | Value |
|--|--|
| Workflow file | `.github/workflows/lab-to-render-sync.yml` |
| Triggers | `workflow_dispatch` (`SYNC_MODE` input, default `dump`), plus cron `0 */2 * * *` (every even UTC hour at minute 0; America/New_York: every 2 hours ET — EDT UTC-4 is 8:00pm, 10:00pm, …, 6:00pm ET; EST UTC-5 is 7:00pm, 9:00pm, …, 5:00pm ET). GitHub Actions cron is UTC and does not honor a TZ key. |
| `SYNC_MODE` | `dump` (default) or `logical`. Dispatch input, or repository variable `SYNC_MODE` when the input is empty (scheduled runs). Invalid values fail closed. |
| Dump runner | Self-hosted labels `self-hosted`, `lab` (env-configurable). Override with repository variable `ET_LAB_RUNNER_LABELS` (JSON array) to match your runner. |
| Dump script | Env `ET_LAB_DUMP_SH` (example `/path/to/et-lab-dump.sh`) writes `ET_LAB_DUMP_OUT` (example `/path/to/exittrace-lab-latest.dump`). Set these on the runner and/or as repository variables. The helper is a custom-format `pg_dump` of the lab ExitTrace database. |
| Artifact | `exittrace-lab-dump` (`exittrace-lab.dump.gz`), retention 1 day |
| Restore runner | `ubuntu-latest` |
| Restore | `pg_restore --clean --if-exists` (plus `--no-owner --no-acl`) into `production` / `DATABASE_URL` |
| Counts | Restore prints `people`, `dog_comms`, `operations`, `source_posts` so operations land with the rest of the schema |

Dump job has no Render URL. If the dump helper path is unset or not executable, the job fails closed.

## Optional logical replica

`SYNC_MODE=logical` is a gated no-op on this public workflow: it logs that a logical replica is optional and not configured here, then skips dump/restore. Do not put a replica URL in Actions. Private-fleet wiring stays outside this repository.

## Keep-up stamps (`et_meta`)

`GET /api/health` (and `/health`) expose a public-safe `keep_up` object. Stamps are **null** until a writer upserts `et_meta`. Process health stays HTTP 200 when a stamp is missing or stale. Do not store secrets, hostnames, IPs, CIDRs, or database instance ids in `v`.

Reuse the existing upsert:

```sql
INSERT INTO et_meta (k, v) VALUES ('keep_up.daily_ingest.last_pass', jsonb_build_object('at', now()))
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
```

Or: `node scripts/stamp-keep-up.mjs --key keep_up.daily_ingest.last_pass` (needs `DATABASE_URL`).

| Key | Public field | Writer |
|--|--|--|
| `keep_up.logical.stream_started` | `keep_up.logical.stream_started` | Lab, when the logical stream starts. Replicates with `et_meta`. |
| `keep_up.logical.last_verify` | `keep_up.logical.last_verify` | Actions `et-cutover-verify` on PASS (Render `et_meta`). |
| `keep_up.logical.lag_seconds` | `keep_up.logical.lag_seconds` | Optional stored fallback. Health prefers live receipt age when present. Receipt-only lag can look fine during apply crash-loops; use live `apply_state`. |
| `keep_up.media_delta.last_success` | `keep_up.media_delta.last_success` | Lab media delta on success. |
| `keep_up.media_delta.last_with_files` | `keep_up.media_delta.last_with_files` | Lab media delta when files moved. |
| `keep_up.daily_ingest.last_pass` | `keep_up.daily_ingest.last_pass` | Lab daily ingest on PASS. |
| `keep_up.daily_pack.last_pass` | `keep_up.daily_pack.last_pass` | Lab daily pack on PASS. |
| `keep_up.dump_restore.last_success` | `keep_up.dump_restore.last_success` | Actions restore job on success (Render `et_meta`). |
| `keep_up.dump_restore.mode` | `keep_up.dump_restore.mode` | `cold_fallback` or `disabled`. Restore stamps `cold_fallback`. |

Timestamp `v` is `{ "at": "<ISO>" }`. Health labels times in `America/New_York` (ISO offset + `timezone`). `dump_restore.mode` is `{ "mode": "cold_fallback" }` or `{ "mode": "disabled" }`. The health process does not read `SYNC_MODE`.

Live (not `et_meta`) public fields on `keep_up.logical`:

| Public field | Meaning |
|--|--|
| `apply_state` | Subscriber only: `disabled` / `healthy` / `handshake_retry` / `crash_loop` / `lsn_stalled` / `relations_stale` / `poison_txn`. `null` when no `pg_subscription` (publisher / lab / file) — not subscriber `absent`. |
| `apply_error_count` | Live `pg_stat_subscription_stats` apply errors, or null. |
| `lag_seconds` | Receipt age. A small number is **not** proof apply is healthy. |

`GET /api/health` also exposes `git_sha` when Render sets `RENDER_GIT_COMMIT` (hex only). File backend is null.

## Mode machine

| `SYNC_MODE` | Logical sub | Dump cron (`lab-to-render-sync`) | Auto heal |
|--|--|--|--|
| `dump` (public default) | absent or optional | scheduled `pg_restore --clean` | no-op when no subscription |
| `logical` (private env var) | primary | skipped (cold standby) | `et-logical-heal` every 15 minutes |
| `logical` + sustained unhealthy | still primary | one-shot dump **only** if `ET_DUMP_COLD_FALLBACK=true` **and** dispatch `allow_dump_fallback=true` | gap-upsert catch-up if `ET_AUTO_GAP_UPSERT=true` |

Scheduled dump reads `vars.SYNC_MODE` (default `dump`). Dispatch input wins, so a one-shot `SYNC_MODE=dump` does not change the repo var and does not re-enable the dump cron while logical is primary. Do **not** flip `vars.SYNC_MODE` to `dump` while the subscription is enabled — that is dual-write. Changing the var back to dump is a human SIGN (disable the sub first).

## Logical apply heal

[`.github/workflows/et-logical-heal.yml`](../.github/workflows/et-logical-heal.yml) runs `scripts/logical-apply-heal.mjs` (library: `app/lib/logical-heal.mjs`). It reuses the existing subscription name and the same DISABLE/ENABLE / `REFRESH PUBLICATION WITH (copy_data = false)` verbs as `et-sub-reconnect` and `et-sub-refresh-publication`.

Auto (no SIGN):

- Reconnect (DISABLE/ENABLE) with backoff 8/16/32/64s on `handshake_retry`, `crash_loop`, `lsn_stalled`, or a disabled sub.
- `REFRESH PUBLICATION WITH (copy_data = false)` only when relation rows are empty or none are ready. Never `copy_data=true`.
- Classify `handshake_retry` when receipt age looks fine but apply errors are rising or the worker is missing.

Still needs Admiral SIGN:

- Poison transaction after three auto reconnects (`poison_txn`). Heal prints the sanitized apply error and a skip recipe. It does **not** run `ALTER SUBSCRIPTION … SKIP`.
- Destructive dump `--clean`.
- Re-enabling the dump schedule while logical is primary.

```text
NEEDS_SIGN poison transaction — do not auto SKIP.
1. Confirm the apply error on the subscriber (catalog + logs). Do not assume a schema class.
2. If Admiral SIGNs a skip: ALTER SUBSCRIPTION exittrace_lab_sub SKIP (lsn = '<lsn>');
3. Run et-gap-upsert (idempotent by id) for any skipped published row.
4. ENABLE; prove LSN advances and apply_error_count stops rising.
```

A `posted_at` TEXT vs DATE mismatch is one **class** of apply poison (see `scripts/bootstrap-db.sql`); heal prints `POSTED_AT_TYPE` as a hint and does not assume that is the cause.

Path A / streaming: `et-sub-reconnect` retries ENABLE with the same backoff. `et-path-a-probe` prints apply error counts next to receipt times so handshake retries are not mistaken for a healthy stream.

## Idempotent gap upsert

[`.github/workflows/et-gap-upsert.yml`](../.github/workflows/et-gap-upsert.yml) exports published tables from lab (`scripts/export-published-tables.mjs`) and upserts by id on Render (`scripts/gap-upsert-published.mjs`). Tables: `people`, `dog_comms`, `operations`, optional `categories` (skipped if that table is absent), plus `person_events`. `ON CONFLICT DO UPDATE` only. Never `TRUNCATE` / `DELETE` / `--clean`. Proves counts after. Dispatch `source=lab_runner` (same labels as dump) or `source=two_url` (`LAB_DATABASE_URL` + `DATABASE_URL` in environment `production`).

Arm automatic catch-up from heal with repository variable `ET_AUTO_GAP_UPSERT=true` (off by default).

## Red-folder comms publication

`red_folder_comms` is a `dog_comms` twin. Lab adds it with `scripts/add-red-folder-comms-publication.sql` (`ALTER PUBLICATION exittrace_lab_pub ADD TABLE red_folder_comms` when missing). Subscriber then `ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false)` only if the relation is missing. Never `copy_data=true`. Media uses the existing media-delta rsync path. Do not gap-upsert the existing lab harvest rows from this restore.

`central_casting_comms` is the same kind of twin (`sense` is `looks_the_part` or `replacement`, not a person KEEP tag). Lab adds it with `scripts/add-central-casting-comms-publication.sql` (`ALTER PUBLICATION exittrace_lab_pub ADD TABLE central_casting_comms` when missing). Same `copy_data = false` rule. No seed rows in this repo (seed after MERGE+PLACE on lab). Media: `media/central-casting-comms/` and `media/screenshots/central-casting-comms/`.

## Render code freshness

Render Git auto-deploy on `main` is the deploy plane (Dashboard → the existing web service → Settings → Auto-Deploy). This repo does not force redeploys.

[`.github/workflows/et-code-freshness.yml`](../.github/workflows/et-code-freshness.yml) compares public `/api/health` `git_sha` to `origin/main` when `ET_PUBLIC_HEALTH_URL` is set. Mismatch fails the check and does **not** redeploy. Unset URL → skip.
