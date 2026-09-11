import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wfPath = path.join(ROOT, ".github", "workflows", "lab-to-render-sync.yml");
const docPath = path.join(ROOT, "docs", "github-auto-deploy.md");
const dataReleasePath = path.join(ROOT, ".github", "workflows", "data-release.yml");

test("lab-to-render-sync workflow matches the locked contract", () => {
  const wf = fs.readFileSync(wfPath, "utf8");
  assert.match(wf, /^name:\s*lab-to-render-sync\s*$/m);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /cron:\s*"0 \*\/2 \* \* \*"/);
  assert.match(wf, /America\/New_York/);
  assert.match(wf, /runs-on:\s*\[self-hosted,\s*pop-os,\s*exittrace-lab\]/);
  assert.match(wf, /\/opt\/GrokBuild\/bin\/et-lab-dump\.sh/);
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
  assert.doesNotMatch(wf, /127\.0\.0\.1:5434/);
  assert.doesNotMatch(wf, /localhost:5434/);
});

test("docs name production DATABASE_URL, runner labels, dump script, and exclude host port 5434", () => {
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /lab-to-render-sync\.yml/);
  assert.match(doc, /cron `0 \*\/2 \* \* \*`/);
  assert.match(doc, /America\/New_York/);
  assert.match(doc, /`production`/);
  assert.match(doc, /\*\*`DATABASE_URL`\*\*/);
  assert.match(doc, /pop-os-exittrace/);
  assert.match(doc, /exittrace-lab/);
  assert.match(doc, /\/opt\/GrokBuild\/bin\/et-lab-dump\.sh/);
  assert.match(doc, /5434/);
  assert.match(doc, /replica/);
  assert.doesNotMatch(doc, /RENDER_DATABASE_URL/);
});

test("data-release.yml is unchanged by this sync path", () => {
  const pack = fs.readFileSync(dataReleasePath, "utf8");
  assert.match(pack, /^name:\s*data-release\s*$/m);
  assert.doesNotMatch(pack, /lab-to-render-sync/);
  assert.doesNotMatch(pack, /et-lab-dump/);
});
