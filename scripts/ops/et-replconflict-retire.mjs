#!/usr/bin/env node
/**
 * et-replconflict-retire — retire ONE Render-side person_events row that
 * blocks logical apply of exittrace_lab_sub with a duplicate-key error.
 *
 * Gated ops script (Worf sha gate + Admiral sign before --apply).
 *
 * Where it runs: ONLY inside the ExitTrace Render web service shell
 * (from the service project root). It reads process.env.DATABASE_URL inside
 * this process only. It never prints the URL, never shells out to psql.
 * It refuses to run unless the database holds subscription exittrace_lab_sub
 * (so it cannot touch the lab publisher by mistake).
 *
 * Usage:
 *   node scripts/ops/et-replconflict-retire.mjs <person_id> <kind> [--dry-run]
 *   node scripts/ops/et-replconflict-retire.mjs <person_id> <kind> --apply \
 *        [--lab-lsn=1/C71E1358] [--settle-seconds=20]
 *
 * --dry-run (default): read-only. Prints subscription status, counts, and the
 *   Render row column by column (value + sha256 of the to_jsonb value) for a
 *   diff against the lab row.
 * --apply: one transaction, one key:
 *   CREATE TABLE IF NOT EXISTS person_events_replconflict_retired_20261022
 *     (LIKE person_events INCLUDING DEFAULTS, retired_at, lab_lsn);
 *   INSERT … SELECT the row; DELETE WHERE person_id=$1 AND kind=$2;
 *   both must touch exactly 1 row or the transaction is rolled back.
 *   Before and after: pg_stat_subscription latest_end_lsn and
 *   pg_stat_subscription_stats apply_error_count for exittrace_lab_sub.
 *
 * It does not ALTER/ENABLE/DISABLE/SKIP/REFRESH any subscription or
 * publication, does not DROP or TRUNCATE, and has exactly one DELETE
 * (the parameterized one below).
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SUB_NAME = "exittrace_lab_sub";
export const RETIRED_TABLE = "person_events_replconflict_retired_20261022";
const PERSON_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const KIND_RE = /^[a-z][a-z0-9_]{0,63}$/;
const LSN_RE = /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/i;
const COLUMN_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export class UsageError extends Error {}

export function parseArgs(argv) {
  const positional = [];
  const out = { mode: "dry-run", labLsn: null, settleSeconds: 20 };
  let sawDry = false;
  let sawApply = false;
  for (const a of argv) {
    if (a === "--dry-run") sawDry = true;
    else if (a === "--apply") sawApply = true;
    else if (a.startsWith("--lab-lsn=")) out.labLsn = a.slice("--lab-lsn=".length);
    else if (a.startsWith("--settle-seconds=")) out.settleSeconds = Number(a.slice("--settle-seconds=".length));
    else if (a.startsWith("--")) throw new UsageError(`unknown flag: ${a}`);
    else positional.push(a);
  }
  if (sawDry && sawApply) throw new UsageError("pass --dry-run or --apply, not both");
  if (positional.length !== 2) throw new UsageError("need exactly two args: <person_id> <kind> (one key per run)");
  const [personId, kind] = positional;
  if (!PERSON_ID_RE.test(personId)) throw new UsageError("person_id must match ^[a-z0-9][a-z0-9-]*$");
  if (!KIND_RE.test(kind)) throw new UsageError("kind must match ^[a-z][a-z0-9_]*$");
  if (out.labLsn !== null && !LSN_RE.test(out.labLsn)) throw new UsageError("--lab-lsn must look like 1/C71E1358");
  if (!Number.isInteger(out.settleSeconds) || out.settleSeconds < 0 || out.settleSeconds > 300) {
    throw new UsageError("--settle-seconds must be an integer 0..300");
  }
  out.mode = sawApply ? "apply" : "dry-run";
  out.personId = personId;
  out.kind = kind;
  return out;
}

export const SQL = Object.freeze({
  subStatus: `SELECT s.subname, s.subenabled,
       st.pid IS NOT NULL AS worker_present,
       st.received_lsn::text AS received_lsn,
       st.latest_end_lsn::text AS latest_end_lsn,
       st.latest_end_time::text AS latest_end_time,
       ss.apply_error_count::text AS apply_error_count,
       ss.sync_error_count::text AS sync_error_count
  FROM pg_subscription s
  LEFT JOIN pg_stat_subscription st ON st.subid = s.oid AND st.relid IS NULL
  LEFT JOIN pg_stat_subscription_stats ss ON ss.subid = s.oid
 WHERE s.subname = $1`,
  columns: `SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'person_events'
 ORDER BY ordinal_position`,
  rowJson: `SELECT to_jsonb(pe) AS j FROM public.person_events pe
 WHERE pe.person_id = $1 AND pe.kind = $2`,
  counts: `SELECT
  (SELECT count(*) FROM public.person_events WHERE person_id = $1 AND kind = $2)::int AS key_rows,
  (SELECT count(*) FROM public.person_events WHERE person_id = $1)::int AS person_event_rows,
  (SELECT count(*) FROM public.people WHERE id = $1)::int AS people_rows,
  (SELECT count(*) FROM public.person_events)::int AS person_events_total,
  to_regclass('public.${RETIRED_TABLE}') IS NOT NULL AS retired_table_exists`,
  retiredCount: `SELECT count(*)::int AS n FROM public.${RETIRED_TABLE} WHERE person_id = $1 AND kind = $2`,
  begin: "BEGIN",
  lockRow: `SELECT 1 FROM public.person_events WHERE person_id = $1 AND kind = $2 FOR UPDATE`,
  createRetired: `CREATE TABLE IF NOT EXISTS public.${RETIRED_TABLE} (
  LIKE public.person_events INCLUDING DEFAULTS,
  retired_at timestamptz NOT NULL DEFAULT now(),
  lab_lsn text
)`,
  deleteKey: `DELETE FROM public.person_events WHERE person_id = $1 AND kind = $2`,
  commit: "COMMIT",
  rollback: "ROLLBACK",
});

export function insertRetiredSql(columns) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error("no person_events columns");
  for (const c of columns) {
    if (!COLUMN_RE.test(c)) throw new Error(`unexpected column name: ${c}`);
  }
  const list = columns.map((c) => `"${c}"`).join(", ");
  return `INSERT INTO public.${RETIRED_TABLE} (${list}, lab_lsn)
SELECT ${list}, $3 FROM public.person_events WHERE person_id = $1 AND kind = $2`;
}

export function sha256(v) {
  return crypto.createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
}

/** Strip anything that looks like a connection string or password from an error. */
export function sanitize(msg) {
  return String(msg || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]")
    .replace(/password=\S+/gi, "password=[redacted]")
    .slice(0, 400);
}

async function status(client, log, label) {
  const r = await client.query(SQL.subStatus, [SUB_NAME]);
  const s = r.rows[0] || null;
  log(`STATUS ${label} ${JSON.stringify(s)}`);
  return s;
}

function printRow(log, label, j) {
  if (!j) {
    log(`ROW ${label} absent`);
    return;
  }
  for (const k of Object.keys(j)) {
    log(`ROW ${label} col=${k} sha256=${sha256(j[k])} value=${JSON.stringify(j[k])}`);
  }
}

/**
 * Core logic. `client` needs only query(sql, params) -> { rows, rowCount }.
 * Returns an exit code.
 */
export async function run(client, args, { log = console.log, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const p = [args.personId, args.kind];
  log(`MODE ${args.mode} key=(${args.personId}, ${args.kind}) table=${RETIRED_TABLE}`);

  const before = await status(client, log, "before");
  if (!before) {
    log(`REFUSE no subscription ${SUB_NAME} in this database (not the Render subscriber)`);
    return 3;
  }
  const counts = (await client.query(SQL.counts, p)).rows[0];
  log(`COUNTS before ${JSON.stringify(counts)}`);
  if (counts.retired_table_exists) {
    const rc = (await client.query(SQL.retiredCount, p)).rows[0];
    log(`COUNTS retired_rows_for_key before ${rc.n}`);
  }
  const cols = (await client.query(SQL.columns)).rows.map((r) => r.column_name);
  log(`COLUMNS person_events ${cols.join(",")}`);
  const rowRes = await client.query(SQL.rowJson, p);
  printRow(log, "render", rowRes.rows[0] ? rowRes.rows[0].j : null);

  if (args.mode !== "apply") {
    log("DRY-RUN no writes. Re-run with --apply only after the gate signs this output.");
    return counts.key_rows === 1 ? 0 : 4;
  }
  if (counts.key_rows !== 1) {
    log(`REFUSE expected exactly 1 row for the key, found ${counts.key_rows}; nothing written`);
    return 4;
  }

  let committed = false;
  try {
    await client.query(SQL.begin);
    const lock = await client.query(SQL.lockRow, p);
    if (lock.rowCount !== 1) throw new Error(`lock rowCount=${lock.rowCount}, expected 1`);
    await client.query(SQL.createRetired);
    const ins = await client.query(insertRetiredSql(cols), [...p, args.labLsn]);
    if (ins.rowCount !== 1) throw new Error(`retire insert rowCount=${ins.rowCount}, expected 1`);
    const del = await client.query(SQL.deleteKey, p);
    if (del.rowCount !== 1) throw new Error(`delete rowCount=${del.rowCount}, expected 1`);
    await client.query(SQL.commit);
    committed = true;
    log(`APPLY committed retired=1 deleted=1 lab_lsn=${args.labLsn ?? "null"}`);
  } catch (err) {
    try {
      await client.query(SQL.rollback);
    } catch {
      /* connection may already be gone */
    }
    log(`ROLLBACK ${sanitize(err && err.message)}`);
    return 5;
  }

  if (committed && args.settleSeconds > 0) {
    log(`SETTLE waiting ${args.settleSeconds}s for the apply worker retry`);
    await wait(args.settleSeconds * 1000);
  }
  const countsAfter = (await client.query(SQL.counts, p)).rows[0];
  log(`COUNTS after ${JSON.stringify(countsAfter)}`);
  const rc = (await client.query(SQL.retiredCount, p)).rows[0];
  log(`COUNTS retired_rows_for_key after ${rc.n}`);
  const after = await status(client, log, "after");
  const beforeErr = Number(before.apply_error_count ?? NaN);
  const afterErr = Number(after?.apply_error_count ?? NaN);
  log(
    `SUMMARY latest_end_lsn ${before.latest_end_lsn ?? "null"} -> ${after?.latest_end_lsn ?? "null"}; ` +
      `apply_error_count ${before.apply_error_count ?? "null"} -> ${after?.apply_error_count ?? "null"}` +
      (Number.isFinite(beforeErr) && Number.isFinite(afterErr) ? ` (delta ${afterErr - beforeErr})` : ""),
  );
  log(
    "NOTE key_rows after may be 1 again: that is the lab INSERT replaying (expected). " +
      "If apply_error_count keeps rising, read the next DETAIL key in the Render Postgres log; one key per run.",
  );
  return 0;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`usage error: ${err.message}`);
    return 2;
  }
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) {
    console.error("DATABASE_URL is not set in this shell; run inside the ExitTrace Render web service shell");
    return 2;
  }
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: url, max: 1, idleTimeoutMillis: 5_000 });
  const client = await pool.connect();
  try {
    await client.query("SET application_name = 'et-replconflict-retire'");
    return await run(client, args);
  } catch (err) {
    console.error(`error: ${sanitize(err && err.message)}${err && err.code ? ` code=${err.code}` : ""}`);
    return 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
