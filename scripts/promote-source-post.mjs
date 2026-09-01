#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PROMOTE_CATEGORY_IDS } from "../app/lib/categories.mjs";
import { DisplayError, assertDisplayed } from "../app/lib/display-check.mjs";
import { databaseUrl, loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import { CITE_FLOOR, PromoteError } from "../app/lib/promote.mjs";
import {
  closeStore,
  ensureSchema,
  getMemory,
  getPool,
  hydrateFileMemory,
  loadSeedFile,
  promoteSourcePost,
  writeFileStore,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));
const { dataDir, mediaDir } = resolveRoot(ROOT);
if (!process.env.MEDIA_DIR) process.env.MEDIA_DIR = mediaDir;
const seedPath = path.join(dataDir, "seed.json");
const bootstrapSql = fs.readFileSync(
  path.join(ROOT, "scripts", "bootstrap-db.sql"),
  "utf8",
);

function usage(exitCode = 0) {
  console.log(`Usage: node scripts/promote-source-post.mjs \\
  --source-url <url> | --id <sp-…> \\
  --subject "<named person>" \\
  --event-date YYYY-MM-DD \\
  --category <${PROMOTE_CATEGORY_IDS.join("|")}> \\
  --cite-url <https://…> --cite-url <https://…> \\
  [--summary "…"] [--role "…"] [--photo <Wikimedia|.gov URL or /media/people/…>] [--photo-credit "…"] \\
  [--net-worth <USD>] [--net-worth-source <Forbes|Bloomberg URL>] [--net-worth-note "…"]

Promote one Unsorted source post into an identified person row.
Requires a named subject, a calendar event_date (not posted_at), a catalog
category, and at least ${CITE_FLOOR} http(s) cite URLs supplied by the
caller. Does not invent cites or a portrait. Attaches a local Wikimedia or
official-gov still under /media/people/ when one already exists. Does not
overwrite an existing gold photo. Missing still stays blank. Fills net
worth from a published Forbes or Bloomberg estimate when one exists.
Does not invent a figure or overwrite existing gold net-worth. If none,
usd stays null with a short missing-estimate note. Leaves the
source post on Unsorted.

If the same person already exists (id/slug or normalized name), the new KEEP
kind is attached as an event. A second person row is not created. Existing
name, event fields, cites, photo, and net-worth stay put (gold annotate-only).
Each event is fail-closed on its own calendar event_date plus two official cites.

After the row is written, the host process is not done until live HTML
shows it on the list page and the detail page. Health counts are not
enough. /deaths is an empty index — death rows list on
/deaths/celebrities, /deaths/officials, or /deaths/ceos.
/indictments is an empty index — indictment rows list on
/indictments/civilians or /indictments/non-civilians.

Idempotent. Writes Postgres when DATABASE_URL is set; otherwise the file store.
Does not write data/seed.json.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { cite_urls: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = () => {
      if (next === undefined) {
        throw new PromoteError(`missing value for ${arg}`, "bad_args");
      }
      i += 1;
      return next;
    };
    if (arg === "-h" || arg === "--help") usage(0);
    else if (arg === "--source-url") out.source_url = take();
    else if (arg === "--id") out.id = take();
    else if (arg === "--subject") out.subject = take();
    else if (arg === "--event-date") out.event_date = take();
    else if (arg === "--category") out.category = take();
    else if (arg === "--cite-url" || arg === "--cite") out.cite_urls.push(take());
    else if (arg === "--summary") out.summary = take();
    else if (arg === "--role") out.role = take();
    else if (arg === "--organization") out.organization = take();
    else if (arg === "--country") out.country = take();
    else if (arg === "--branch") out.branch = take();
    else if (arg === "--photo") out.photo = take();
    else if (arg === "--photo-credit") out.photo_credit = take();
    else if (arg === "--net-worth" || arg === "--net-worth-usd") out.net_worth_usd = take();
    else if (arg === "--net-worth-source") out.net_worth_source = take();
    else if (arg === "--net-worth-note") out.net_worth_note = take();
    else {
      throw new PromoteError(`unknown argument: ${arg}`, "bad_args");
    }
  }
  return out;
}

const argv = process.argv.slice(2);
if (!argv.length) usage(1);

let args;
try {
  args = parseArgs(argv);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (databaseUrl()) {
  const pool = await getPool();
  await ensureSchema(pool, bootstrapSql);
} else {
  const seed = loadSeedFile(seedPath);
  hydrateFileMemory(dataDir, seed);
}

let result;
try {
  result = await promoteSourcePost(args);
} catch (err) {
  console.error(err instanceof PromoteError ? err.message : err);
  await closeStore();
  process.exit(1);
}

if (!databaseUrl()) {
  writeFileStore(dataDir, getMemory());
}

console.log(
  `promote ${result.action} person=${result.person.id} people=${result.people} cites=${result.person.sources.length} added=${result.added_cites} source_post=${result.source_post.id} unsorted`,
);
try {
  const shown = await assertDisplayed(result);
  console.log(`display ok list=${shown.list} detail=${shown.detail}`);
} catch (err) {
  const message = err instanceof DisplayError ? err.message : err;
  console.error(message);
  await closeStore();
  process.exit(1);
}
await closeStore();
