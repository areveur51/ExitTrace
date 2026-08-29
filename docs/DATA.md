# Data pack

The committed `data/seed.json` is the portable gold import (identified people and official dog-comms). `media/` holds stored portraits and dog-comm stills. Public source posts are a separate store (`source_posts`) and are not written into the gold seed.

## Source-post JSONL

Park public posts without inventing subject identity:

```bash
node scripts/import-source-posts.mjs path/to/posts.jsonl
# or:
./exittracectl.sh import-posts path/to/posts.jsonl
```

Each line is public fields only:

```json
{"source_url":"https://example.com/n/1","quoted_url":"","card_url":"","text":"…","poster_handle":"@desk","poster_name":"Desk","posted_at":"2024-03-01","media_urls":[],"category":"arrests"}
```

Accepted `category` values: `firings`, `resignations`, `government_stepdowns`, `arrests`, `death_unspecified`. Commentary dog posts are skipped. Dedup is by canonical public URL. A URL that already sits on a gold person row is stored as an annotation only — the gold person is not overwritten. The import is idempotent against Postgres or the file fallback.

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
