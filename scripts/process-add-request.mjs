#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AddError, processAddRequest } from "../app/lib/add-request.mjs";
import { DisplayError, assertDisplayed } from "../app/lib/display-check.mjs";
import { CITE_FLOOR, PromoteError } from "../app/lib/promote.mjs";
import { databaseUrl, loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import {
  closeStore,
  ensureSchema,
  getMemory,
  getPool,
  hydrateFileMemory,
  loadSeedFile,
  persistAddRequests,
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
  console.log(`Usage: node scripts/process-add-request.mjs --id <ar-…> | --next
  [--cite-url <https://…>] [--cite-url <https://…>]
  [--subject "…"] [--event-date YYYY-MM-DD] [--category <id>]
  [--source-url <https://…>] [--handle @Official] [--posted-at YYYY-MM-DD]
  [--text "…"] [--account-name "…"] [--still <path>] [--still-credit "…"]
  [--photo <Wikimedia|.gov URL or /media/people/…>] [--photo-credit "…"]
  [--net-worth <USD>] [--net-worth-source <Forbes|Bloomberg URL>] [--net-worth-note "…"]

Host-side process hook (scratch directory, two turns, one envelope):
  look up official/news/gov cites, then apply this command with the envelope
  flags. The catalog UI does not invent cites.

Fail-closed:
  people need subject + event_date + at least ${CITE_FLOOR} verified
  official news or official gov/news-org social cite URLs.
  Do not invent cites. Do not copy posted_at into event_date.
  Unofficial or commentary social is extra only, not a cite.
  Attach a local Wikimedia or official-gov portrait under /media/people/
  when an eligible still exists. Do not invent a photo. Do not overwrite
  an existing gold photo. Missing still stays blank.
  Fill net_worth_usd / note / source from a published Forbes or Bloomberg
  estimate when one exists. Do not invent a figure. If none, usd stays
  null and the note says no published Forbes/Bloomberg estimate was
  located. Do not overwrite existing gold net-worth.
  dog comms need an official government handle or official post URL, plus date.

If the person already exists (id/slug or normalized name), the new KEEP kind
is attached as an event. A second person row is not created. Each event is
fail-closed on its own calendar date plus two official cites. Wikipedia is
not a cite. Gold name, event fields, cites, photo, and net-worth stay put.

The Unsorted classify walk stays a separate path (import-posts / promote).
If a queued hint URL happens to match one parked post, the same fail-closed
insert helper is reused. Gold rows are annotate-only.

After a person or dog is written, the host process is not done until live
HTML shows the row on the list page and the detail page. Health counts
are not enough. /deaths is an empty index — death rows list on
/deaths/celebrities, /deaths/officials, or /deaths/ceos.
/indictments is an empty index — indictment rows list on
/indictments/civilians or /indictments/non-civilians.

Idempotent. Writes Postgres when DATABASE_URL is set; otherwise the file store.
Does not write data/seed.json.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { cite_urls: [], next: false, id: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = () => {
      if (next === undefined) {
        throw new AddError(`missing value for ${arg}`, "bad_args");
      }
      i += 1;
      return next;
    };
    if (arg === "-h" || arg === "--help") usage(0);
    else if (arg === "--id") out.id = take();
    else if (arg === "--next") out.next = true;
    else if (arg === "--cite-url" || arg === "--cite") out.cite_urls.push(take());
    else if (arg === "--subject") out.subject = take();
    else if (arg === "--event-date") out.event_date = take();
    else if (arg === "--category") out.category = take();
    else if (arg === "--source-url") out.source_url = take();
    else if (arg === "--hint-url") out.hint_url = take();
    else if (arg === "--handle") out.handle = take();
    else if (arg === "--posted-at") out.posted_at = take();
    else if (arg === "--text") out.text = take();
    else if (arg === "--account-name") out.account_name = take();
    else if (arg === "--still") out.still = take();
    else if (arg === "--still-credit") out.still_credit = take();
    else if (arg === "--summary") out.summary = take();
    else if (arg === "--role") out.role = take();
    else if (arg === "--photo") out.photo = take();
    else if (arg === "--photo-credit") out.photo_credit = take();
    else if (arg === "--net-worth" || arg === "--net-worth-usd") out.net_worth_usd = take();
    else if (arg === "--net-worth-source") out.net_worth_source = take();
    else if (arg === "--net-worth-note") out.net_worth_note = take();
    else {
      throw new AddError(`unknown argument: ${arg}`, "bad_args");
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

if (!args.id && !args.next) usage(1);

if (databaseUrl()) {
  const pool = await getPool();
  await ensureSchema(pool, bootstrapSql);
} else {
  const seed = loadSeedFile(seedPath);
  hydrateFileMemory(dataDir, seed);
}

const overlay = { ...args };
delete overlay.id;
delete overlay.next;

let result;
try {
  result = await processAddRequest({
    id: args.id || undefined,
    next: args.next,
    overlay,
  });
} catch (err) {
  const message =
    err instanceof AddError || err instanceof PromoteError ? err.message : err;
  console.error(message);
  if (!databaseUrl()) {
    persistAddRequests(dataDir);
    writeFileStore(dataDir, getMemory());
  }
  await closeStore();
  process.exit(1);
}

if (!databaseUrl()) {
  persistAddRequests(dataDir);
  writeFileStore(dataDir, getMemory());
}

const target = result.person
  ? `person=${result.person.id} people=${result.people}`
  : `dog=${result.dog?.id || ""} dog_comms=${result.dog_comms}`;
console.log(
  `add-process ${result.action} ${target} cites=${result.person?.sources?.length || 0} added=${result.added_cites || 0} request=${result.request.id}`,
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
