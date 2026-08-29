#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import { importSourcePostsText } from "../app/lib/import-posts.mjs";
import {
  closeStore,
  ensureSchema,
  getMemory,
  getPool,
  hydrateFileMemory,
  importSeed,
  loadSeedFile,
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

const input = process.argv[2];
if (!input || input === "-h" || input === "--help") {
  console.log("Usage: node scripts/import-source-posts.mjs <posts.jsonl>");
  process.exit(input ? 0 : 1);
}

const jsonlPath = path.resolve(input);
if (!fs.existsSync(jsonlPath)) {
  console.error(`Missing JSONL file: ${jsonlPath}`);
  process.exit(1);
}
const text = fs.readFileSync(jsonlPath, "utf8");
const seed = loadSeedFile(seedPath);

if (databaseUrl()) {
  const pool = await getPool();
  await ensureSchema(pool, bootstrapSql);
  await importSeed(pool, seed);
} else {
  hydrateFileMemory(dataDir, seed);
}

const result = await importSourcePostsText(text);
if (!databaseUrl()) {
  writeFileStore(dataDir, getMemory());
}

console.log(
  `source posts inserted=${result.inserted} updated=${result.updated} annotated=${result.annotated} skipped=${result.skipped}`,
);
await closeStore();
