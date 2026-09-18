#!/usr/bin/env node
/**
 * Idempotent upsert of published tables by id (and person_events companion).
 * Never DELETE / TRUNCATE / DROP. Optional categories skipped if the table is absent.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv } from "../app/lib/env.mjs";
import {
  ALL_UPSERT_TABLES,
  COUNT_SQL,
  countProof,
  planGapUpsert,
} from "../app/lib/gap-upsert.mjs";
import { closeStore, getPool } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));

function arg(name, fallback) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) return true;
  return next;
}

const fromPath = arg("from");
if (!fromPath || fromPath === true) {
  console.error("usage: node scripts/gap-upsert-published.mjs --from published.json");
  process.exit(1);
}

if (!databaseUrl()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const abs = path.isAbsolute(fromPath) ? fromPath : path.resolve(process.cwd(), fromPath);
if (!fs.existsSync(abs)) {
  console.error("source JSON is missing");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(abs, "utf8"));
} catch {
  console.error("source JSON is not valid JSON");
  process.exit(1);
}

const pool = await getPool();
if (!pool) {
  console.error("Postgres pool unavailable");
  process.exit(1);
}

async function existingTables() {
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  return res.rows.map((r) => r.table_name);
}

async function counts() {
  try {
    const res = await pool.query(COUNT_SQL);
    const row = res.rows[0] || {};
    const out = { categories: 0 };
    for (const t of ALL_UPSERT_TABLES) {
      if (t === "categories") continue;
      out[t] = Number(row[t] || 0);
    }
    try {
      const cat = await pool.query("SELECT count(*)::int AS n FROM categories");
      out.categories = Number(cat.rows[0]?.n || 0);
    } catch {
      out.categories = 0;
    }
    return out;
  } catch (err) {
    throw err;
  }
}

try {
  const have = await existingTables();
  const planned = planGapUpsert(payload, { existingTables: have });
  const before = await counts();
  console.log(
    `BEFORE people=${before.people} dog_comms=${before.dog_comms} operations=${before.operations} person_events=${before.person_events} categories=${before.categories}`,
  );
  for (const skip of planned.skipped) {
    console.log(`SKIP table=${skip.table} reason=${skip.reason} rows=${skip.count}`);
  }
  for (const plan of planned.plans) {
    await pool.query(plan.sql, plan.params);
    console.log(`UPSERT_OK table=${plan.table} rows=${plan.count}`);
  }
  const after = await counts();
  console.log(
    `AFTER people=${after.people} dog_comms=${after.dog_comms} operations=${after.operations} person_events=${after.person_events} categories=${after.categories}`,
  );
  const proof = countProof(before, after, planned.counts_in);
  for (const [table, row] of Object.entries(proof)) {
    console.log(
      `PROOF ${table} before=${row.before} after=${row.after} source_rows=${row.source_rows} delta=${row.delta}`,
    );
    if (!row.ok) {
      console.error(`PROOF_FAIL table=${table}`);
      process.exit(1);
    }
  }
  console.log("GAP_UPSERT_OK");
} catch (err) {
  console.error(err instanceof Error ? err.message : "gap upsert failed");
  process.exit(1);
} finally {
  await closeStore();
}
