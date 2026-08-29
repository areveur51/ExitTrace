# ExitTrace

Sourced tracker of public-role exits since 2017 — firings, resignations, government step-downs, and deaths of celebrities, officials, and CEOs — plus official government posts about dogs (or that include a dog in the image). Neutral record. Two published news citations on every person row. Not exhaustive.

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

The committed `data/seed.json` is enough to click through every page. When `DATABASE_URL` is unset the app uses that JSON file store.

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
| `/firings` | Public-role dismissals |
| `/resignations` | Announced resignations |
| `/government` | Officials leaving a government post |
| `/deaths/celebrities` | Deaths of public figures in arts, sport, and entertainment |
| `/deaths/officials` | Deaths of officials and heads of state |
| `/deaths/ceos` | Deaths of chief executives and controlling founders |
| `/dog-comms` | Official government X posts about dogs, stored locally |
| `/downloads` | How the GitHub Release zip is named |

Each person row has name, event date, death date (death categories only), a stored Wikimedia or official `.gov` photo or initials, two news sources, and a published-estimate net worth (Forbes, Bloomberg, or official disclosure) or blank.

Person and dog-comm lists paginate (`?page=`, 10 rows per page, newest event first). The local web UI uses a terminal-inspired chrome: a pixel wordmark and catalog search on the home page, row lists with a result count, and a tap-friendly footer of catalog keys. Phones and tablets keep 44px targets. Open a row for the person or dog-comm detail (metadata box, synopsis, and a sources pane).

Dog comms store the post text, poster handle, date, and a local still when one is freely licensed. The still sits in the metadata photo slot like a portrait. The source URL is a citation in the same `ol.sources` list as a person's news links. The pages do not load `widgets.js` and do not fetch X, Wikimedia, or news sites at view time.

## HTTP

| | |
|--|--|
| `GET /health` | HTML health page |
| `GET /api/health` | `{ ok, ready, backend, people, dog_comms }` |
| `GET /search?q=` | Local catalog search |
| `GET /people/:id` | One person row |
| `GET /dog-comms/:id` | One dog-comm detail (metadata + sources) |
| `GET /api/people?category=` | Seeded person rows |
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
scripts/pack-data.sh        zip for GitHub Releases
scripts/fetch-data.sh       unpack a published zip
exittracectl.sh             start | stop | status | seed | pack
```

## License

MIT.
