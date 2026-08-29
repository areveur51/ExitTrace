# ExitTrace

Sourced tracker of public-role exits since 2017 — firings, resignations, government step-downs, arrests, and deaths of celebrities, officials, and CEOs — plus official government posts about dogs (or that include a dog in the image). Neutral record. Two published news citations on every person row. Unidentified public source posts live on Unsorted. Not exhaustive.

**Repo:** [https://github.com/areveur51/ExitTrace](https://github.com/areveur51/ExitTrace)

## Quick start

Needs [Node.js 20+](https://nodejs.org/).

```bash
git clone https://github.com/areveur51/ExitTrace.git
cd ExitTrace
npm install
./exittracectl.sh start
```

Or `npm start`. Open [http://127.0.0.1:5220](http://127.0.0.1:5220).

```bash
npm test
./exittracectl.sh status
./exittracectl.sh stop
```

The committed `data/seed.json` is enough to click through every page. When `DATABASE_URL` is unset the app uses that JSON file store. Promoted people that are not in the seed stay in the file store across restarts.

## Optional Postgres

Create a database named `exittrace`, then:

```bash
# placeholder — use your own user, password, and host
export DATABASE_URL=postgres://USER:PASS@127.0.0.1:5433/exittrace
psql "$DATABASE_URL" -f scripts/bootstrap-db.sql
node scripts/import-seed.mjs
npm start
```

`scripts/bootstrap-db.sql` is `CREATE TABLE IF NOT EXISTS` and safe to re-run. Do not commit `.env`. Copy `.env.example` only if you need to change defaults.

## Promote one Unsorted post

Fail-closed: named subject, calendar `event_date`, catalog category, and two or more `http(s)` cite URLs you already have. Does not invent cites or a portrait. Leaves the source post on Unsorted.

```bash
node scripts/promote-source-post.mjs \
  --source-url https://example.com/n/arrest-1 \
  --subject "Casey Vale" \
  --event-date 2024-06-15 \
  --category arrests \
  --cite-url https://www.example.com/news/casey-vale-held \
  --cite-url https://www.example.net/world/casey-vale-arrest
```

If that person already exists, only new cites are attached. See `docs/DATA.md`.

## Add a person or official dog-comm

`/add` queues a request. It does not invent cites. A host process looks up published sources, supplies cite URLs, and applies the row.

```bash
# after look-up, apply the next pending request:
node scripts/process-add-request.mjs --next \
  --cite-url https://www.example.com/news/casey-vale-held \
  --cite-url https://www.example.net/world/casey-vale-arrest \
  --event-date 2024-06-15 \
  --category arrests
# or:
./exittracectl.sh add-process --id ar-… --cite-url … --cite-url …
```

Fail-closed: people need a named subject, a calendar event date, and two or more published-news or official government / news-org social URLs. Random social does not count. Dog comms need an official government handle, official post URL, and date. If the person or dog already exists, only extra cites are attached. Does not write `data/seed.json`.

## Data pack

Portraits and dog-comm stills live under `media/` and are served at `/media/`. A zip of the seed plus media is published on GitHub Releases — it is not fetched when you open `/downloads`.

```bash
./scripts/fetch-data.sh
# or pack a zip locally (not committed):
./scripts/pack-data.sh
```

Releases:

- moving tag `data-latest`
- dated tag `data-YYYYMMDD`
- assets `exittrace-data-YYYYMMDD.zip` and `.sha256`

## What is in the seed

| Page | What it lists |
|--|--|
| `/firings` | Public-role dismissals (identified people) |
| `/resignations` | Announced resignations (identified people) |
| `/government` | Officials leaving a government post (identified people) |
| `/arrests` | Public-role arrests (identified people) |
| `/deaths` | Index of identified death lists (celebrities / officials / CEOs) |
| `/deaths/celebrities` | Deaths of public figures in arts, sport, and entertainment |
| `/deaths/officials` | Deaths of officials and heads of state |
| `/deaths/ceos` | Deaths of chief executives and controlling founders |
| `/unsorted` | Public source posts not yet identified (classify queue) |
| `/dog-comms` | Official government X posts about dogs, stored locally |
| `/add` | Queue a person name or official government dog-comm |
| `/downloads` | How the GitHub Release zip is named |

Each person row has name, event date, death date (death categories only), a stored Wikimedia or official `.gov` photo or initials, two news sources, and a published-estimate net worth (Forbes, Bloomberg, or official disclosure) or blank. Source posts on Unsorted keep the original public URL(s), post text, poster handle (reporter/poster, not the subject), posted date, and a category guess. Subject, event date, photo, and net worth may be an em dash until those fields are filled in. Posted date is never copied into event date.

Identified people use the same list card on every people page: portrait thumb, name, and one date · category · net worth (or em dash). Source posts that still render as posted (em dash title, poster handle) live only on Unsorted. Person, unsorted, and dog-comm lists paginate (`?page=`, 10 rows per page, newest event first). The local web UI uses a terminal-inspired chrome: a pixel wordmark and catalog search on the home page, row lists with a result count, and a tap-friendly footer of catalog keys. Phones and tablets keep 44px targets. Open a row for the person, source post, or dog-comm detail (net-worth estimate or em dash, sources, stored snapshot).

Dog comms store the post text, poster handle, date, and a local still when one is freely licensed. The source URL is a citation only. Tap a dog-comm row to open the stored snapshot. The pages do not load `widgets.js` and do not fetch X, Wikimedia, or news sites at view time.

## HTTP

| | |
|--|--|
| `GET /health` | HTML health page |
| `GET /api/health` | `{ ok, ready, backend, people, dog_comms, source_posts }` |
| `GET /search?q=` | Local catalog search (people keep person cards; posted hits group under Unsorted) |
| `GET /people/:id` | One person row |
| `GET /posts/:id` | One parked source post |
| `GET /dog-comms/:id` | One stored dog-comm snapshot |
| `GET /add` | Queue a person or official dog-comm |
| `POST /add` | Store a pending add request |
| `GET /api/people?category=` | Seeded person rows |
| `GET /api/source-posts?category=` | Parked public posts |
| `GET /api/dog-comms` | Stored official posts |
| `GET /media/...` | Files on disk |

## Configuration

| Variable | Default | Purpose |
|--|--|--|
| `PORT` | `5220` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `MEDIA_DIR` | `./media` | Stored stills |
| `DATA_DIR` | `./data` | Seed / file store |
| `DATABASE_URL` | unset | Optional Postgres (`postgres://USER:PASS@127.0.0.1:5433/exittrace`) |

## Layout

```
app/server.mjs              HTTP + pages
app/lib/store.mjs           Postgres or file fallback
data/seed.json              portable import
media/                      portraits and dog-comm stills
scripts/bootstrap-db.sql    CREATE TABLE IF NOT EXISTS
scripts/import-source-posts.mjs  JSONL upsert of public source posts
scripts/promote-source-post.mjs  promote one Unsorted post to a person row
scripts/process-add-request.mjs  apply one queued add request (cites from caller)
scripts/pack-data.sh        zip for GitHub Releases
scripts/fetch-data.sh       unpack a published zip
exittracectl.sh             start | stop | status | seed | import-posts | promote | add-process | pack
```

## License

MIT.
