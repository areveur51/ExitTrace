#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PROMOTE_CATEGORY_IDS } from "../app/lib/categories.mjs";
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
const { dataDir } = resolveRoot(ROOT);
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
  [--summary "…"] [--role "…"] [--photo <path>] [--photo-credit "…"]

Promote one Unsorted source post into an identified person row.
Requires a named subject, a calendar event_date (not posted_at), a catalog
category, and at least ${CITE_FLOOR} http(s) cite URLs supplied by the
caller. Does not invent cites or a portrait. Leaves the source post on Unsorted.

If the same person already exists (id/slug or same subject + event_date ±3 days),
new cites are attached only — name, date, category, and existing cites stay put.

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
    else if (arg === "--photo") out.photo = take();
    else if (arg === "--photo-credit") out.photo_credit = take();
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
await closeStore();
