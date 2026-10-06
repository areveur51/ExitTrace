/** et-daily-ingest.sh: honest prove + flock skip, with stubbed grok and apply helper.
 *  No DB: ET_DAILY_DRY_RUN=1 skips seeding/health/stamp, the helper is a stub. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LOCK_CLI_FLAGS, LOCK_MEDIA_DIR } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAILY = path.join(ROOT, "scripts", "et-daily-ingest.sh");
const ADD = path.join(ROOT, "scripts", "process-add-request.mjs");
const SEED = path.join(ROOT, "data", "seed.json");
const CITES = [
  "https://www.reuters.com/world/example-official-held-2026-10-06/",
  "https://apnews.com/article/example-official-held",
];
const ROW = {
  subject: "Casey Vale",
  category: "arrests",
  event_date: "2026-10-06",
  role: "Example role",
  cite_urls: CITES,
};

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-daily-test-"));
  const grok = path.join(dir, "grok-stub.sh");
  fs.writeFileSync(
    grok,
    `#!/bin/bash
echo called >> "$STUB_DIR/grok-calls"
[ -n "\${STUB_GROK_SLEEP:-}" ] && sleep "$STUB_GROK_SLEEP"
pf=""
while [ $# -gt 0 ]; do [ "$1" = "--prompt-file" ] && pf="$2"; shift; done
target=$(sed -n 's/.*write file \\(.*\\.json\\)\\.$/\\1/p' "$pf" | head -1)
if [ -n "\${STUB_APPLY_JSON:-}" ]; then printf '%s' "$STUB_APPLY_JSON" > "$target"; fi
exit 0
`,
    { mode: 0o755 },
  );
  const helper = path.join(dir, "helper-stub.mjs");
  fs.writeFileSync(
    helper,
    `import fs from "fs";
fs.appendFileSync(process.env.STUB_DIR + "/helper-calls", JSON.stringify(process.argv.slice(2)) + "\\n");
const code = Number(process.env.STUB_HELPER_EXIT || 0);
if (code === 0) console.log("add-process created person=casey-vale people=73 request=ar-stub");
else console.error("stub helper failure");
process.exit(code);
`,
  );
  return { dir, grok, helper };
}

function env(sb, extra = {}) {
  return {
    ...process.env,
    DATABASE_URL: "",
    ET_DAILY_DRY_RUN: "1",
    ET_DAILY_ROOT: ROOT,
    ET_DAILY_NODE: process.execPath,
    ET_DAILY_GROK: sb.grok,
    ET_DAILY_HELPER: sb.helper,
    ET_DAILY_TMP: sb.dir,
    ET_DAILY_LOCK: path.join(sb.dir, "et-daily-ingest.lock"),
    ET_DAILY_STAMP: path.join(sb.dir, "no-stamp"),
    STUB_DIR: sb.dir,
    ...extra,
  };
}

function runDaily(sb, extra = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [DAILY], { env: env(sb, extra), stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => out.push(c));
    child.on("close", (code) => resolve({ code, out: Buffer.concat(out).toString("utf8") }));
  });
}

function report(sb) {
  const f = fs.readdirSync(sb.dir).find((n) => /^et-daily-\d{8}-report\.md$/.test(n));
  return f ? fs.readFileSync(path.join(sb.dir, f), "utf8") : "";
}

function lastProve(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("prove="));
  return lines[lines.length - 1] || "";
}

function calls(sb, name) {
  const f = path.join(sb.dir, name);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean) : [];
}

test("daily: apply helper failure -> prove=FAIL apply_failed, exit 1", async () => {
  const sb = sandbox();
  const r = await runDaily(sb, {
    STUB_APPLY_JSON: JSON.stringify({ rows: [ROW], skipped: [] }),
    STUB_HELPER_EXIT: "1",
  });
  const rep = report(sb);
  assert.equal(r.code, 1, rep);
  assert.match(lastProve(rep), /^prove=FAIL reason=apply_failed picked=1 inserted=0 failed=1 /);
  assert.match(rep, /apply_exit=2/);
  const args = JSON.parse(calls(sb, "helper-calls")[0]);
  assert.deepEqual(args.slice(0, 7), ["--queue", "--subject", "Casey Vale", "--category", "arrests", "--event-date", "2026-10-06"]);
  assert.ok(args.includes("--cite-url"));
});

test("daily: grok picked rows but 0 inserted -> prove=FAIL picked_none_inserted", async () => {
  const sb = sandbox();
  const oneCite = { ...ROW, cite_urls: [CITES[0]] };
  const r = await runDaily(sb, {
    STUB_APPLY_JSON: JSON.stringify({ rows: [oneCite], skipped: [] }),
  });
  const rep = report(sb);
  assert.equal(r.code, 1, rep);
  assert.match(lastProve(rep), /^prove=FAIL reason=picked_none_inserted picked=1 inserted=0 failed=0 /);
  assert.equal(calls(sb, "helper-calls").length, 0);
});

test("daily: row applied -> prove=PASS", async () => {
  const sb = sandbox();
  const r = await runDaily(sb, { STUB_APPLY_JSON: JSON.stringify({ rows: [ROW], skipped: [] }) });
  const rep = report(sb);
  assert.equal(r.code, 0, rep);
  assert.match(lastProve(rep), /^prove=PASS picked=1 inserted=1 failed=0 /);
});

test("daily: grok picked 0 -> prove=PASS_EMPTY", async () => {
  const sb = sandbox();
  const r = await runDaily(sb, {
    STUB_APPLY_JSON: JSON.stringify({ rows: [], skipped: [{ subject: "X", reason: "no-cites" }] }),
  });
  const rep = report(sb);
  assert.equal(r.code, 0, rep);
  assert.match(lastProve(rep), /^prove=PASS_EMPTY picked=0 inserted=0 failed=0 /);
  assert.equal(calls(sb, "helper-calls").length, 0);
});

test("daily: no apply.json (stale one removed) -> prove=FAIL missing-apply-json", async () => {
  const sb = sandbox();
  const day = spawnSync("date", ["+%Y%m%d"], { env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(sb.dir, `et-daily-${day}-apply.json`), JSON.stringify({ rows: [ROW] }));
  const r = await runDaily(sb, {});
  const rep = report(sb);
  assert.equal(r.code, 1, rep);
  assert.match(lastProve(rep), /^prove=FAIL reason=missing-apply-json /);
  assert.equal(calls(sb, "helper-calls").length, 0);
});

test("daily: second concurrent run skips on the flock and keeps the first report", async () => {
  const sb = sandbox();
  const extra = { STUB_APPLY_JSON: JSON.stringify({ rows: [ROW], skipped: [] }), STUB_GROK_SLEEP: "3" };
  const first = runDaily(sb, extra);
  const t0 = Date.now();
  while (calls(sb, "grok-calls").length === 0 && Date.now() - t0 < 10000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(calls(sb, "grok-calls").length, 1, "first run reached grok");
  const second = await runDaily(sb, extra);
  assert.equal(second.code, 0);
  const mid = report(sb);
  assert.match(mid, /prove=SKIP_LOCKED/);
  assert.match(mid, /^et-daily start /, "first run's report header kept");
  const r1 = await first;
  const rep = report(sb);
  assert.equal(r1.code, 0, rep);
  assert.equal(calls(sb, "grok-calls").length, 1, "second run never started grok");
  assert.match(lastProve(rep), /^prove=PASS picked=1 inserted=1 /);
  // Lock released after the first run: a third run proceeds.
  const third = await runDaily(sb, { STUB_APPLY_JSON: JSON.stringify({ rows: [], skipped: [] }) });
  assert.equal(third.code, 0);
  assert.match(lastProve(report(sb)), /^prove=PASS_EMPTY /);
});

test("daily: another grok being up does not skip the daily", async () => {
  const sb = sandbox();
  const fake = path.join(sb.dir, "grok");
  fs.copyFileSync("/bin/sleep", fake);
  fs.chmodSync(fake, 0o755);
  const other = spawn(fake, ["30"], { stdio: "ignore" });
  try {
    const r = await runDaily(sb, { STUB_APPLY_JSON: JSON.stringify({ rows: [ROW], skipped: [] }) });
    const rep = report(sb);
    assert.equal(r.code, 0, rep);
    assert.doesNotMatch(rep, /grok already up/);
    assert.match(lastProve(rep), /^prove=PASS /);
  } finally {
    other.kill("SIGTERM");
  }
});

test("daily: dry run without helper plans rows and writes nothing", async () => {
  const sb = sandbox();
  const e = { STUB_APPLY_JSON: JSON.stringify({ rows: [ROW], skipped: [] }), ET_DAILY_HELPER: "" };
  const r = await runDaily(sb, e);
  const rep = report(sb);
  assert.equal(r.code, 0, rep);
  assert.match(lastProve(rep), /^prove=DRY_RUN picked=1 inserted=0 failed=0 /);
  assert.match(rep, /"planned": 1/);
  assert.equal(calls(sb, "helper-calls").length, 0);
});

test("process-add-request --queue parks then applies a person (file store)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "et-queue-"));
  fs.copyFileSync(SEED, path.join(tmp, "seed.json"));
  const run = spawnSync(
    process.execPath,
    [
      ADD, "--queue",
      "--subject", "Casey Vale", "--category", "arrests", "--event-date", "2024-06-15",
      "--cite-url", "https://www.example.com/news/casey-vale-held",
      "--cite-url", "https://www.example.net/world/casey-vale-arrest",
      ...LOCK_CLI_FLAGS,
    ],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: "", DATA_DIR: tmp, MEDIA_DIR: LOCK_MEDIA_DIR }, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /add-queue created request=ar-/);
  assert.match(run.stdout, /add-process created person=casey-vale/);
  const store = JSON.parse(fs.readFileSync(path.join(tmp, "store.json"), "utf8"));
  assert.ok(store.people.some((p) => p.id === "casey-vale"));

  const bad = spawnSync(process.execPath, [ADD, "--queue", "--next"], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: "", DATA_DIR: tmp }, encoding: "utf8",
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--queue cannot be combined/);
});
