# Data pack

The committed `data/seed.json` is the portable gold import (identified people and official dog-comms). `media/` holds stored portraits and dog-comm stills. List pages paint derived local thumbs under `media/thumbs/`; seed `photo` / `still` paths stay the full local file. Public source posts are a separate store (`source_posts`) and are not written into the gold seed. Parked posts keep a category guess for later classify and list on `/unsorted`, not on the people pages.

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

## Public RSS digest (name leads)

Host-side seeder. No third-party digest API or key.

```bash
./exittracectl.sh digest
# or:
node scripts/seed-rss-digest.mjs
```

Fetches public RSS from AP, Reuters, BBC, and other official news-org / `.gov` feeds listed against `app/lib/official.mjs`. Parks matching items as Unsorted JSONL leads via `import-posts`, and queues `/add` name leads when a subject can be read from the headline. Digest items are not cites. Wikipedia is not a cite. Q drops stay leads only. Indictment headlines are not given invented JSONL categories — KEEP rematch stays `promote` / `add-process`. Current feeds plus one 2017-on historical slice. Idempotent. No batch cap on parking leads. Does not write `data/seed.json`.

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

`--id <sp-…>` may replace `--source-url`. Optional: `--summary`, `--role`, `--photo`, `--photo-credit`, `--net-worth`, `--net-worth-source`, `--net-worth-note`.

Fail-closed: the caller supplies subject, `event_date` (YYYY-MM-DD, not `posted_at`), category, and ≥2 verified official news or official government / news-org social cite URLs. The poster handle is never copied as the subject. The post date is never copied as the event date. Cites are not invented. Unofficial or commentary social is extra only — it is not a cite. When a person is created or annotated, a local Wikimedia or official `.gov` portrait is attached under `/media/people/` if an eligible still already exists. Photos are not invented. An existing gold photo is not overwritten. A missing still stays blank (initials / em dash). Net worth is filled from a published Forbes or Bloomberg estimate when the caller supplies the integer USD amount and that source URL. Figures are not invented. If none, `net_worth_usd` stays null and `net_worth_note` records that no published Forbes/Bloomberg estimate was located. Existing gold net-worth is not overwritten.

Allowed `--category` values: `firings`, `resignations`, `government_stepdowns`, `death_celebrity`, `death_official`, `death_ceo`, `arrests`, `corona_comms`, `indictment_civilian`, `indictment_non_civilian`. `corona_comms` is an extra KEEP tag on the unique person card — not a post table. `dog_comms` stays a catalog page of official government posts, not a person row. If civilian versus not is unclear, do not guess — leave the source post on Unsorted.

Identity is unique: id/slug or a normalized name matches one person. A new KEEP kind is attached as an event on that person. A second person row is not created. Each event is fail-closed on its own: calendar `event_date` (YYYY-MM-DD, never `posted_at`) plus ≥2 official news or official gov/news-org social cites. `event_date` is Last Day when present, otherwise Announced; store `announced_date` only when it differs. Both empty → do not insert. Wikipedia is not a cite. Unofficial social is extra only. Unique `(person_id, kind)` — one firing, not two; arrest + indictment and death + prior resignation are different kinds on the same person. One event, one kind: do not tag the same indictment as both civilian and non-civilian. If that classification is unclear, leave the source un-tagged. Gold annotate-only: name, existing event fields, cites, photo, and net-worth are not overwritten. Optional `people.birth_date` is a calendar date when present; gold rows are not backfilled here. Age at death is whole years from `birth_date` to the death event date. A missing birth date is not age-filterable. List pages show people who have that tag. `/corona-comms` lists every person with that tag; there is no child split. `/deaths` and `/indictments` stay parent unions; children stay filters. Dashboard attributes are the event fields: nullable `position`, `organization`, `country`, `branch`, and `comments`. Empty stays empty. Country and branch are not guessed from the name. Reason maps to existing KEEP kinds only (`firings`, `resignations`, `government_stepdowns` by official identity, `death_*` fail-closed classify; unknown → no kind). `/dashboard` slices query those same event columns — no parallel mapping table. Trends use each event's calendar `event_date`. [resignation.info](https://www.resignation.info/) is a lead source for those historical fields; it is not a cite. The source post stays on Unsorted (it is not deleted). The command is idempotent on Postgres and on the file store. It does not write `data/seed.json`.

After insert or promote, the host process is not done until live HTML shows the row on the category **list** page and the person **detail** page (`/people/:id`). Health counts (`/health`, `/api/health`) are not enough. `/deaths` is an empty index; death rows list on `/deaths/celebrities`, `/deaths/officials`, or `/deaths/ceos`. `/indictments` is an empty index; indictment rows list on `/indictments/civilians` or `/indictments/non-civilians`. The process scripts run this display check and print `display ok list=… detail=…`.

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

Host-side hook (scratch directory, two turns, one envelope): look up official/news/gov cites, then apply `add-process` with the envelope flags. The catalog UI does not invent cites.

People: named subject, calendar `event_date` (never copied from `posted_at`), catalog category (including `arrests`, `corona_comms`, `indictment_civilian`, and `indictment_non_civilian`), and ≥2 verified official news or official government / news-org social URLs. Unofficial or commentary social is extra only, not a cite. `/add` may include an optional Wikimedia or official `.gov` portrait URL and an optional published Forbes or Bloomberg net-worth pair; ineligible URLs are rejected at queue. At process time the same create/annotate helper attaches a local file under `/media/people/` when that eligible still exists, and fills net worth when a published Forbes/Bloomberg estimate is supplied. Photos and figures are not invented. Existing gold photos and gold net-worth are not overwritten. A missing still stays blank. A missing estimate leaves USD null with a short note. If the request `hint_url` matches one parked Unsorted source post, the same fail-closed insert helper is reused. The Unsorted classify walk (`import-posts` / `promote`) stays a separate path. Gold rows stay annotate-only (name, existing event fields, cites, photos, and net-worth are not overwritten). If the person already exists, add-process attaches the new kind. The committed seed stays 72 people; a live store may already have 73.

Dog comms: official government handle or official post URL, plus date. Unofficial or commentary social is rejected. Snapshot text/media is copied only if it is already in the local store. The command does not fetch X.

After the row is applied, the host process is not done until live HTML shows it on the list page and the detail page. Health counts are not enough. `/deaths` is an empty index; celebrities, officials, and CEOs are the death list pages. `/indictments` is an empty index; civilians and non-civilians are the indictment list pages. `/corona-comms` lists every person with that tag and has no child split. Dog comms use `/dog-comms` and `/dog-comms/:id`. The process script prints `display ok list=… detail=…` when that check passes.

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
