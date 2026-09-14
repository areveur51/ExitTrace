import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wfPath = path.join(ROOT, ".github", "workflows", "et-subscription-prove.yml");
const syncPath = path.join(ROOT, ".github", "workflows", "lab-to-render-sync.yml");

test("et-subscription-prove is dispatch-only Phase 0 prove (no cutover)", () => {
  const wf = fs.readFileSync(wfPath, "utf8");
  assert.match(wf, /^name:\s*et-subscription-prove\s*$/m);
  assert.match(wf, /workflow_dispatch:/);
  assert.doesNotMatch(wf, /^\s+push:/m);
  assert.doesNotMatch(wf, /^\s+schedule:/m);
  assert.doesNotMatch(wf, /^\s+pull_request:/m);
  assert.match(wf, /runs-on:\s*ubuntu-latest/);
  assert.match(wf, /environment:\s*production/);
  assert.match(wf, /secrets\.DATABASE_URL/);
  assert.match(wf, /secrets\.EXITTRACE_LOGICAL_CONNINFO/);
  assert.doesNotMatch(wf, /ET_LAB_PUBLISHER_CONNINFO/);
  assert.doesNotMatch(wf, /5434/);
  assert.match(wf, /postgresql-client/);
  assert.match(wf, /CREATE SUBSCRIPTION exittrace_lab_sub/);
  assert.match(wf, /PUBLICATION exittrace_lab_pub/);
  assert.match(wf, /copy_data = false/);
  assert.match(wf, /create_slot = true/);
  assert.match(wf, /enabled = true/);
  assert.match(wf, /ALTER SUBSCRIPTION exittrace_lab_sub DISABLE/);
  assert.match(wf, /SET \(slot_name = NONE\)/);
  assert.match(wf, /DROP SUBSCRIPTION exittrace_lab_sub/);
  assert.match(wf, /pg_catalog\.pg_subscription/);
  assert.match(wf, /pg_catalog\.pg_stat_subscription/);
  assert.match(wf, /WHERE subname = 'exittrace_lab_sub'/);
  assert.match(wf, /no cutover/i);
  assert.match(wf, /Dump\/restore stays/);
  assert.match(wf, /Do not set SYNC_MODE=logical/);
  assert.doesNotMatch(wf, /vars\.SYNC_MODE/);
  assert.doesNotMatch(wf, /SYNC_MODE:\s*logical/);
  assert.doesNotMatch(wf, /sync_mode == 'logical'/);
  const selects = [...wf.matchAll(/SELECT\s+[^;]+/gi)].map((m) => m[0]);
  assert.ok(selects.length >= 3, "expected catalog verify SELECTs");
  for (const sql of selects) {
    assert.doesNotMatch(sql, /\bsubconninfo\b/i);
    assert.doesNotMatch(sql, /SELECT\s+\*/i);
  }
  assert.doesNotMatch(wf, /postgres(?:ql)?:\/\//);
  assert.doesNotMatch(wf, /password=[A-Za-z0-9]/);
  assert.doesNotMatch(wf, /RENDER_DATABASE_URL/);
});

test("lab-to-render-sync dump/restore path is unchanged by the prove workflow", () => {
  const sync = fs.readFileSync(syncPath, "utf8");
  assert.match(sync, /default:\s*dump/);
  assert.match(sync, /needs\.mode\.outputs\.sync_mode == 'dump'/);
  assert.match(sync, /optional logical replica is not configured on this public workflow/);
  assert.doesNotMatch(sync, /et-subscription-prove/);
  assert.doesNotMatch(sync, /exittrace_lab_sub/);
});
