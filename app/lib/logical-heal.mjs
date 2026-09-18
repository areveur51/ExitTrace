/**
 * Logical apply recovery machine (pure).
 * Detect crash-loop / stalled LSN / handshake-retry noise; plan fail-closed heals.
 * Does not read SYNC_MODE from the environment — callers pass mode in.
 * Never plans DROP, copy_data=true, TRUNCATE, SKIP LSN, or media wipe.
 */

export const LOGICAL_SUB_NAME = "exittrace_lab_sub";

export const APPLY_STATES = Object.freeze([
  "absent",
  "disabled",
  "healthy",
  "handshake_retry",
  "crash_loop",
  "lsn_stalled",
  "relations_stale",
  "poison_txn",
]);

export const HEAL_ACTIONS = Object.freeze([
  "observe",
  "reconnect",
  "refresh_publication",
  "gap_upsert",
  "dump_cold_fallback",
  "needs_sign",
]);

export const READY_REL_STATES = Object.freeze(["r", "s"]);

/** Receipt age that still looks "fine" on public lag_seconds while apply can be dying. */
export const HANDSHAKE_LAG_MAX_SECONDS = 30;

/** apply_error_count at or above this is a spike, not a single blip. */
export const APPLY_ERROR_SPIKE = 10;

/** How long LSN may sit still before we call it stalled (when receipt is also stale). */
export const LSN_STALL_SECONDS = 60;

/** Sustained unhealth before optional dump/gap catch-up is even considered. */
export const SUSTAINED_UNHEALTHY_MS = 30 * 60 * 1000;

/** Auto DISABLE/ENABLE budget; after this, poison_txn needs human SIGN. */
export const MAX_AUTO_RECONNECTS = 3;

const UNSAFE_VALUE =
  /:\/\/|@|\bdpg-|\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b|::[0-9a-f:]*|[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){5,}/i;

export function isApplyState(v) {
  return APPLY_STATES.includes(String(v || ""));
}

export function publicApplyState(value) {
  if (value === null || value === undefined) return null;
  let state = value;
  if (typeof value === "object") state = value.apply_state ?? value.state ?? value.v;
  if (state === null || state === undefined) return null;
  if (typeof state !== "string") return null;
  const s = state.trim();
  if (!s || UNSAFE_VALUE.test(s)) return null;
  return isApplyState(s) ? s : null;
}

export function publicApplyErrorCount(value) {
  if (value === null || value === undefined) return null;
  let n = value;
  if (typeof value === "object" && value !== null) {
    n = value.apply_error_count ?? value.errors ?? value.v ?? value.n;
  }
  if (typeof n === "string" && n.trim() && !UNSAFE_VALUE.test(n)) n = Number(n);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export function publicGitSha(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(s)) return null;
  return s.toLowerCase();
}

export function sanitizeApplyError(text) {
  if (text === null || text === undefined) return null;
  let s = String(text);
  if (!s.trim()) return null;
  s = s
    .replace(/[A-Za-z0-9+._~:/?#\[\]@!$&'()*+,;=-]+:\/\/[^\s]+/g, "[redacted-url]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted]")
    .replace(/\bdpg-[A-Za-z0-9-]+/gi, "[redacted-instance]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/g, "[redacted-addr]");
  if (UNSAFE_VALUE.test(s)) return "[redacted-apply-error]";
  return s.slice(0, 500);
}

export function emptyApplySnapshot() {
  return {
    present: false,
    enabled: false,
    worker_present: false,
    received_lsn: null,
    latest_end_lsn: null,
    last_msg_receipt_age_seconds: null,
    last_msg_send_age_seconds: null,
    apply_error_count: null,
    sync_error_count: null,
    rel_count: null,
    rel_ready_count: null,
    rel_states: [],
    last_apply_error: null,
    posted_at_data_type: null,
  };
}

function asInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v === "t" || v === "true" || v === "1") return true;
  if (v === "f" || v === "false" || v === "0") return false;
  return Boolean(v);
}

export function normalizeSnapshot(raw = {}) {
  const empty = emptyApplySnapshot();
  const src = raw && typeof raw === "object" ? raw : {};
  const states = Array.isArray(src.rel_states)
    ? src.rel_states.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  return {
    present: asBool(src.present),
    enabled: asBool(src.enabled),
    worker_present: asBool(src.worker_present),
    received_lsn: src.received_lsn ? String(src.received_lsn) : null,
    latest_end_lsn: src.latest_end_lsn ? String(src.latest_end_lsn) : null,
    last_msg_receipt_age_seconds: asInt(src.last_msg_receipt_age_seconds),
    last_msg_send_age_seconds: asInt(src.last_msg_send_age_seconds),
    apply_error_count: asInt(src.apply_error_count),
    sync_error_count: asInt(src.sync_error_count),
    rel_count: asInt(src.rel_count),
    rel_ready_count: asInt(src.rel_ready_count),
    rel_states: states,
    last_apply_error: sanitizeApplyError(src.last_apply_error),
    posted_at_data_type: src.posted_at_data_type ? String(src.posted_at_data_type) : null,
  };
}

function lsnEqual(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

function receiptLooksFine(age) {
  return typeof age === "number" && age >= 0 && age <= HANDSHAKE_LAG_MAX_SECONDS;
}

function receiptStale(age) {
  return typeof age === "number" && age >= LSN_STALL_SECONDS;
}

function relationsStale(snap) {
  if (!snap.present) return false;
  if (snap.rel_count === 0) return true;
  if (snap.rel_count > 0 && snap.rel_ready_count === 0) return true;
  return false;
}

function errorsRising(snap, prev) {
  if (snap.apply_error_count === null) return false;
  if (!prev || prev.apply_error_count === null) {
    return snap.apply_error_count >= APPLY_ERROR_SPIKE;
  }
  return snap.apply_error_count > prev.apply_error_count;
}

function lsnUnchanged(snap, prev) {
  if (!prev) return false;
  if (!snap.received_lsn || !prev.received_lsn) return false;
  return lsnEqual(snap.received_lsn, prev.received_lsn);
}

/**
 * Classify apply health. Receipt-only lag can look fine during handshake retries;
 * apply_state is the signal that distinguishes that from a real LSN stall.
 */
export function classifyApplyHealth(rawSnapshot, rawPrevious = null) {
  const snap = normalizeSnapshot(rawSnapshot);
  const prev = rawPrevious ? normalizeSnapshot(rawPrevious) : null;

  if (!snap.present) {
    return {
      state: "absent",
      lag_seconds: snap.last_msg_receipt_age_seconds,
      apply_error_count: snap.apply_error_count,
      lsn_stalled: false,
      handshake_retry: false,
      reason: "no_subscription",
    };
  }

  if (!snap.enabled) {
    return {
      state: "disabled",
      lag_seconds: snap.last_msg_receipt_age_seconds,
      apply_error_count: snap.apply_error_count,
      lsn_stalled: false,
      handshake_retry: false,
      reason: "subscription_disabled",
    };
  }

  if (relationsStale(snap)) {
    return {
      state: "relations_stale",
      lag_seconds: snap.last_msg_receipt_age_seconds,
      apply_error_count: snap.apply_error_count,
      lsn_stalled: false,
      handshake_retry: false,
      reason: snap.rel_count === 0 ? "rel_count_zero" : "rel_not_ready",
    };
  }

  const errorSpike =
    (snap.apply_error_count ?? 0) >= APPLY_ERROR_SPIKE || errorsRising(snap, prev);
  const stalled = lsnUnchanged(snap, prev) || (receiptStale(snap.last_msg_receipt_age_seconds) && !snap.worker_present);
  const handshake =
    receiptLooksFine(snap.last_msg_receipt_age_seconds) &&
    (errorSpike || !snap.worker_present || (lsnUnchanged(snap, prev) && (snap.apply_error_count ?? 0) > 0));

  if (errorSpike && (lsnUnchanged(snap, prev) || !snap.worker_present || handshake)) {
    return {
      state: "crash_loop",
      lag_seconds: snap.last_msg_receipt_age_seconds,
      apply_error_count: snap.apply_error_count,
      lsn_stalled: lsnUnchanged(snap, prev),
      handshake_retry: handshake,
      reason: handshake ? "apply_errors_while_receipt_fresh" : "apply_errors_lsn_pinned",
    };
  }

  if (handshake) {
    return {
      state: "handshake_retry",
      lag_seconds: snap.last_msg_receipt_age_seconds,
      apply_error_count: snap.apply_error_count,
      lsn_stalled: false,
      handshake_retry: true,
      reason: snap.worker_present ? "receipt_fresh_apply_errors" : "receipt_fresh_worker_missing",
    };
  }

  if (stalled || receiptStale(snap.last_msg_receipt_age_seconds)) {
    return {
      state: "lsn_stalled",
      lag_seconds: snap.last_msg_receipt_age_seconds,
      apply_error_count: snap.apply_error_count,
      lsn_stalled: true,
      handshake_retry: false,
      reason: "lsn_or_receipt_stale",
    };
  }

  return {
    state: "healthy",
    lag_seconds: snap.last_msg_receipt_age_seconds,
    apply_error_count: snap.apply_error_count ?? 0,
    lsn_stalled: false,
    handshake_retry: false,
    reason: "apply_ok",
  };
}

export function reconnectBackoffSeconds(attempt) {
  const n = Math.max(0, Math.trunc(Number(attempt) || 0));
  return Math.min(64, 8 * 2 ** n);
}

function poisonAfterBudget(health, reconnectCount) {
  return (
    (health.state === "crash_loop" || health.state === "handshake_retry") &&
    reconnectCount >= MAX_AUTO_RECONNECTS
  );
}

/**
 * Documented skip/reconcile path. Returned as comments only — never an executable action.
 */
export function poisonTxnSignRecipe({ received_lsn, apply_error } = {}) {
  const lsn = received_lsn && !UNSAFE_VALUE.test(String(received_lsn)) ? String(received_lsn) : "<lsn>";
  const err = sanitizeApplyError(apply_error) || "(see apply worker / postgres log)";
  return [
    "NEEDS_SIGN poison transaction — do not auto SKIP.",
    `apply_error=${err}`,
    "1. Confirm the apply error on the subscriber (catalog + logs). Do not assume a schema class.",
    "2. If Admiral SIGNs a skip: ALTER SUBSCRIPTION exittrace_lab_sub SKIP (lsn = '" + lsn + "');",
    "3. Run et-gap-upsert (idempotent by id) for any skipped published row.",
    "4. ALTER SUBSCRIPTION exittrace_lab_sub ENABLE; prove LSN advances and apply_error_count stops rising.",
    "Never wipe tables, never enable copy_data, never DROP the subscription from this machine.",
  ].join("\n");
}

/**
 * Mode machine. Public default stays dump. logical is env-driven primary;
 * dump is cold standby and must not dual-write while logical is healthy.
 */
export function syncModeMachine({
  syncMode = "dump",
  dumpRestoreMode = "disabled",
  applyState = "absent",
  dumpColdFallbackArmed = false,
  unhealthyMs = 0,
} = {}) {
  const mode = syncMode === "logical" || syncMode === "dump" ? syncMode : null;
  if (!mode) {
    return { ok: false, reason: "invalid_sync_mode", dump: "refuse", logical: "refuse" };
  }
  if (mode === "dump") {
    return {
      ok: true,
      primary: "dump",
      dump: "scheduled",
      logical: applyState === "absent" ? "absent" : "optional",
      one_shot_dump: false,
      reason: "public_default_dump",
    };
  }
  // logical primary
  if (applyState === "healthy") {
    return {
      ok: true,
      primary: "logical",
      dump: "disabled",
      logical: "primary",
      one_shot_dump: false,
      reason: "logical_healthy_dump_standby",
    };
  }
  const sustained = unhealthyMs >= SUSTAINED_UNHEALTHY_MS;
  const allowDump = Boolean(dumpColdFallbackArmed) && sustained && applyState !== "absent";
  return {
    ok: true,
    primary: "logical",
    dump: dumpRestoreMode === "cold_fallback" ? "cold_fallback" : "disabled",
    logical: "primary_unhealthy",
    one_shot_dump: allowDump,
    gap_upsert: sustained,
    reason: allowDump
      ? "logical_unhealthy_sustained_dump_armed"
      : sustained
        ? "logical_unhealthy_sustained_gap_only"
        : "logical_unhealthy_observe",
  };
}

/**
 * Plan safe auto actions. Fail-closed: no SKIP, no wipe, no copy_data=true.
 */
export function planHeal(rawSnapshot, opts = {}) {
  const snap = normalizeSnapshot(rawSnapshot);
  const prev = opts.previous ? normalizeSnapshot(opts.previous) : null;
  const health = classifyApplyHealth(snap, prev);
  const reconnectCount = Math.max(0, Math.trunc(Number(opts.reconnectCount) || 0));
  const unhealthyMs = Math.max(0, Math.trunc(Number(opts.unhealthyMs) || 0));
  const dumpArmed = Boolean(opts.dumpColdFallbackArmed);
  const allowDumpFallback = Boolean(opts.allowDumpFallback);
  const syncMode = opts.syncMode === "logical" || opts.syncMode === "dump" ? opts.syncMode : "dump";

  const base = {
    state: health.state,
    health,
    actions: [],
    reason: health.reason,
    sign_required: false,
    skip_recipe: null,
    dump_fallback: false,
    gap_upsert: false,
    backoff_seconds: 0,
    apply_error: snap.last_apply_error,
    refresh_copy_data: false,
  };

  if (health.state === "absent") {
    return { ...base, actions: ["observe"], reason: "no_subscription_public_dump_ok" };
  }

  if (poisonAfterBudget(health, reconnectCount)) {
    return {
      ...base,
      state: "poison_txn",
      actions: ["needs_sign"],
      sign_required: true,
      skip_recipe: poisonTxnSignRecipe({
        received_lsn: snap.received_lsn,
        apply_error: snap.last_apply_error,
      }),
      reason: "reconnect_budget_exhausted",
    };
  }

  if (health.state === "disabled") {
    return {
      ...base,
      actions: ["reconnect"],
      backoff_seconds: reconnectBackoffSeconds(reconnectCount),
      reason: "enable_disabled_sub",
    };
  }

  if (health.state === "relations_stale") {
    return {
      ...base,
      actions: ["refresh_publication"],
      refresh_copy_data: false,
      reason: "refresh_copy_data_false_only",
    };
  }

  if (health.state === "healthy") {
    return { ...base, actions: ["observe"], reason: "apply_ok" };
  }

  const actions = [];
  if (health.state === "crash_loop" || health.state === "handshake_retry" || health.state === "lsn_stalled") {
    actions.push("reconnect");
  }

  const modes = syncModeMachine({
    syncMode,
    dumpRestoreMode: opts.dumpRestoreMode,
    applyState: health.state,
    dumpColdFallbackArmed: dumpArmed,
    unhealthyMs,
  });

  if (modes.gap_upsert) {
    actions.push("gap_upsert");
  }
  if (modes.one_shot_dump && allowDumpFallback) {
    actions.push("dump_cold_fallback");
  }

  if (!actions.length) actions.push("observe");

  return {
    ...base,
    actions,
    dump_fallback: actions.includes("dump_cold_fallback"),
    gap_upsert: actions.includes("gap_upsert"),
    backoff_seconds: actions.includes("reconnect") ? reconnectBackoffSeconds(reconnectCount) : 0,
    reason: modes.reason !== "logical_healthy_dump_standby" ? modes.reason : health.reason,
  };
}

/** SQL used by the heal script. $1 = subscription name. No host strings. */
export const APPLY_SNAPSHOT_SQL = `
SELECT
  EXISTS (SELECT 1 FROM pg_subscription WHERE subname = $1) AS present,
  COALESCE((SELECT subenabled FROM pg_subscription WHERE subname = $1), false) AS enabled,
  EXISTS (
    SELECT 1 FROM pg_stat_subscription WHERE subname = $1 AND pid IS NOT NULL
  ) AS worker_present,
  (SELECT received_lsn::text FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS received_lsn,
  (SELECT latest_end_lsn::text FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS latest_end_lsn,
  (SELECT EXTRACT(EPOCH FROM (now() - last_msg_receipt_time))::bigint
     FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS last_msg_receipt_age_seconds,
  (SELECT EXTRACT(EPOCH FROM (now() - last_msg_send_time))::bigint
     FROM pg_stat_subscription WHERE subname = $1 LIMIT 1) AS last_msg_send_age_seconds,
  (SELECT apply_error_count FROM pg_stat_subscription_stats WHERE subname = $1 LIMIT 1) AS apply_error_count,
  (SELECT sync_error_count FROM pg_stat_subscription_stats WHERE subname = $1 LIMIT 1) AS sync_error_count,
  (SELECT count(*)::int FROM pg_subscription_rel sr
     JOIN pg_subscription s ON s.oid = sr.srsubid WHERE s.subname = $1) AS rel_count,
  (SELECT count(*)::int FROM pg_subscription_rel sr
     JOIN pg_subscription s ON s.oid = sr.srsubid
    WHERE s.subname = $1 AND sr.srsubstate IN ('r', 's')) AS rel_ready_count
`.trim();

export const APPLY_REL_STATES_SQL = `
SELECT sr.srsubstate::text AS state
  FROM pg_subscription_rel sr
  JOIN pg_subscription s ON s.oid = sr.srsubid
 WHERE s.subname = $1
`.trim();

export const APPLY_WORKER_QUERY_SQL = `
SELECT query
  FROM pg_stat_activity
 WHERE pid IN (
   SELECT pid FROM pg_stat_subscription WHERE subname = $1 AND pid IS NOT NULL
 )
 LIMIT 1
`.trim();

export const POSTED_AT_TYPE_SQL = `
SELECT data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'dog_comms' AND column_name = 'posted_at'
`.trim();

export const HEAL_META_KEYS = Object.freeze({
  unhealthySince: "logical.heal.unhealthy_since",
  reconnectCount: "logical.heal.reconnect_count",
  lastAction: "logical.heal.last_action",
  lastState: "logical.heal.last_state",
  needsSign: "logical.heal.needs_sign",
  lastError: "logical.heal.last_error",
});
