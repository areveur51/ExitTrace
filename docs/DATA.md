# Data pack

The committed `data/seed.json` is the portable gold import (identified people and official dog-comms). `media/` holds stored portraits and dog-comm stills. Public source posts are a separate store (`source_posts`) and are not written into the gold seed. Parked posts keep a category guess for later classify and list on `/unsorted`, not on the people pages.

## Source-post JSONL

Park public posts without inventing subject identity:

```bash
node scripts/import-source-posts.mjs path/to/posts.jsonl
# or:
./exittracectl.sh import-posts path/to/posts.jsonl
```

The script only reads the path you pass. A host-local pack may live under `var/` (gitignored). Do not commit extract files.

Each line is public fields only:

```json
{"source_url":"https://example.com/n/1","quoted_url":"","card_url":"","text":"…","poster_handle":"@desk","poster_name":"Desk","posted_at":"2024-03-01","media_urls":[],"category":"arrests"}
```

Accepted `category` values: `firings`, `resignations`, `government_stepdowns`, `arrests`, `death_unspecified`. Commentary dog posts are skipped. Dedup is by canonical public URL. A URL that already sits on a gold person row is stored as an annotation only — the gold person is not overwritten. The import is idempotent against Postgres or the file fallback.

## Promote one source post

Once a parked Unsorted post has a named subject, a calendar event date, a catalog category, and at least two published-news or official-account cite URLs, write an identified person row:

```bash
node scripts/promote-source-post.mjs \
  --source-url https://example.com/n/arrest-1 \
  --subject "Casey Vale" \
  --event-date 2024-06-15 \
  --category arrests \
  --cite-url https://www.example.com/news/casey-vale-held \
  --cite-url https://www.example.net/world/casey-vale-arrest
# or:
./exittracectl.sh promote --source-url … --subject "…" --event-date YYYY-MM-DD \
  --category arrests --cite-url … --cite-url …
```

`--id <sp-…>` may replace `--source-url`. Optional: `--summary`, `--role`, `--photo`, `--photo-credit`.

Fail-closed: the caller supplies subject, `event_date` (YYYY-MM-DD, not `posted_at`), category, and ≥2 `http`/`https` cite URLs. The poster handle is never copied as the subject. The post date is never copied as the event date. Cites are not invented. A Wikimedia portrait is optional; omit `--photo` to keep initials / em dash.

Allowed `--category` values: `firings`, `resignations`, `government_stepdowns`, `death_celebrity`, `death_official`, `death_ceo`, `arrests`. `dog_comms` is a catalog page, not a person row.

If the same person already exists (id/slug, or the same subject with `event_date` within three days), only new cites are attached. Name, date, category, and existing cites stay as they are. The source post stays on Unsorted (it is not deleted). The command is idempotent on Postgres and on the file store. It does not write `data/seed.json`.

## Queue and process an add request

`/add` stores a pending `add_request` (Postgres, or `store.json` when `DATABASE_URL` is unset). Submit does not invent cites.

Host process after look-up:

```bash
node scripts/process-add-request.mjs --next \
  --cite-url https://www.example.com/news/casey-vale-held \
  --cite-url https://www.example.net/world/casey-vale-arrest \
  --event-date 2024-06-15 \
  --category arrests
# or one id:
./exittracectl.sh add-process --id ar-… --cite-url … --cite-url …
```

People: named subject, calendar `event_date`, catalog category, and ≥2 published-news or official news-org / government social URLs. Random social is rejected. If the request `hint_url` matches an Unsorted source post, the promote path is reused; otherwise the same fail-closed insert writes an identified person. Gold rows stay annotate-only.

Dog comms: official government handle + official post URL + date. Unofficial social is rejected. Snapshot text/media is copied only if it is already in the local store. The command does not fetch X.

Idempotent. Does not write `data/seed.json`.

GitHub Releases publish a zip of those two directories. The `/downloads` page describes the zip and does not fetch it.

## Publish

`scripts/pack-data.sh` writes `dist/exittrace-data-YYYYMMDD.zip` and a `.sha256` file. The zip is not committed. The `data-release` workflow attaches that zip to:

- `data-YYYYMMDD`
- `data-latest` (replaced on each publish)

## Fetch

```bash
./scripts/fetch-data.sh
```

That resolves the zip on the `data-latest` release. You can also pass a direct asset URL.
