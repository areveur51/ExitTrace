# Lab → Render Postgres sync

GitHub Actions workflow [`.github/workflows/lab-to-render-sync.yml`](../.github/workflows/lab-to-render-sync.yml) replaces the existing Render managed Postgres with a dump of the **lab** database. Dump/restore is the default path. A logical replica is optional and is not configured in this repository. Media rsync to Render is a separate host path. Do not enable or change [`data-release.yml`](../.github/workflows/data-release.yml) for this — the host pack owns full media releases; the GHA pack stays skinny.

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
| Triggers | `workflow_dispatch`, plus cron `0 */2 * * *` (every even UTC hour at minute 0; America/New_York: every 2 hours ET — EDT UTC-4 is 8:00pm, 10:00pm, …, 6:00pm ET; EST UTC-5 is 7:00pm, 9:00pm, …, 5:00pm ET). GitHub Actions cron is UTC and does not honor a TZ key. |
| Dump runner | Self-hosted labels `self-hosted`, `lab` (env-configurable). Override with repository variable `ET_LAB_RUNNER_LABELS` (JSON array) to match your runner. |
| Dump script | Env `ET_LAB_DUMP_SH` (example `/path/to/et-lab-dump.sh`) writes `ET_LAB_DUMP_OUT` (example `/path/to/exittrace-lab-latest.dump`). Set these on the runner and/or as repository variables. The helper is a custom-format `pg_dump` of the lab ExitTrace database. |
| Artifact | `exittrace-lab-dump` (`exittrace-lab.dump.gz`), retention 1 day |
| Restore runner | `ubuntu-latest` |
| Restore | `pg_restore --clean --if-exists` (plus `--no-owner --no-acl`) into `production` / `DATABASE_URL` |
| Counts | Restore prints `people`, `dog_comms`, `operations`, `source_posts` so operations land with the rest of the schema |

Dump job has no Render URL. If the dump helper path is unset or not executable, the job fails closed.

## Optional logical replica

Dump/restore stays the default. A logical replica is optional. Do not put a replica URL in Actions. Replica and other private-fleet detail stay outside this repository.
