#!/usr/bin/env node
/**
 * Diagnose logical apply and run fail-closed heals (reconnect / refresh).
 * Never SKIP LSN, never TRUNCATE, never copy_data=true, never DROP.
 * Dump --clean and gap-upsert are recommended to the workflow, not executed here.
 */
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv } from "../app/lib/env.mjs";
import {
  APPLY_REL_STATES_SQL,
  APPLY_SNAPSHOT_SQL,
  APPLY_WORKER_QUERY_SQL,
  HEAL_META_KEYS,
  LOGICAL_SUB_NAME,
  POSTED_AT_TYPE_SQL,
  planHeal,
  sanitizeApplyError,
} from "../app/lib/logical-heal.mjs";
import { closeStore, getEtMeta, getPool, upsertEtMeta } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function arg(name, fallback) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) return true;
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryOne(pool, sql, params = []) {
  try {
    const res = await pool.query(sql, params);
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

async function readSnapshot(pool) {
  const core = await queryOne(
    pool,
    `SELECT
       EXISTS (SELECT 1 FROM pg_subscription WHERE subname = $1) AS present,
       COALESCE((SELECT subenabled FROM pg_subscription WHERE subname = $1), false) AS enabled,
       EXISTS (SELECT 1 FROM pg_stat_subscription WHERE subname = $1 AND pid IS NOT NULL) AS worker_present,
       (SELECT received_lsn::text FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS received_lsn,
       (SELECT latest_end_lsn::text FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS latest_end_lsn,
       (SELECT EXTRACT(EPOCH FROM (now() - last_msg_receipt_time))::bigint
          FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS last_msg_receipt_age_seconds,
       (SELECT EXTRACT(EPOCH FROM (now() - last_msg_send_time))::bigint
          FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS last_msg_send_age_seconds,
       (SELECT count(*)::int FROM pg_subscription_rel sr
          JOIN pg_subscription s ON s.oid = sr.srsubid WHERE s.subname = $1) AS rel_count,
       (SELECT count(*)::int FROM pg_subscription_rel sr
          JOIN pg_subscription s ON s.oid = sr.srsubid
         WHERE s.subname = $1 AND sr.srsubstate IN ('r', 's')) AS rel_ready_count`,
    [LOGICAL_SUB_NAME],
  );
  const stats = await queryOne(pool, APPLY_SNAPSHOT_SQL, [LOGICAL_SUB_NAME]);
  const rels = await pool
    .query(APPLY_REL_STATES_SQL, [LOGICAL_SUB_NAME])
    .then((r) => r.rows.map((x) => x.state))
    .catch(() => []);
  const worker = await queryOne(pool, APPLY_WORKER_QUERY_SQL, [LOGICAL_SUB_NAME]);
  const posted = await queryOne(pool, POSTED_AT_TYPE_SQL);
  const row = core || stats || {};
  return {
    present: Boolean(row.present),
    enabled: Boolean(row.enabled),
    worker_present: Boolean(row.worker_present),
    received_lsn: row.received_lsn || null,
    latest_end_lsn: row.latest_end_lsn || null,
    last_msg_receipt_age_seconds:
      row.last_msg_receipt_age_seconds === null || row.last_msg_receipt_age_seconds === undefined
        ? null
        : Number(row.last_msg_receipt_age_seconds),
    last_msg_send_age_seconds:
      row.last_msg_send_age_seconds === null || row.last_msg_send_age_seconds === undefined
        ? null
        : Number(row.last_msg_send_age_seconds),
    apply_error_count:
      stats?.apply_error_count === null || stats?.apply_error_count === undefined
        ? null
        : Number(stats.apply_error_count),
    sync_error_count:
      stats?.sync_error_count === null || stats?.sync_error_count === undefined
        ? null
        : Number(stats.sync_error_count),
    rel_count: row.rel_count === null || row.rel_count === undefined ? null : Number(row.rel_count),
    rel_ready_count:
      row.rel_ready_count === null || row.rel_ready_count === undefined
        ? null
        : Number(row.rel_ready_count),
    rel_states: rels,
    last_apply_error: sanitizeApplyError(worker?.query),
    posted_at_data_type: posted?.data_type || null,
  };
}

function readHealState(meta) {
  const since = meta[HEAL_META_KEYS.unhealthySince];
  const at = since?.at ? Date.parse(since.at) : NaN;
  const reconnectCount = Number(meta[HEAL_META_KEYS.reconnectCount]?.n ?? 0);
  return {
    unhealthyMs: Number.isFinite(at) ? Math.max(0, Date.now() - at) : 0,
    reconnectCount: Number.isFinite(reconnectCount) ? Math.max(0, Math.trunc(reconnectCount)) : 0,
    lastState: meta[HEAL_META_KEYS.lastState]?.state || null,
  };
}

async function stampHeal(key, value) {
  await upsertEtMeta(key, value);
}

async function applyReconnect(pool, backoffSeconds) {
  await pool.query(`ALTER SUBSCRIPTION ${LOGICAL_SUB_NAME} DISABLE`);
  await pool.query(`ALTER SUBSCRIPTION ${LOGICAL_SUB_NAME} ENABLE`);
  const wait = Math.max(1, Math.trunc(Number(backoffSeconds) || 8));
  console.log(`RECONNECT_OK backoff_seconds=${wait}`);
  await sleep(wait * 1000);
}

async function applyRefresh(pool) {
  await pool.query(
    `ALTER SUBSCRIPTION ${LOGICAL_SUB_NAME} REFRESH PUBLICATION WITH (copy_data = false)`,
  );
  console.log("REFRESH_OK copy_data=false");
  await sleep(5000);
}

const dryRun = hasFlag("dry-run");
const apply = hasFlag("apply") || !dryRun;
const syncModeArg = arg("sync-mode", process.env.HEAL_SYNC_MODE || "dump");
const dumpArmed =
  hasFlag("dump-armed") || String(process.env.ET_DUMP_COLD_FALLBACK || "") === "true";
const allowDump =
  hasFlag("allow-dump-fallback") || String(process.env.ET_ALLOW_DUMP_FALLBACK || "") === "true";

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
  const snap = await readSnapshot(pool);
  const meta = await getEtMeta(Object.values(HEAL_META_KEYS));
  const prior = readHealState(meta);
  const plan = planHeal(snap, {
    reconnectCount: prior.reconnectCount,
    unhealthyMs: prior.unhealthyMs,
    syncMode: syncModeArg === "dump" || syncModeArg === "logical" ? syncModeArg : "dump",
    dumpColdFallbackArmed: dumpArmed,
    allowDumpFallback: allowDump,
    dumpRestoreMode: "disabled",
  });

  console.log(`APPLY_STATE=${plan.state}`);
  console.log(`APPLY_ERRORS=${plan.health.apply_error_count ?? ""}`);
  console.log(`LAG_SECONDS=${plan.health.lag_seconds ?? ""}`);
  console.log(`HANDSHAKE_RETRY=${plan.health.handshake_retry ? "1" : "0"}`);
  console.log(`LSN_STALLED=${plan.health.lsn_stalled ? "1" : "0"}`);
  console.log(`REL_COUNT=${snap.rel_count ?? ""}`);
  console.log(`REL_READY=${snap.rel_ready_count ?? ""}`);
  console.log(`WORKER=${snap.worker_present ? "1" : "0"}`);
  console.log(`POSTED_AT_TYPE=${snap.posted_at_data_type || ""}`);
  if (plan.apply_error) console.log(`APPLY_ERROR=${plan.apply_error}`);
  console.log(`HEAL_ACTIONS=${plan.actions.join(",")}`);
  console.log(`SIGN_REQUIRED=${plan.sign_required ? "1" : "0"}`);
  console.log(`GAP_UPSERT=${plan.gap_upsert ? "1" : "0"}`);
  console.log(`DUMP_FALLBACK=${plan.dump_fallback ? "1" : "0"}`);
  if (plan.skip_recipe) console.log(plan.skip_recipe);

  if (dryRun || !apply) {
    console.log("DRY_RUN");
    process.exit(plan.sign_required ? 2 : 0);
  }

  if (plan.actions.includes("observe") && plan.actions.length === 1) {
    if (plan.state !== "absent") {
      await stampHeal(HEAL_META_KEYS.unhealthySince, { at: null, cleared: true });
      await stampHeal(HEAL_META_KEYS.reconnectCount, { n: 0 });
      await stampHeal(HEAL_META_KEYS.lastAction, { action: "observe" });
      await stampHeal(HEAL_META_KEYS.lastState, { state: plan.state });
      await stampHeal(HEAL_META_KEYS.needsSign, { needs_sign: false });
    }
    console.log("HEAL_OK observe");
    process.exit(0);
  }

  if (plan.actions.includes("refresh_publication")) {
    await applyRefresh(pool);
    await stampHeal(HEAL_META_KEYS.lastAction, { action: "refresh_publication" });
  }

  if (plan.actions.includes("reconnect")) {
    await applyReconnect(pool, plan.backoff_seconds);
    await stampHeal(HEAL_META_KEYS.reconnectCount, { n: prior.reconnectCount + 1 });
    await stampHeal(HEAL_META_KEYS.lastAction, { action: "reconnect" });
  }

  if (plan.state !== "healthy" && plan.state !== "absent") {
    if (!prior.unhealthyMs) {
      await stampHeal(HEAL_META_KEYS.unhealthySince, { at: new Date().toISOString() });
    }
  } else {
    await stampHeal(HEAL_META_KEYS.unhealthySince, { at: null, cleared: true });
    await stampHeal(HEAL_META_KEYS.reconnectCount, { n: 0 });
  }

  await stampHeal(HEAL_META_KEYS.lastState, { state: plan.state });
  await stampHeal(HEAL_META_KEYS.needsSign, { needs_sign: plan.sign_required });
  if (plan.apply_error) {
    await stampHeal(HEAL_META_KEYS.lastError, { error: plan.apply_error });
  }

  const after = await readSnapshot(pool);
  const afterPlan = planHeal(after, {
    reconnectCount: plan.actions.includes("reconnect") ? prior.reconnectCount + 1 : prior.reconnectCount,
    unhealthyMs: prior.unhealthyMs,
    syncMode: syncModeArg === "dump" || syncModeArg === "logical" ? syncModeArg : "dump",
  });
  console.log(`AFTER_STATE=${afterPlan.state}`);
  console.log(`AFTER_ERRORS=${afterPlan.health.apply_error_count ?? ""}`);
  console.log(`AFTER_WORKER=${after.worker_present ? "1" : "0"}`);

  if (plan.sign_required) {
    console.log("HEAL_NEEDS_SIGN");
    process.exit(2);
  }
  console.log("HEAL_OK");
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : "heal failed");
  process.exit(1);
} finally {
  await closeStore();
}
