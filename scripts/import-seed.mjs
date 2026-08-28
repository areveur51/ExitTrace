#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import {
  ensureSchema,
  getPool,
  importSeed,
  loadSeedFile,
  setMemory,
  writeFileStore,
  closeStore,
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
  setMemory(seed);
  writeFileStore(dataDir, seed);
  console.log(`wrote file store people=${seed.people.length} dog_comms=${seed.dog_comms.length}`);
}
