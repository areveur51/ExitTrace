import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  APPLY_ERROR_SPIKE,
  APPLY_SNAPSHOT_SQL,
  APPLY_STATES,
  HEAL_META_KEYS,
  LOGICAL_SUB_NAME,
  MAX_AUTO_RECONNECTS,
  SUSTAINED_UNHEALTHY_MS,
  classifyApplyHealth,
  isLogicalSubscriber,
  planHeal,
  poisonTxnSignRecipe,
  publicApplyErrorCount,
  publicHealthApplyState,
  publicApplyState,
  publicGitSha,
  reconnectBackoffSeconds,
  sanitizeApplyError,
  syncModeMachine,
} from "../app/lib/logical-heal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function snap(over = {}) {
  return {
    present: true,
    enabled: true,
    worker_present: true,
    received_lsn: "0/100",
    latest_end_lsn: "0/100",
    last_msg_receipt_age_seconds: 3,
    last_msg_send_age_seconds: 3,
    apply_error_count: 0,
    sync_error_count: 0,
    rel_count: 7,
    rel_ready_count: 7,
    rel_states: ["r", "r", "r", "r", "r", "r", "r"],
    last_apply_error: null,
    posted_at_data_type: "text",
    ...over,
  };
}

test("public apply_state and error count are allowlisted", () => {
  for (const s of APPLY_STATES) assert.equal(publicApplyState(s), s);
  assert.equal(publicApplyState({ apply_state: "crash_loop" }), "crash_loop");
  assert.equal(publicApplyState("truncate"), null);
  assert.equal(publicApplyState({ apply_state: "postgres://x" }), null);
  assert.equal(publicApplyErrorCount({ apply_error_count: 12 }), 12);
  assert.equal(publicApplyErrorCount(-4), 0);
  assert.equal(publicApplyErrorCount("nope"), null);
});

test("publisher / no pg_subscription is not a public subscriber absent alarm", () => {
  assert.equal(isLogicalSubscriber({ present: false }), false);
  assert.equal(isLogicalSubscriber(false), false);
  assert.equal(isLogicalSubscriber({ present: true }), true);
  const none = classifyApplyHealth({ present: false });
  assert.equal(none.state, "absent");
  assert.equal(none.subscriber, false);
  assert.equal(none.reason, "no_subscription");
  assert.notEqual(none.state, "crash_loop");
  assert.equal(publicHealthApplyState(none.state), null);
  assert.equal(publicHealthApplyState("absent"), null);
  assert.equal(publicHealthApplyState("crash_loop"), "crash_loop");
  assert.equal(publicHealthApplyState(null), null);
  const observe = planHeal({ present: false });
  assert.deepEqual(observe.actions, ["observe"]);
  assert.equal(observe.actions.includes("skip_lsn"), false);
});

test("publicGitSha accepts only hex SHAs", () => {
  assert.equal(publicGitSha("0d3c54f"), "0d3c54f");
  assert.equal(publicGitSha("ABCDEF12"), "abcdef12");
  assert.equal(publicGitSha("main"), null);
  assert.equal(publicGitSha("https://example.com"), null);
  assert.equal(publicGitSha("dpg-example"), null);
});

test("sanitizeApplyError strips urls, mails, and instance ids", () => {
  const s = sanitizeApplyError(
    "could not connect to postgres://user:pw@example.com/db dpg-abc123 user@host.tld",
  );
  assert.doesNotMatch(s, /postgres:/);
  assert.doesNotMatch(s, /dpg-/);
  assert.doesNotMatch(s, /@/);
  assert.match(s, /redacted/);
});

test("healthy vs handshake_retry vs crash_loop vs lsn_stalled", () => {
  assert.equal(classifyApplyHealth(snap()).state, "healthy");
  assert.equal(classifyApplyHealth({ present: false }).state, "absent");
  assert.equal(classifyApplyHealth(snap({ enabled: false })).state, "disabled");
  assert.equal(classifyApplyHealth(snap({ rel_count: 0, rel_ready_count: 0 })).state, "relations_stale");

  const handshake = classifyApplyHealth(
    snap({ apply_error_count: 4, worker_present: false, last_msg_receipt_age_seconds: 2 }),
  );
  assert.equal(handshake.state, "handshake_retry");
  assert.equal(handshake.handshake_retry, true);

  const loop = classifyApplyHealth(
    snap({
      apply_error_count: APPLY_ERROR_SPIKE,
      last_msg_receipt_age_seconds: 2,
      worker_present: false,
    }),
    snap({ apply_error_count: 3, received_lsn: "0/100" }),
  );
  assert.equal(loop.state, "crash_loop");
  assert.equal(loop.handshake_retry, true);

  const stall = classifyApplyHealth(
    snap({
      apply_error_count: 0,
      last_msg_receipt_age_seconds: 120,
      worker_present: false,
    }),
  );
  assert.equal(stall.state, "lsn_stalled");
  assert.equal(stall.lsn_stalled, true);
});

test("receipt-fresh lag can hide a crash_loop (the 10:23 class)", () => {
  const health = classifyApplyHealth(
    snap({
      apply_error_count: 4000,
      last_msg_receipt_age_seconds: 1,
      worker_present: false,
      received_lsn: "0/AAA",
    }),
    snap({ apply_error_count: 3990, received_lsn: "0/AAA" }),
  );
  assert.equal(health.state, "crash_loop");
  assert.equal(health.lag_seconds, 1);
  assert.equal(health.handshake_retry, true);
});

test("planHeal reconnects, refreshes only copy_data=false, never skips", () => {
  const reconnect = planHeal(snap({ enabled: false }));
  assert.deepEqual(reconnect.actions, ["reconnect"]);

  const refresh = planHeal(snap({ rel_count: 0, rel_ready_count: 0 }));
  assert.deepEqual(refresh.actions, ["refresh_publication"]);
  assert.equal(refresh.refresh_copy_data, false);

  const ok = planHeal(snap());
  assert.deepEqual(ok.actions, ["observe"]);

  const poison = planHeal(
    snap({ apply_error_count: 50, worker_present: false }),
    { reconnectCount: MAX_AUTO_RECONNECTS },
  );
  assert.equal(poison.state, "poison_txn");
  assert.deepEqual(poison.actions, ["needs_sign"]);
  assert.equal(poison.sign_required, true);
  assert.match(poison.skip_recipe, /NEEDS_SIGN/);
  assert.match(poison.skip_recipe, /SKIP/);
  assert.equal(poison.actions.includes("skip_lsn"), false);
});

test("dump cold-fallback is double-gated and only when logical is sustained-unhealthy", () => {
  const healthy = syncModeMachine({
    syncMode: "logical",
    applyState: "healthy",
    dumpColdFallbackArmed: true,
    unhealthyMs: SUSTAINED_UNHEALTHY_MS,
  });
  assert.equal(healthy.one_shot_dump, false);
  assert.equal(healthy.dump, "disabled");

  const dumpDefault = syncModeMachine({ syncMode: "dump", applyState: "absent" });
  assert.equal(dumpDefault.primary, "dump");
  assert.equal(dumpDefault.dump, "scheduled");

  const armed = planHeal(
    snap({ apply_error_count: 20, last_msg_receipt_age_seconds: 90, worker_present: false }),
    {
      syncMode: "logical",
      reconnectCount: 0,
      unhealthyMs: SUSTAINED_UNHEALTHY_MS,
      dumpColdFallbackArmed: true,
      allowDumpFallback: true,
    },
  );
  assert.ok(armed.actions.includes("reconnect"));
  assert.ok(armed.actions.includes("dump_cold_fallback"));
  assert.ok(armed.actions.includes("gap_upsert"));

  const notArmed = planHeal(
    snap({ apply_error_count: 20, last_msg_receipt_age_seconds: 90, worker_present: false }),
    {
      syncMode: "logical",
      unhealthyMs: SUSTAINED_UNHEALTHY_MS,
      dumpColdFallbackArmed: true,
      allowDumpFallback: false,
    },
  );
  assert.equal(notArmed.actions.includes("dump_cold_fallback"), false);
  assert.ok(notArmed.actions.includes("gap_upsert"));
});

test("invalid SYNC_MODE fails closed in the mode machine", () => {
  const bad = syncModeMachine({ syncMode: "both" });
  assert.equal(bad.ok, false);
  assert.equal(bad.dump, "refuse");
});

test("reconnect backoff is 8, 16, 32, 64", () => {
  assert.equal(reconnectBackoffSeconds(0), 8);
  assert.equal(reconnectBackoffSeconds(1), 16);
  assert.equal(reconnectBackoffSeconds(2), 32);
  assert.equal(reconnectBackoffSeconds(3), 64);
  assert.equal(reconnectBackoffSeconds(9), 64);
});

test("poison recipe documents SIGN skip and gap upsert, not auto-run", () => {
  const recipe = poisonTxnSignRecipe({
    received_lsn: "0/BEEF",
    apply_error: "invalid input syntax for type date",
  });
  assert.match(recipe, /0\/BEEF/);
  assert.match(recipe, /et-gap-upsert/);
  assert.match(recipe, /NEEDS_SIGN/);
  assert.doesNotMatch(recipe, /TRUNCATE/);
});

test("snapshot SQL is parameterized and names the locked sub only", () => {
  assert.match(APPLY_SNAPSHOT_SQL, /\$1/);
  assert.doesNotMatch(APPLY_SNAPSHOT_SQL, /TRUNCATE/);
  assert.equal(LOGICAL_SUB_NAME, "exittrace_lab_sub");
  assert.ok(HEAL_META_KEYS.needsSign);
});

test("heal library and keep-up do not read process SYNC_MODE", () => {
  const files = [
    "app/lib/logical-heal.mjs",
    "app/lib/keep-up.mjs",
    "app/lib/store.mjs",
    "app/server.mjs",
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.doesNotMatch(text, /process\.env\.SYNC_MODE/);
  }
});

test("boot heal is subscriber-only and never auto-SKIPs LSN", () => {
  const store = fs.readFileSync(path.join(ROOT, "app/lib/store.mjs"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "app/server.mjs"), "utf8");
  const heal = fs.readFileSync(path.join(ROOT, "app/lib/logical-heal.mjs"), "utf8");
  const keep = fs.readFileSync(path.join(ROOT, "app/lib/keep-up.mjs"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "scripts/logical-apply-heal.mjs"), "utf8");
  assert.match(store, /EXISTS \(SELECT 1 FROM pg_subscription\)/);
  assert.match(store, /isLogicalSubscriber/);
  assert.match(store, /no_subscription/);
  assert.doesNotMatch(store, /ALTER SUBSCRIPTION\s+[A-Za-z_][A-Za-z0-9_]*\s+SKIP/);
  assert.doesNotMatch(store, /SKIP \(lsn\s*=/);
  assert.doesNotMatch(store, /0\/D4F63B50|0\/D4F653A8|0\/D4F65440/);
  assert.doesNotMatch(server, /SKIP \(lsn\s*=/);
  assert.doesNotMatch(heal, /actions\.push\(["']skip/);
  assert.doesNotMatch(script, /ALTER SUBSCRIPTION[^\n]*SKIP/);
  assert.match(keep, /isLogicalSubscriber/);
  assert.match(keep, /publicHealthApplyState/);
});
