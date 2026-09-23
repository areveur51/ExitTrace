#!/usr/bin/env node
/**
 * Idempotent upsert of published tables by id (and person_events companion).
 * Includes red_folder_comms, central_casting_comms, request_attributions,
 * and people.central_casting.
 * Never DELETE / TRUNCATE / DROP. Absent tables are skipped, not created.
 *
 * Place order (no secrets in this file): lab add-*-publication.sql,
 * then Render `ALTER SUBSCRIPTION exittrace_lab_sub REFRESH PUBLICATION
 * WITH (copy_data = false)` — that refresh does not copy existing rows —
 * then export from lab and run this script against Render DATABASE_URL.
 * See docs/NEW_KIND_RENDER_SYNC.md.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv } from "../app/lib/env.mjs";
import {
  ALL_UPSERT_TABLES,
  COUNT_SQL,
  countProof,
  countTableSql,
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

async function countOne(table) {
  try {
    const res = await pool.query(countTableSql(table));
    return Number(res.rows[0]?.n || 0);
  } catch (err) {
    if (err && err.code === "42P01") return 0;
    throw err;
  }
}

async function counts() {
  const out = Object.fromEntries(ALL_UPSERT_TABLES.map((t) => [t, 0]));
  try {
    const res = await pool.query(COUNT_SQL);
    const row = res.rows[0] || {};
    for (const t of ALL_UPSERT_TABLES) {
      if (t === "categories") continue;
      out[t] = Number(row[t] || 0);
    }
  } catch (err) {
    if (!err || err.code !== "42P01") throw err;
    for (const t of ALL_UPSERT_TABLES) {
      if (t === "categories") continue;
      out[t] = await countOne(t);
    }
  }
  out.categories = await countOne("categories");
  return out;
}

function formatCounts(row) {
  return ALL_UPSERT_TABLES.map((t) => `${t}=${row[t] ?? 0}`).join(" ");
}

try {
  const have = await existingTables();
  const planned = planGapUpsert(payload, { existingTables: have });
  const before = await counts();
  console.log(`BEFORE ${formatCounts(before)}`);
  for (const skip of planned.skipped) {
    console.log(`SKIP table=${skip.table} reason=${skip.reason} rows=${skip.count}`);
  }
  for (const plan of planned.plans) {
    await pool.query(plan.sql, plan.params);
    console.log(`UPSERT_OK table=${plan.table} rows=${plan.count}`);
  }
  const after = await counts();
  console.log(`AFTER ${formatCounts(after)}`);
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
