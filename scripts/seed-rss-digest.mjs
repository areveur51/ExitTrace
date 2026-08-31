#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { seedRssDigest, selectDigestFeeds } from "../app/lib/digest.mjs";
import { databaseUrl, loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import {
  closeStore,
  ensureSchema,
  getMemory,
  getPool,
  hydrateFileMemory,
  importSeed,
  listPeople,
  loadSeedFile,
  persistAddRequests,
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
  console.log(`Usage: node scripts/seed-rss-digest.mjs
  [--slice all|current|historical] [--jsonl path] [--dry-run] [--no-queue]

Host-side public RSS digest. Fetches official news-org and .gov feeds,
parks Unsorted name leads, and queues /add name leads. Digest items are
not cites. Does not promote or add-process. Idempotent. No batch cap on
parking leads. No secrets. Does not write data/seed.json.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {
    slice: "all",
    jsonl: "",
    dry_run: false,
    queue: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = () => {
      if (next === undefined) {
        throw new Error(`missing value for ${arg}`);
      }
      i += 1;
      return next;
    };
    if (arg === "-h" || arg === "--help") usage(0);
    else if (arg === "--slice") out.slice = take();
    else if (arg === "--jsonl") out.jsonl = take();
    else if (arg === "--dry-run") out.dry_run = true;
    else if (arg === "--no-queue") out.queue = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["all", "current", "historical"].includes(out.slice)) {
    throw new Error("slice must be all, current, or historical");
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (databaseUrl()) {
  const pool = await getPool();
  await ensureSchema(pool, bootstrapSql);
  await importSeed(pool, loadSeedFile(seedPath));
} else {
  hydrateFileMemory(dataDir, loadSeedFile(seedPath));
}

const people = await listPeople();
const result = await seedRssDigest({
  people,
  slice: args.slice,
  fetchImpl: globalThis.fetch,
  importPosts: !args.dry_run,
  queueLeads: !args.dry_run && args.queue,
});

const jsonlPath = path.resolve(
  args.jsonl ||
    path.join(ROOT, "var", `digest-${new Date().toISOString().slice(0, 10)}.jsonl`),
);
fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
fs.writeFileSync(jsonlPath, result.jsonl);

if (!databaseUrl() && !args.dry_run) {
  persistAddRequests(dataDir);
  writeFileStore(dataDir, getMemory());
}

const feeds = selectDigestFeeds(args.slice);
console.log(
  `digest slice=${args.slice} feeds=${feeds.length} leads=${result.leads.length} import_rows=${result.import_rows.length} inserted=${result.imported.inserted || 0} updated=${result.imported.updated || 0} annotated=${result.imported.annotated || 0} queued=${result.queued.length} skipped=${result.skipped.length} jsonl=${jsonlPath}`,
);
await closeStore();
