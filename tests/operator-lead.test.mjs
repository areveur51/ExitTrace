import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { AddError, processAddRequest, queueAddRequest } from "../app/lib/add-request.mjs";
import { isOfficialCiteUrl } from "../app/lib/official.mjs";
import { personDetail } from "../app/lib/html.mjs";
import { getPerson, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "process-add-request.mjs");
const PROMOTE = path.join(ROOT, "scripts", "promote-source-post.mjs");
const SEED = path.join(ROOT, "data", "seed.json");
const X_LEAD = "https://x.com/examplelead/status/2120000000000000001";
const NEWS = "https://www.example.com/news/casey-vale-held";
const DEV_MARKER = "data-standing=\"developing\"";

function runNode(file, args) {
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn(process.execPath, [file, ...args], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: "" },
    });
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    child.on("close", (code) => resolve({ code, out: Buffer.concat(chunks).toString("utf8") }));
  });
}

async function queued() {
  return queueAddRequest({ kind: "person", subject: "Casey Vale", category: "arrests", event_date: "2024-06-15" });
}

test("CLI accepts --operator-lead (parse reaches the next unknown flag)", async () => {
  const r = await runNode(SCRIPT, ["--operator-lead", "--no-such-flag-xyz"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /unknown argument: --no-such-flag-xyz/);
  assert.doesNotMatch(r.out, /unknown argument: --operator-lead/);
});

test("CLI accepts --reprocess-id and rejects it with --queue", async () => {
  const r = await runNode(SCRIPT, ["--reprocess-id", "ar-0000", "--queue"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--queue cannot be combined with --id, --next, or --reprocess-id/);
});

test("promote-source-post.mjs cannot set operator-lead", async () => {
  const src = fs.readFileSync(PROMOTE, "utf8");
  assert.equal(src.includes("operator_lead"), false);
  const r = await runNode(PROMOTE, ["--operator-lead"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /unknown argument: --operator-lead/);
});

test("operator-lead, 1 official + 1 X lead (Habba shape): developing card, official cite stored, marker on page", async () => {
  setMemory(loadSeedFile(SEED));
  assert.equal(isOfficialCiteUrl(X_LEAD), false);
  assert.equal(isOfficialCiteUrl(NEWS), true);
  const q = await queued();
  const created = await processAddRequest({ id: q.request.id, overlay: { ...NEW_PERSON_LOCK, cite_urls: [X_LEAD, NEWS], operator_lead: true } });
  assert.equal(created.action, "created");
  assert.equal(created.standing, "developing");
  const p = await getPerson(created.person.id);
  assert.equal(p.events.find((ev) => ev.kind === "arrests").standing, "developing");
  assert.deepEqual(p.sources.map((s) => s.url), [NEWS]);
  assert.ok(personDetail(p).includes(DEV_MARKER));
});

test("operator-lead, 0 official + 1 X lead only (Vivek shape): developing card with the X lead as its source", async () => {
  setMemory(loadSeedFile(SEED));
  const q = await queued();
  const created = await processAddRequest({ id: q.request.id, overlay: { ...NEW_PERSON_LOCK, cite_urls: [X_LEAD], operator_lead: true } });
  assert.equal(created.action, "created");
  assert.equal(created.standing, "developing");
  const p = await getPerson(created.person.id);
  assert.equal(p.events.find((ev) => ev.kind === "arrests").standing, "developing");
  assert.deepEqual(p.sources.map((s) => s.url), [X_LEAD]);
  assert.ok(personDetail(p).includes(DEV_MARKER));
});

test("operator-lead with 0 cites still fails cites_floor", async () => {
  setMemory(loadSeedFile(SEED));
  const q = await queued();
  await assert.rejects(
    () => processAddRequest({ id: q.request.id, overlay: { ...NEW_PERSON_LOCK, cite_urls: [], operator_lead: true } }),
    (err) => err instanceof AddError && err.code === "cites_floor",
  );
});

test("without operator-lead, 1 official + 1 X lead still fails cites_floor", async () => {
  setMemory(loadSeedFile(SEED));
  const q = await queued();
  await assert.rejects(
    () => processAddRequest({ id: q.request.id, overlay: { ...NEW_PERSON_LOCK, cite_urls: [X_LEAD, NEWS] } }),
    (err) => err instanceof AddError && err.code === "cites_floor",
  );
});

test("operator-lead with 2 official cites is full standing, no marker", async () => {
  setMemory(loadSeedFile(SEED));
  const q = await queued();
  const created = await processAddRequest({ id: q.request.id, overlay: { ...NEW_PERSON_LOCK, cite_urls: [NEWS, "https://www.example.net/world/casey-vale-arrest"], operator_lead: true } });
  assert.equal(created.standing, "full");
  const p = await getPerson(created.person.id);
  assert.equal(Object.hasOwn(p.events.find((ev) => ev.kind === "arrests"), "standing"), false);
  assert.equal(personDetail(p).includes(DEV_MARKER), false);
});
