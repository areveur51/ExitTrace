import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { healLogicalApply } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRM_SCRIPT = path.join(ROOT, "scripts/require-reenable-confirm.sh");
const CONFIRM = "RE_ENABLE_LIVE_SYNC";

const GATED_WORKFLOWS = [
  ".github/workflows/et-sub-reconnect.yml",
  ".github/workflows/et-keep-up-backfill.yml",
  ".github/workflows/et-subscription-prove.yml",
];

function withEnv(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });
}

function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(" "));
  };
  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, lines }))
    .finally(() => {
      console.log = orig;
    });
}

test("healLogicalApply is a no-op unless ET_LOGICAL_HEAL is exactly on", { timeout: 3000 }, async () => {
  const offValues = [undefined, "", "off", "ON", "On", "true", "1", "yes", " on", "on\n"];
  for (const value of offValues) {
    await withEnv(
      {
        ET_LOGICAL_HEAL: value,
        DATABASE_URL: "postgres://user:s3cret@127.0.0.1:1/exittrace",
      },
      async () => {
        const { result, lines } = await captureLog(() => healLogicalApply());
        assert.equal(result.ok, true, `value ${JSON.stringify(value)}`);
        assert.equal(result.reason, "heal_disabled");
        assert.equal(result.skipped, true);
        assert.equal(result.bounced, false);
        assert.equal(result.altered, false);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /logical_heal skipped: ET_LOGICAL_HEAL is not on/);
        assert.match(lines[0], /ENABLE not run/);
        assert.doesNotMatch(lines[0], /s3cret/);
        assert.doesNotMatch(lines[0], /postgres:\/\//);
        assert.doesNotMatch(JSON.stringify(result), /s3cret/);
      },
    );
  }
});

test("healLogicalApply reaches the pool only when ET_LOGICAL_HEAL=on", { timeout: 3000 }, async () => {
  await withEnv({ ET_LOGICAL_HEAL: "on", DATABASE_URL: "" }, async () => {
    const { result, lines } = await captureLog(() => healLogicalApply());
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_pool");
    assert.equal(result.skipped, undefined);
    assert.equal(lines.length, 0);
  });
});

test("ENABLE in healLogicalApply stays behind the env gate", () => {
  const store = fs.readFileSync(path.join(ROOT, "app/lib/store.mjs"), "utf8");
  const fn = store.slice(store.indexOf("export async function healLogicalApply"));
  const next = fn.indexOf("\nexport async function ", 1);
  const body = next === -1 ? fn : fn.slice(0, next);
  const gate = body.indexOf('process.env.ET_LOGICAL_HEAL !== "on"');
  const enable = body.indexOf("ALTER SUBSCRIPTION exittrace_lab_sub ENABLE");
  assert.ok(gate > -1);
  assert.ok(enable > gate);
  assert.match(body, /heal_disabled/);
  assert.match(body, /logical_heal skipped/);
});

test("confirm script refuses missing and wrong confirm without echoing it", () => {
  const cases = [undefined, "", "on", "re_enable_live_sync", "RE_ENABLE_LIVE_SYNC ", " RE_ENABLE_LIVE_SYNC", "enable"];
  for (const confirm of cases) {
    const env = { ...process.env };
    if (confirm === undefined) delete env.CONFIRM;
    else env.CONFIRM = confirm;
    const run = spawnSync("bash", [CONFIRM_SCRIPT], { env, encoding: "utf8" });
    assert.notEqual(run.status, 0, `confirm ${JSON.stringify(confirm)}`);
    const output = `${run.stdout || ""}${run.stderr || ""}`;
    assert.match(output, /REFUSED/);
    assert.match(output, new RegExp(CONFIRM));
    assert.doesNotMatch(output, /CONFIRM_OK/);
  }
  const secret = spawnSync("bash", [CONFIRM_SCRIPT], {
    env: { ...process.env, CONFIRM: "super-secret-value" },
    encoding: "utf8",
  });
  assert.notEqual(secret.status, 0);
  assert.doesNotMatch(`${secret.stdout || ""}${secret.stderr || ""}`, /super-secret-value/);
});

test("confirm script accepts only the exact RE_ENABLE_LIVE_SYNC token", () => {
  const run = spawnSync("bash", [CONFIRM_SCRIPT], {
    env: { ...process.env, CONFIRM },
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /CONFIRM_OK live sync re-enable/);
  assert.doesNotMatch(`${run.stdout || ""}${run.stderr || ""}`, /REFUSED/);
});

test("re-enable workflows fail closed before ENABLE, DROP, or CREATE", () => {
  for (const rel of GATED_WORKFLOWS) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(text, /workflow_dispatch:/);
    assert.doesNotMatch(text, /^\s*schedule:/m);
    assert.match(text, /confirm:/);
    assert.match(text, new RegExp(CONFIRM));
    assert.match(text, /require-reenable-confirm\.sh/);
    assert.match(text, /CONFIRM: \$\{\{ inputs\.confirm \}\}/);
    assert.doesNotMatch(text, /continue-on-error/);
    const guardAt = text.indexOf("require-reenable-confirm.sh");
    const mutation = text.search(
      /ALTER SUBSCRIPTION[^\n]*\bENABLE\b|CREATE SUBSCRIPTION|DROP SUBSCRIPTION/,
    );
    assert.ok(mutation > guardAt, `${rel} mutates before the confirm guard`);
  }
});

test("et-logical-heal has no cron schedule", () => {
  const text = fs.readFileSync(path.join(ROOT, ".github/workflows/et-logical-heal.yml"), "utf8");
  assert.match(text, /workflow_dispatch:/);
  assert.doesNotMatch(text, /^\s*schedule:/m);
  assert.doesNotMatch(text, /\*\/15/);
  assert.doesNotMatch(text, /cron:/);
});

test("ET_LOGICAL_HEAL=on is not committed as a default", () => {
  const skip = new Set(["node_modules", ".git", "media", "data"]);
  const textExt = new Set([".yml", ".yaml", ".md", ".mjs", ".js", ".json", ".sql", ".sh", ".example", ".env", ".toml"]);
  const hits = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const rel = path.relative(ROOT, full);
      if (rel === "tests/live-sync-gate.test.mjs") continue;
      const ext = path.extname(ent.name);
      if (!textExt.has(ext) && ent.name !== ".env.example") continue;
      const body = fs.readFileSync(full, "utf8");
      if (/ET_LOGICAL_HEAL\s*[:=]\s*['"]?on['"]?/.test(body)) hits.push(rel);
    }
  }
  walk(ROOT);
  assert.deepEqual(hits, []);
});
