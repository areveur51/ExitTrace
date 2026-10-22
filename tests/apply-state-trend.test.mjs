/**
 * Worf: /api/health reported apply_state=crash_loop after the apply worker had
 * recovered, because apply_error_count is cumulative (pg_stat_subscription_stats)
 * and the classifier treated any total >= 10 as a spike. Public health now uses
 * the change over a window (createApplyErrorTrend), not the total.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPLY_ERROR_WINDOW_MS,
  classifyApplyHealth,
  createApplyErrorTrend,
} from "../app/lib/logical-heal.mjs";
import { classifyHealthApply } from "../app/lib/keep-up.mjs";

/** The live Render shape at 17:00 ET: count flat at 216536, lag 0, worker up. */
function live(over = {}) {
  return {
    present: true,
    enabled: true,
    worker_present: true,
    received_lsn: "0/5A000100",
    latest_end_lsn: "0/5A000100",
    last_msg_receipt_age_seconds: 0,
    apply_error_count: 216536,
    rel_count: 16,
    rel_ready_count: 16,
    ...over,
  };
}

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    tick(ms) {
      t += ms;
    },
  };
}

test("the bug: cumulative count alone still reads crash_loop without a trend (heal path unchanged)", () => {
  assert.equal(classifyApplyHealth(live()).state, "crash_loop");
});

test("recovered worker: flat high count + active worker is healthy, from the first sample on", () => {
  const c = clock();
  const trend = createApplyErrorTrend({ now: c.now });
  const first = classifyHealthApply(live(), trend);
  assert.equal(first.state, "healthy", "no baseline yet: the total is not a spike");
  assert.equal(first.apply_error_count, 216536, "the public count is still the live total");
  for (let i = 0; i < 5; i += 1) {
    c.tick(60_000);
    assert.equal(classifyHealthApply(live(), trend).state, "healthy");
  }
});

test("a count that goes up is crash_loop until it has been flat for the window", () => {
  const c = clock();
  const trend = createApplyErrorTrend({ now: c.now });
  assert.equal(classifyHealthApply(live({ apply_error_count: 100 }), trend).state, "healthy");
  c.tick(30_000);
  const rising = classifyHealthApply(live({ apply_error_count: 105 }), trend);
  assert.equal(rising.state, "crash_loop");
  c.tick(APPLY_ERROR_WINDOW_MS - 1000);
  assert.equal(classifyHealthApply(live({ apply_error_count: 105 }), trend).state, "crash_loop", "still inside the window");
  c.tick(2000);
  assert.equal(classifyHealthApply(live({ apply_error_count: 105 }), trend).state, "healthy", "flat for the whole window");
});

test("rising count with the worker gone is crash_loop", () => {
  const c = clock();
  const trend = createApplyErrorTrend({ now: c.now });
  classifyHealthApply(live({ apply_error_count: 7 }), trend);
  c.tick(5000);
  assert.equal(classifyHealthApply(live({ apply_error_count: 8, worker_present: false }), trend).state, "crash_loop");
});

test("flat count + worker missing but LSN advancing is healthy", () => {
  const c = clock();
  const trend = createApplyErrorTrend({ now: c.now });
  classifyHealthApply(live({ worker_present: false }), trend);
  c.tick(15_000);
  const moved = classifyHealthApply(
    live({ worker_present: false, received_lsn: "0/5A000200", latest_end_lsn: "0/5A000180" }),
    trend,
  );
  assert.equal(moved.state, "healthy");
  c.tick(15_000);
  const latestOnly = createApplyErrorTrend({ now: c.now });
  classifyHealthApply(live({ worker_present: false }), latestOnly);
  c.tick(1000);
  assert.equal(
    classifyHealthApply(live({ worker_present: false, latest_end_lsn: "0/5A000300" }), latestOnly).state,
    "healthy",
    "latest_end_lsn moving alone counts",
  );
});

test("flat count + worker missing + nothing moving is not crash_loop (handshake_retry / lsn_stalled)", () => {
  const c = clock();
  const trend = createApplyErrorTrend({ now: c.now });
  const fresh = classifyHealthApply(live({ worker_present: false }), trend);
  assert.equal(fresh.state, "handshake_retry");
  c.tick(1000);
  const stale = classifyHealthApply(live({ worker_present: false, last_msg_receipt_age_seconds: 600 }), trend);
  assert.equal(stale.state, "lsn_stalled");
});

test("a stats reset (count drops) is a new baseline, not a rise", () => {
  const c = clock();
  const trend = createApplyErrorTrend({ now: c.now });
  classifyHealthApply(live({ apply_error_count: 216536 }), trend);
  c.tick(1000);
  assert.equal(classifyHealthApply(live({ apply_error_count: 0 }), trend).state, "healthy");
  c.tick(1000);
  assert.equal(classifyHealthApply(live({ apply_error_count: 1 }), trend).state, "crash_loop");
});

test("trend: null before a baseline, then rising / flat with time since the last increase", () => {
  const c = clock();
  const trend = createApplyErrorTrend({ windowMs: 60_000, now: c.now });
  assert.equal(trend.observe(live({ apply_error_count: 5 })).rising, null);
  c.tick(10_000);
  const up = trend.observe(live({ apply_error_count: 6 }));
  assert.equal(up.rising, true);
  assert.equal(up.since_last_increase_ms, 0);
  c.tick(61_000);
  const flat = trend.observe(live({ apply_error_count: 6 }));
  assert.equal(flat.rising, false);
  assert.equal(flat.since_last_increase_ms, 61_000);
  assert.equal(trend.observe(live({ apply_error_count: null })).rising, null, "unknown count is not a rise");
});

test("disabled / relations_stale / absent still win over the trend", () => {
  const trend = createApplyErrorTrend();
  assert.equal(classifyHealthApply(live({ enabled: false }), trend).state, "disabled");
  assert.equal(classifyHealthApply(live({ rel_count: 0, rel_ready_count: 0 }), trend).state, "relations_stale");
  assert.equal(classifyHealthApply({ present: false }, trend).state, "absent");
});
