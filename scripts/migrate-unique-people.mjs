#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import {
  closeStore,
  ensureSchema,
  getMemory,
  getPool,
  hydrateFileMemory,
  loadSeedFile,
  migrateUniquePeople,
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

if (databaseUrl()) {
  const pool = await getPool();
  await ensureSchema(pool, bootstrapSql);
} else {
  hydrateFileMemory(dataDir, loadSeedFile(seedPath));
}

const result = await migrateUniquePeople();
if (!databaseUrl()) {
  writeFileStore(dataDir, getMemory());
}
console.log(`unique people=${result.people} collapsed=${result.merged}`);
await closeStore();
