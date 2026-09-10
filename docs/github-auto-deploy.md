# Lab → Render Postgres sync

GitHub Actions workflow [`.github/workflows/lab-to-render-sync.yml`](../.github/workflows/lab-to-render-sync.yml) replaces the existing Render managed Postgres with a dump of the **lab** database. It is dump/restore only. Media rsync to Render is a separate host path. Do not enable or change [`data-release.yml`](../.github/workflows/data-release.yml) for this — the host pack owns full media releases; the GHA pack stays skinny.

This does **not** create a second Render database or web service. Point the secret at the External URL of the ExitTrace database that already exists.

## Admiral: secret before the first run

1. In the GitHub repo: **Settings → Environments**. Create an environment named exactly `production` if it is missing.
2. On that environment, add a secret named exactly **`DATABASE_URL`**.
3. Value: the Render Postgres **External** connection string (Dashboard → the existing ExitTrace database → External Database URL). Keep `sslmode=require` (the job also forces it).
4. Do **not** commit the URL. Do **not** put it on the pop-os lab host or in a repo-level secret under another name.

The restore job runs on `ubuntu-latest` and reads only `secrets.DATABASE_URL` from environment `production`. Render’s IP allow list must accept GitHub-hosted runner egress for that restore to connect.

## What runs

| Piece | Value |
|--|--|
| Workflow file | `.github/workflows/lab-to-render-sync.yml` |
| Triggers | `workflow_dispatch`, plus cron `20 13 * * *` (13:20 UTC = 9:20am America/New_York during EDT, after the 9:05 ET lab pack; during EST that cron is 8:20am ET) |
| Dump runner | Self-hosted labels `self-hosted`, `pop-os`, `exittrace-lab` (runner name `pop-os-exittrace`) |
| Dump script | `/opt/GrokBuild/bin/et-lab-dump.sh` — `docker exec grokbuild-postgres pg_dump -Fc` of database `exittrace` on host **:5433** |
| Artifact | `exittrace-lab-dump` (`exittrace-lab.dump.gz`), retention 1 day |
| Restore runner | `ubuntu-latest` |
| Restore | `pg_restore --clean --if-exists` (plus `--no-owner --no-acl`) into `production` / `DATABASE_URL` |
| Counts | Restore prints `people`, `dog_comms`, `operations`, `source_posts` so operations land with the rest of the schema |

Dump job has no Render URL. If the host script is missing, the job fails closed. Host port **5434** and any replica database are excluded and are never a dump source.

## Host port 5434

A replica Postgres on host port **5434** is not part of this path. Do not dump it, restore it, or put its URL in Actions. The dump source remains the ExitTrace database published on host port **5433** only.
