import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { healthBody } from "../app/lib/html.mjs";
import {
  KEEP_UP_META_KEY_LIST,
  KEEP_UP_META_KEYS,
  KEEP_UP_TIMEZONE,
  buildKeepUp,
  emptyKeepUp,
  formatNyTimestamp,
  publicDumpRestoreMode,
  publicLagSeconds,
  publicTimestamp,
  stampPayload,
} from "../app/lib/keep-up.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assertKeepUpShape(keep) {
  assert.equal(keep.timezone, KEEP_UP_TIMEZONE);
  assert.equal(typeof keep.logical, "object");
  assert.ok("stream_started" in keep.logical);
  assert.ok("last_verify" in keep.logical);
  assert.ok("lag_seconds" in keep.logical);
  assert.ok("apply_state" in keep.logical);
  assert.ok("apply_error_count" in keep.logical);
  assert.ok("last_success" in keep.media_delta);
  assert.ok("last_with_files" in keep.media_delta);
  assert.ok("last_pass" in keep.daily_ingest);
  assert.ok("last_pass" in keep.daily_pack);
  assert.ok("last_success" in keep.dump_restore);
  assert.ok("mode" in keep.dump_restore);
}

test("empty keep_up has the public shape and null stamps", () => {
  const keep = emptyKeepUp();
  assertKeepUpShape(keep);
  assert.equal(keep.logical.stream_started, null);
  assert.equal(keep.logical.last_verify, null);
  assert.equal(keep.logical.lag_seconds, null);
  assert.equal(keep.logical.apply_state, null);
  assert.equal(keep.logical.apply_error_count, null);
  assert.equal(keep.media_delta.last_success, null);
  assert.equal(keep.media_delta.last_with_files, null);
  assert.equal(keep.daily_ingest.last_pass, null);
  assert.equal(keep.daily_pack.last_pass, null);
  assert.equal(keep.dump_restore.last_success, null);
  assert.equal(keep.dump_restore.mode, null);
});

test("timestamps are America/New_York ISO with offset", () => {
  assert.equal(formatNyTimestamp("2026-01-15T17:00:00.000Z"), "2026-01-15T12:00:00-05:00");
  assert.equal(formatNyTimestamp("2026-07-15T16:00:00.000Z"), "2026-07-15T12:00:00-04:00");
  assert.equal(publicTimestamp({ at: "2026-01-15T17:00:00.000Z" }), "2026-01-15T12:00:00-05:00");
  assert.equal(publicTimestamp({ last_pass: "2026-07-15T16:00:00.000Z" }), "2026-07-15T12:00:00-04:00");
});

test("public keep_up drops secrets, hosts, and instance ids", () => {
  assert.equal(publicTimestamp("postgres://user:pass@example.com/db"), null);
  assert.equal(publicTimestamp({ at: "https://example.com" }), null);
  assert.equal(publicTimestamp({ at: "user@example.com" }), null);
  assert.equal(publicTimestamp({ at: "dpg-example-a" }), null);
  assert.equal(publicTimestamp({ at: "203.0.113.10" }), null);
  assert.equal(publicTimestamp({ at: "203.0.113.0/24" }), null);
  const keep = buildKeepUp({
    [KEEP_UP_META_KEYS.logicalStreamStarted]: { at: "postgres://x" },
    [KEEP_UP_META_KEYS.dumpRestoreMode]: { mode: "cold_fallback", host: "example.com" },
  });
  assert.equal(keep.logical.stream_started, null);
  assert.equal(keep.dump_restore.mode, "cold_fallback");
});

test("live apply_state and apply_error_count are public-safe", () => {
  const keep = buildKeepUp({}, { applyState: "crash_loop", applyErrorCount: 12, lagSeconds: 1 });
  assert.equal(keep.logical.apply_state, "crash_loop");
  assert.equal(keep.logical.apply_error_count, 12);
  assert.equal(keep.logical.lag_seconds, 1);
  assert.equal(buildKeepUp({}, { applyState: "truncate" }).logical.apply_state, null);
  assert.equal(buildKeepUp({}, { applyState: "postgres://x" }).logical.apply_state, null);
});

test("live lag wins over stored lag; bad lag is null", () => {
  const stored = buildKeepUp(
    { [KEEP_UP_META_KEYS.logicalLagSeconds]: { lag_seconds: 40 } },
    { lagSeconds: 3 },
  );
  assert.equal(stored.logical.lag_seconds, 3);
  const fallback = buildKeepUp({
    [KEEP_UP_META_KEYS.logicalLagSeconds]: { lag_seconds: 40 },
  });
  assert.equal(fallback.logical.lag_seconds, 40);
  assert.equal(publicLagSeconds("nope"), null);
  assert.equal(publicLagSeconds(-2), 0);
});

test("dump_restore mode is cold_fallback or disabled only", () => {
  assert.equal(publicDumpRestoreMode({ mode: "cold_fallback" }), "cold_fallback");
  assert.equal(publicDumpRestoreMode("disabled"), "disabled");
  assert.equal(publicDumpRestoreMode("dump"), null);
  assert.equal(publicDumpRestoreMode({ mode: "logical" }), null);
});

test("stampPayload writes the et_meta JSON shape", () => {
  const iso = "2026-03-01T15:00:00.000Z";
  assert.deepEqual(stampPayload(KEEP_UP_META_KEYS.dailyIngestLastPass, { at: iso }), {
    at: iso,
  });
  assert.deepEqual(stampPayload(KEEP_UP_META_KEYS.dumpRestoreMode, { mode: "disabled" }), {
    mode: "disabled",
  });
  assert.throws(() => stampPayload("seed"), /unknown/);
  assert.throws(
    () => stampPayload(KEEP_UP_META_KEYS.dumpRestoreMode, { mode: "dump" }),
    /cold_fallback or disabled/,
  );
});

test("health HTML shows keep_up facts and the JSON payload", () => {
  const payload = {
    ok: true,
    ready: true,
    keep_up: buildKeepUp({
      [KEEP_UP_META_KEYS.dailyPackLastPass]: { at: "2026-07-15T16:00:00.000Z" },
    }),
  };
  const html = healthBody(payload);
  assert.match(html, /keep_up/);
  assert.match(html, /logical\.apply_state/);
  assert.match(html, /daily_ingest\.last_pass/);
  assert.match(html, /2026-07-15T12:00:00-04:00/);
  assert.match(html, /America\/New_York/);
});

test("health and keep-up code do not read SYNC_MODE", () => {
  const files = [
    "app/lib/keep-up.mjs",
    "app/server.mjs",
    "scripts/stamp-keep-up.mjs",
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.doesNotMatch(text, /SYNC_MODE/);
  }
});

test("Actions writers upsert documented et_meta keys", () => {
  const verify = fs.readFileSync(
    path.join(ROOT, ".github/workflows/et-cutover-verify.yml"),
    "utf8",
  );
  const restore = fs.readFileSync(
    path.join(ROOT, ".github/workflows/lab-to-render-sync.yml"),
    "utf8",
  );
  const doc = fs.readFileSync(path.join(ROOT, "docs/github-auto-deploy.md"), "utf8");
  assert.match(verify, /keep_up\.logical\.last_verify/);
  assert.match(verify, /ON CONFLICT \(k\) DO UPDATE SET v = EXCLUDED\.v/);
  assert.match(restore, /keep_up\.dump_restore\.last_success/);
  assert.match(restore, /keep_up\.dump_restore\.mode/);
  assert.match(restore, /cold_fallback/);
  for (const key of KEEP_UP_META_KEY_LIST) {
    assert.match(doc, new RegExp(key.replace(/\./g, "\\.")));
  }
  assert.match(doc, /America\/New_York/);
  assert.doesNotMatch(doc, /dpg-/);
});
