#!/usr/bin/env node
/**
 * Export published tables as JSON for gap-upsert. Reads DATABASE_URL (lab).
 * Does not print the URL. Does not pack media.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv } from "../app/lib/env.mjs";
import { ALL_UPSERT_TABLES } from "../app/lib/gap-upsert.mjs";
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

const outPath = arg("out", "published.json");
if (!databaseUrl()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = await getPool();
if (!pool) {
  console.error("Postgres pool unavailable");
  process.exit(1);
}

try {
  const have = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const names = new Set(have.rows.map((r) => r.table_name));
  const payload = {};
  for (const table of ALL_UPSERT_TABLES) {
    if (!names.has(table)) {
      payload[table] = [];
      console.log(`EXPORT_SKIP table=${table} reason=absent`);
      continue;
    }
    const res = await pool.query(`SELECT * FROM ${table}`);
    payload[table] = res.rows;
    console.log(`EXPORT_OK table=${table} rows=${res.rows.length}`);
  }
  const abs = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);
  fs.writeFileSync(abs, `${JSON.stringify(payload)}\n`);
  console.log("EXPORT_WRITTEN");
} catch (err) {
  console.error(err instanceof Error ? err.message : "export failed");
  process.exit(1);
} finally {
  await closeStore();
}
