#!/usr/bin/env node
/**
 * et-replslot-snapshot — read-only lab helper. Records the publisher slot
 * position for exittrace_lab_sub before and after a subscriber-side fix.
 *
 * Runs on the lab host from the ExitTrace checkout. Reads DATABASE_URL from
 * the environment or the checkout's .env (never printed). Opens a READ ONLY
 * transaction; issues SELECTs only.
 *
 * Usage:
 *   node scripts/ops/et-replslot-snapshot.mjs [--label=before|after|...] [--past-lsn=1/C71E1358]
 * Prints one JSON line: label, now (UTC + America/New_York), slot active,
 * active_pid, confirmed_flush_lsn, restart_lsn, wal_status, current_wal_lsn,
 * lag_bytes, retained_bytes, and past_lsn_reached when --past-lsn is given.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SLOT_NAME = "exittrace_lab_sub";
const LSN_RE = /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/i;
const LABEL_RE = /^[A-Za-z0-9_.:-]{1,40}$/;

export function parseArgs(argv) {
  const out = { label: "snapshot", pastLsn: null };
  for (const a of argv) {
    if (a.startsWith("--label=")) out.label = a.slice(8);
    else if (a.startsWith("--past-lsn=")) out.pastLsn = a.slice(11);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!LABEL_RE.test(out.label)) throw new Error("--label must be [A-Za-z0-9_.:-]{1,40}");
  if (out.pastLsn !== null && !LSN_RE.test(out.pastLsn)) throw new Error("--past-lsn must look like 1/C71E1358");
  return out;
}

export const SNAPSHOT_SQL = `SELECT
  now()::text AS now_utc,
  (now() AT TIME ZONE 'America/New_York')::text AS now_et,
  slot_name, active, active_pid, wal_status,
  restart_lsn::text AS restart_lsn,
  confirmed_flush_lsn::text AS confirmed_flush_lsn,
  pg_current_wal_lsn()::text AS current_wal_lsn,
  pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::bigint::text AS lag_bytes,
  pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint::text AS retained_bytes,
  CASE WHEN $2::text IS NULL THEN NULL
       ELSE pg_wal_lsn_diff(confirmed_flush_lsn, $2::pg_lsn) > 0 END AS past_lsn_reached
FROM pg_replication_slots WHERE slot_name = $1`;

export async function snapshot(client, args) {
  await client.query("BEGIN READ ONLY");
  try {
    const r = await client.query(SNAPSHOT_SQL, [SLOT_NAME, args.pastLsn]);
    const row = r.rows[0] || null;
    return { label: args.label, past_lsn: args.pastLsn, slot: row };
  } finally {
    await client.query("ROLLBACK");
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`usage error: ${err.message}`);
    return 2;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { loadDotEnv, databaseUrl } = await import(path.join(root, "app/lib/env.mjs"));
  if (!process.env.DATABASE_URL) loadDotEnv(path.join(root, ".env"));
  const url = databaseUrl();
  if (!url) {
    console.error("DATABASE_URL missing (env or .env); refusing");
    return 2;
  }
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    const out = await snapshot(client, args);
    if (!out.slot) {
      console.error(`slot ${SLOT_NAME} not found; is this the lab publisher?`);
      return 3;
    }
    console.log(JSON.stringify(out));
    return 0;
  } catch (err) {
    console.error(`error: ${String(err && err.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]")}`);
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
