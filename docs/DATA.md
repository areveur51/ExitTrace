# Data pack

The committed `data/seed.json` is the portable gold import (identified people and official dog-comms). `media/` holds stored portraits, dog-comm stills, and red-folder-comm stills. List pages paint derived local thumbs under `media/thumbs/`; seed `photo` / `still` paths stay the full local file. Public source posts are a separate store (`source_posts`) and are not written into the gold seed. Parked posts keep a category guess for later classify and list on `/unsorted`, not on the people pages. `red_folder_comms` is a catalog page of stored posts (twin of `dog_comms`), not a person KEEP tag. Existing lab harvest rows stay annotate-only — this repo does not invent, delete, or rewrite those rows.

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

Fail-closed: the caller supplies subject, `event_date` (YYYY-MM-DD, not `posted_at`), category, and ≥2 verified official news or official government / news-org social cite URLs. A **new person insert** also requires country of origin (person-level; never guessed; never collapsed into `event.country`), position, organization, and reason of event (maps onto event `comments` / harvest `reason`; dashboard Reason stays KEEP tags). `birth_date` is optional: unknown stores as SQL NULL, never `""`. Do not invent a date from age or month-year. `age_at_event` and dashboard Counts by Age stay fail-closed when birth date is null. `event.country` is where the event happened if it differs from origin. `branch` stays nullable unless the insert is military (`military=true`); then the existing event `branch` field is required. Do not invent a military KEEP kind. Dashboard `/dashboard/branch` ranks unique-person cards from that same stored field. Do not guess branch. Existing rows are not backfilled here. The poster handle is never copied as the subject. The post date is never copied as the event date. Cites are not invented. Unofficial or commentary social is extra only — it is not a cite. When a person is created or annotated, a local Wikimedia or official `.gov` portrait is attached under `/media/people/` if an eligible still already exists. Photos are not invented. An existing gold photo is not overwritten. A missing still stays blank (initials / em dash). Net worth is filled from a published Forbes or Bloomberg estimate when the caller supplies the integer USD amount and that source URL. Figures are not invented. If none, `net_worth_usd` stays null and `net_worth_note` records that no published Forbes/Bloomberg estimate was located. Existing gold net-worth is not overwritten.

Allowed `--category` values: `firings`, `resignations`, `government_stepdowns`, `death_celebrity`, `death_official`, `death_ceo`, `arrests`, `corona_comms`, `indictment_civilian`, `indictment_non_civilian`. `corona_comms` is an extra KEEP tag on the unique person card — not a post table. `missing_kids`, `human_smuggling`, `fugitives`, `cybercrime`, `drug_trafficking`, `violent_crime`, and `fraud` are operation filter tags, not person KEEP kinds. `dog_comms` and `red_folder_comms` stay catalog pages of stored posts, not person rows. Central Casting lists unique person KEEP cards at `/central-casting`. Membership is cite URLs on that existing person, not a new KEEP kind and not a clip card. If civilian versus not is unclear, do not guess — leave the source post on Unsorted.

Identity is unique: id/slug or a normalized name matches one person. A new KEEP kind is attached as an event on that person. A second person row is not created. Each event is fail-closed on its own: calendar `event_date` (YYYY-MM-DD, never `posted_at`) plus ≥2 official news or official gov/news-org social cites. `event_date` is Last Day when present, otherwise Announced; store `announced_date` only when it differs. Both empty → do not insert. Wikipedia is not a cite. Unofficial social is extra only. Unique `(person_id, kind)` — one firing, not two; arrest + indictment and death + prior resignation are different kinds on the same person. One event, one kind: do not tag the same indictment as both civilian and non-civilian. If that classification is unclear, leave the source un-tagged. `unsealed` is a nullable boolean on those two indictment events only (`person_events.unsealed`, mirrored on `people.events[]`). It is not a KEEP kind and not a second person card. Set it true only when a cite URL/title or the event comments/reason/summary clearly states the indictment was unsealed or made public. Sealed, negated, or unclear stays NULL. A bare flag is not evidence. Gold annotate-only: a stored true is not cleared. Lists stay on `/indictments`, `/indictments/civilians`, and `/indictments/non-civilians` with `?tags=unsealed`. There is no `/indictments/unsealed` route. `scripts/annotate-unsealed-indictments.mjs` is a dry-run helper that fills NULL to true when stored cite text already says so. It does not rewrite other person fields, operations, dog rows, or stills, and it does not write `data/seed.json`. Gold annotate-only: name, existing event fields, cites, photo, and net-worth are not overwritten. Optional `people.birth_date` and `people.country_of_origin` are calendar / origin fields when present; gold rows are not backfilled here. `age_at_event` is whole years from `birth_date` to that tag's `event_date`, stored on the event and used by dashboard Counts by Age. A missing birth date or event date is not age-filterable and does not enter a band. KEEP category lists do not carry an age-range control. List pages show people who have that tag. `/corona-comms` lists every person with that tag; there is no child split. `/deaths` and `/indictments` stay parent unions; children stay filters. `/group-operations` lists every operation; `/group-operations/missing-kids` filters by the signed tag. Operations are not people. Dashboard attributes are the event fields: nullable `position`, `organization`, `country`, `branch`, and `comments`. Empty stays empty. Country and branch are not guessed from the name. Reason maps to existing KEEP kinds only (`firings`, `resignations`, `government_stepdowns` by official identity, `death_*` fail-closed classify; unknown → no kind). `/dashboard` slices query those same event columns — no parallel mapping table. For death kinds, organization / position / branch / country count the death event’s occupation only (current at death), not `people.career` history rows. Non-death kinds use that event’s own attrs. Optional person-level `career` / service history (`title`, `organization`, `branch`, `start_year`, `end_year`) is detail-only; a career row that matches a KEEP event’s position/organization is omitted from the detail section (the tag stays the occupation at event). Years are not invented; gold rows are not backfilled. Trends use each event's calendar `event_date`. [resignation.info](https://www.resignation.info/) is a lead source for those historical fields; it is not a cite. The source post stays on Unsorted (it is not deleted). The command is idempotent on Postgres and on the file store. It does not write `data/seed.json`.

`death_unconfirmed` is a KEEP kind and is not in `DEATH_KEEP_IDS`. It is not a promote `--category` and leads are never auto-classified into it. Do not use `death_celebrity`, `death_official`, or `death_ceo` for an unconfirmed claim. It may park on an Admiral-named claim cite. `event_date` stays NULL unless that cite states a calendar `YYYY-MM-DD` (NULL is allowed for this kind only). `death_date`, cause, and location are not invented and stay NULL. The event `comments` field stores the footnote, for example `Trump Truth Social claim; no media confirmation yet.` The asterisk is the UI label (`Death*` on the person card, `Unconfirmed*` in the nav), not a column. Confirmed death counts, `/deaths`, `/deaths/celebrities`, `/deaths/officials`, `/deaths/ceos`, and death dashboard slices stay `DEATH_KEEP_IDS` only. `/deaths/unconfirmed` lists this kind. One person, one card: the claim is another event on that person. Upgrade to a confirmed death kind still needs at least two official news or official gov/news-org cites, a calendar date, and CLEAR. This repo does not apply that upgrade and does not insert people for it.

After insert or promote, the host process is not done until live HTML shows the row on the category **list** page and the person **detail** page (`/people/:id`). Health counts (`/health`, `/api/health`) are not enough. `/deaths` is an empty index; death rows list on `/deaths/celebrities`, `/deaths/officials`, or `/deaths/ceos`. `/deaths/unconfirmed` lists unconfirmed claims and is not part of that confirmed union. `/indictments` is an empty index; indictment rows list on `/indictments/civilians` or `/indictments/non-civilians`. `/group-operations` lists every operation; tagged rows also list on `/group-operations/missing-kids`, `/group-operations/human-smuggling`, `/group-operations/fugitives`, `/group-operations/cybercrime`, `/group-operations/drug-trafficking`, `/group-operations/violent-crime`, or `/group-operations/fraud`. Operation detail is `/operations/:id`. Dog comms use `/dog-comms` and `/dog-comms/:id`. Red-folder comms use `/red-folder-comms` and `/red-folder-comms/:id`. Central Casting lists unique persons on `/central-casting` (no sense filter, no child routes) and opens the existing person detail. `/central-casting-comms` redirects there. The process scripts run this display check and print `display ok list=… detail=…`.

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

People: named subject, calendar `event_date` (never copied from `posted_at`), catalog category (including `arrests`, `corona_comms`, `indictment_civilian`, and `indictment_non_civilian`), and ≥2 verified official news or official government / news-org social URLs. Group operations are a separate operation card, not a person KEEP kind. New person insert is also fail-closed on country of origin, position, organization, and reason of event (`comments` / `reason`). `birth_date` is optional (SQL NULL when unknown; never invent from age or month-year). Military inserts also require `branch`. Unofficial or commentary social is extra only, not a cite. `/add` may include an optional Wikimedia or official `.gov` portrait URL and an optional published Forbes or Bloomberg net-worth pair; ineligible URLs are rejected at queue. At process time the same create/annotate helper attaches a local file under `/media/people/` when that eligible still exists, and fills net worth when a published Forbes/Bloomberg estimate is supplied. Photos and figures are not invented. Existing gold photos and gold net-worth are not overwritten. A missing still stays blank. A missing estimate leaves USD null with a short note. If the request `hint_url` matches one parked Unsorted source post, the same fail-closed insert helper is reused. The Unsorted classify walk (`import-posts` / `promote`) stays a separate path. Gold rows stay annotate-only (name, existing event fields, cites, photos, and net-worth are not overwritten). If the person already exists, add-process attaches the new kind. The committed seed stays 72 people; a live store may already have 73.

Dog comms: official government handle or official post URL, plus date. Unofficial or commentary social is rejected. Snapshot text/media is copied only if it is already in the local store. The command does not fetch X.

After the row is applied, the host process is not done until live HTML shows it on the list page and the detail page. Health counts are not enough. `/deaths` is an empty index; celebrities, officials, and CEOs are the death list pages. `/indictments` is an empty index; civilians and non-civilians are the indictment list pages. `/group-operations` lists every operation; missing-kids, human-smuggling, fugitives, cybercrime, drug-trafficking, violent-crime, and fraud are the tagged filters. Operation detail is `/operations/:id`. Named children are not stored. Victim and arrest counts stay blank unless a cite states them. `/corona-comms` lists every person with that tag and has no child split. Dog comms use `/dog-comms` and `/dog-comms/:id`. Red-folder comms use `/red-folder-comms` and `/red-folder-comms/:id`. Central Casting uses `/central-casting` and the existing person detail `/people/:id`. The process script prints `display ok list=… detail=…` when that check passes.

Idempotent. Does not write `data/seed.json`.

## Red-folder publication (lab)

`red_folder_comms` is a twin of `dog_comms`. Fresh envs create it from `scripts/bootstrap-db.sql`. Lab already has the harvest table; do not invent, delete, or rewrite those rows from this repo.

To replicate later inserts, the lab publisher adds the table (idempotent):

```bash
psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-red-folder-comms-publication.sql
```

That is `ALTER PUBLICATION exittrace_lab_pub ADD TABLE red_folder_comms` when the table is not already in the publication.

On the subscriber, only if the relation is missing after that ADD:

```sql
ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION WITH (copy_data = false);
```

Never omit `copy_data = false`. Never `copy_data=true`. Media stills (`media/red-folder-comms/` and screenshots under `media/screenshots/red-folder-comms/`, including `{id}/support/{n}/`) travel on the existing media-delta rsync path. Gap-upsert published tables stay `people`, `dog_comms`, `operations`, optional `categories` — this restore does not upsert harvest `red_folder_comms` rows.

## Central Casting publication (lab)

`/central-casting` supersedes the KIND_COMMS clip list. It lists one card per existing person KEEP. Membership is `people.central_casting`, a JSON array of cite URLs, with no sense split. Harvest rows in `central_casting_comms` carry `person_id` and render on the person detail with the same masonry as red-folder comms: cite list, post summary, X link, and supportive media. Fresh envs create the table from `scripts/bootstrap-db.sql`. This repo does not seed rows.

Cite gate: ongoing KEEP is official/gov/news-org plus quote-chain standing. All X media stays on the detail page; a screenshot that misses the local allowlist is omitted.

```bash
psql "$LAB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/add-central-casting-comms-publication.sql
```

That is `ALTER PUBLICATION exittrace_lab_pub ADD TABLE central_casting_comms` when the table is not already in the publication. Subscriber refresh stays `WITH (copy_data = false)`. Never `copy_data=true`. Stills live under `media/central-casting-comms/` and screenshots under `media/screenshots/central-casting-comms/` (including `{id}/support/{n}/`) on the existing media-delta path. There is no `?sense=` filter and no child route. `/central-casting-comms` redirects to `/central-casting`.

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
