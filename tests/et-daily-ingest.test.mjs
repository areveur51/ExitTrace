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
pwd > "$STUB_DIR/grok-cwd"
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

function runDaily(sb, extra = {}, drop = []) {
  const e = env(sb, extra);
  for (const k of drop) delete e[k];
  return new Promise((resolve) => {
    const child = spawn("bash", [DAILY], { env: e, stdio: ["ignore", "pipe", "pipe"] });
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

test("daily: grok runs in ET_DAILY_GROK_CWD; the default is the repo root", async () => {
  const sb = sandbox();
  const scratch = fs.mkdtempSync(path.join(sb.dir, "grok-cwd-"));
  const apply = { STUB_APPLY_JSON: JSON.stringify({ rows: [], skipped: [] }) };
  const r = await runDaily(sb, { ...apply, ET_DAILY_GROK_CWD: scratch });
  const rep = report(sb);
  assert.equal(r.code, 0, rep);
  assert.equal(fs.readFileSync(path.join(sb.dir, "grok-cwd"), "utf8").trim(), fs.realpathSync(scratch));
  assert.match(rep, new RegExp(`grok start max-turns=2 cwd=${scratch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const d = await runDaily(sb, apply);
  assert.equal(d.code, 0, report(sb));
  assert.equal(fs.readFileSync(path.join(sb.dir, "grok-cwd"), "utf8").trim(), fs.realpathSync(ROOT));
});

test("daily: a missing ET_DAILY_GROK_CWD -> prove=FAIL grok_cwd_missing, grok not started", async () => {
  const sb = sandbox();
  const r = await runDaily(sb, {
    STUB_APPLY_JSON: JSON.stringify({ rows: [ROW], skipped: [] }),
    ET_DAILY_GROK_CWD: path.join(sb.dir, "no-such-dir"),
  });
  const rep = report(sb);
  assert.equal(r.code, 1, rep);
  assert.match(lastProve(rep), /^prove=FAIL reason=grok_cwd_missing/);
  assert.equal(calls(sb, "grok-calls").length, 0);
});

test("daily: without ET_DAILY_TMP/ET_DAILY_LOCK it uses a private mktemp dir and a private cache lock", async () => {
  const sb = sandbox();
  const xdg = path.join(sb.dir, "xdg");
  fs.mkdirSync(path.join(xdg, "et-daily"), { recursive: true, mode: 0o755 });
  fs.chmodSync(path.join(xdg, "et-daily"), 0o755);
  const r = await runDaily(
    sb,
    { STUB_APPLY_JSON: JSON.stringify({ rows: [], skipped: [] }), TMPDIR: sb.dir, XDG_CACHE_HOME: xdg },
    ["ET_DAILY_TMP", "ET_DAILY_LOCK"],
  );
  const work = fs.readdirSync(sb.dir).filter((n) => /^et-daily\.[A-Za-z0-9]{8}$/.test(n));
  assert.equal(work.length, 1, `one mktemp work dir: ${fs.readdirSync(sb.dir)}`);
  const wdir = path.join(sb.dir, work[0]);
  assert.equal(fs.statSync(wdir).mode & 0o777, 0o700);
  const repFile = fs.readdirSync(wdir).find((n) => /^et-daily-\d{8}-report\.md$/.test(n));
  assert.ok(repFile, "report lives in the work dir");
  const rep = fs.readFileSync(path.join(wdir, repFile), "utf8");
  assert.equal(r.code, 0, rep);
  assert.match(lastProve(rep), /^prove=PASS_EMPTY /);
  assert.match(r.out, new RegExp(`^report=${path.join(wdir, repFile).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  const lockDir = path.join(xdg, "et-daily");
  assert.match(rep, new RegExp(`lock=${lockDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/et-daily-ingest\\.lock`));
  assert.ok(fs.existsSync(path.join(lockDir, "et-daily-ingest.lock")));
  assert.equal(fs.statSync(lockDir).mode & 0o777, 0o700, "existing lock dir tightened to 0700");
  assert.ok(!fs.existsSync(path.join(sb.dir, "et-daily-ingest.lock")), "no lock in the tmp dir");
  assert.ok(!fs.readdirSync(wdir).includes("et-daily-prompt.md"), "no extra prompt copy");

  // HOME fallback when XDG_CACHE_HOME is unset; the cache dir is created 0700.
  const home = path.join(sb.dir, "home");
  fs.mkdirSync(home);
  const h = await runDaily(
    sb,
    { STUB_APPLY_JSON: JSON.stringify({ rows: [], skipped: [] }), TMPDIR: sb.dir, HOME: home },
    ["ET_DAILY_TMP", "ET_DAILY_LOCK", "XDG_CACHE_HOME"],
  );
  assert.equal(h.code, 0, h.out);
  assert.ok(fs.existsSync(path.join(home, ".cache", "et-daily", "et-daily-ingest.lock")));
  assert.equal(fs.statSync(path.join(home, ".cache", "et-daily")).mode & 0o777, 0o700);
});

test("daily: a symlinked default lock dir fails closed before any mkdir or chmod", async () => {
  const sb = sandbox();
  const xdg = path.join(sb.dir, "xdg");
  const elsewhere = path.join(sb.dir, "elsewhere");
  fs.mkdirSync(xdg);
  fs.mkdirSync(elsewhere);
  fs.chmodSync(elsewhere, 0o755);
  fs.symlinkSync(elsewhere, path.join(xdg, "et-daily"));
  const r = await runDaily(
    sb,
    { STUB_APPLY_JSON: JSON.stringify({ rows: [ROW], skipped: [] }), TMPDIR: sb.dir, XDG_CACHE_HOME: xdg },
    ["ET_DAILY_TMP", "ET_DAILY_LOCK"],
  );
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /et-daily FAIL: .*\/xdg\/et-daily is a symlink/);
  assert.equal(fs.statSync(elsewhere).mode & 0o777, 0o755, "symlink target not chmod'ed");
  assert.deepEqual(fs.readdirSync(elsewhere), [], "nothing written through the symlink");
  assert.equal(calls(sb, "grok-calls").length, 0);
  assert.equal(fs.readdirSync(sb.dir).filter((n) => n.startsWith("et-daily.")).length, 0, "no work dir left");
});
