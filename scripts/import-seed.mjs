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

const seed = loadSeedFile(seedPath);
if (databaseUrl()) {
  const pool = await getPool();
  await ensureSchema(pool, bootstrapSql);
  const n = await importSeed(pool, seed);
  console.log(`imported postgres people=${n.people} dog_comms=${n.dog_comms}`);
  await closeStore();
} else {
  hydrateFileMemory(dataDir, seed);
  writeFileStore(dataDir, getMemory());
  const mem = getMemory();
  console.log(
    `wrote file store people=${mem.people.length} dog_comms=${mem.dog_comms.length} source_posts=${mem.source_posts.length}`,
  );
}
