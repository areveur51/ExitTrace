import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wfPath = path.join(ROOT, ".github", "workflows", "lab-to-render-sync.yml");
const docPath = path.join(ROOT, "docs", "github-auto-deploy.md");
const dataReleasePath = path.join(ROOT, ".github", "workflows", "data-release.yml");

// Encoded so this file does not contain the raw host strings.
const PRIVATE_HOST = [
  ["pop", "-os"].join(""),
  ["Grok", "Build"].join(""),
  ["/opt/", "Grok", "Build"].join(""),
  ["dpg", "-"].join(""),
  ["Tail", "scale"].join(""),
];

function assertNoPrivateHost(text, label) {
  for (const pat of PRIVATE_HOST) {
    assert.equal(text.includes(pat), false, `${label} must not contain ${pat}`);
  }
}

test("lab-to-render-sync workflow matches the locked contract", () => {
  const wf = fs.readFileSync(wfPath, "utf8");
  assert.match(wf, /^name:\s*lab-to-render-sync\s*$/m);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /cron:\s*"0 \*\/2 \* \* \*"/);
  assert.match(wf, /America\/New_York/);
  assert.match(wf, /fromJSON\(vars\.ET_LAB_RUNNER_LABELS/);
  assert.match(wf, /\["self-hosted","lab"\]/);
  assert.match(wf, /ET_LAB_DUMP_SH/);
  assert.match(wf, /ET_LAB_DUMP_OUT/);
  assert.match(wf, /\/path\/to\/et-lab-dump\.sh/);
  assert.match(wf, /\/path\/to\/exittrace-lab-latest\.dump/);
  assert.match(wf, /exittrace-lab\.dump\.gz/);
  assert.match(wf, /retention-days:\s*1/);
  assert.match(wf, /runs-on:\s*ubuntu-latest/);
  assert.match(wf, /environment:\s*production/);
  assert.match(wf, /secrets\.DATABASE_URL/);
  assert.match(wf, /pg_restore/);
  assert.match(wf, /--clean/);
  assert.match(wf, /--if-exists/);
  assert.match(wf, /sslmode=require/);
  assert.doesNotMatch(wf, /RENDER_DATABASE_URL/);
  assertNoPrivateHost(wf, "workflow");
});

test("docs name production DATABASE_URL, generic runner labels, and dump env placeholders", () => {
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /lab-to-render-sync\.yml/);
  assert.match(doc, /cron `0 \*\/2 \* \* \*`/);
  assert.match(doc, /America\/New_York/);
  assert.match(doc, /`production`/);
  assert.match(doc, /\*\*`DATABASE_URL`\*\*/);
  assert.match(doc, /self-hosted/);
  assert.match(doc, /`lab`/);
  assert.match(doc, /ET_LAB_RUNNER_LABELS/);
  assert.match(doc, /ET_LAB_DUMP_SH/);
  assert.match(doc, /ET_LAB_DUMP_OUT/);
  assert.match(doc, /\/path\/to\/et-lab-dump\.sh/);
  assert.match(doc, /dump\/restore/i);
  assert.match(doc, /logical replica is optional/i);
  assert.doesNotMatch(doc, /RENDER_DATABASE_URL/);
  assertNoPrivateHost(doc, "docs");
});

test("data-release.yml is unchanged by this sync path", () => {
  const pack = fs.readFileSync(dataReleasePath, "utf8");
  assert.match(pack, /^name:\s*data-release\s*$/m);
  assert.doesNotMatch(pack, /lab-to-render-sync/);
  assert.doesNotMatch(pack, /et-lab-dump/);
});
