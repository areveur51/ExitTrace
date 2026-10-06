/**
 * Never guess a role: boot membership no longer defaults position/organization
 * to "Public figure" / "Public record". A missing value stays blank; a NEW person
 * insert stays fail-closed on the lock; an existing card is annotated with blanks
 * and the detail page renders no placeholder line.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AddError, processAddRequest } from "../app/lib/add-request.mjs";
import { eventTagRow } from "../app/lib/html.mjs";
import { PromoteError } from "../app/lib/promote.mjs";
import {
  applyIdentifiedPerson,
  createAddRequest,
  getPerson,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK, withNewPersonLock } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = path.join(ROOT, "data", "seed.json");
const CITES = [
  "https://www.example.com/news/casey-vale-boot",
  "https://www.example.net/world/casey-vale-walking-boot",
];
const PLACEHOLDERS = /Public figure|Public record/;

const isCode = (code) => (err) =>
  (err instanceof PromoteError || err instanceof AddError) && err.code === code;

function lockWithout(...keys) {
  const lock = { ...NEW_PERSON_LOCK };
  for (const k of keys) delete lock[k];
  return lock;
}

async function legacyBoot(id, overlay) {
  const req = await createAddRequest({
    id,
    kind: "boot",
    subject: "Casey Vale",
    event_date: "2024-06-15",
    source_url: CITES[0],
    cite_urls: CITES,
  });
  return processAddRequest({ id: req.id, overlay: { ...overlay, cite_urls: CITES, source_url: CITES[0] } });
}

test("new boot person without position is rejected, not defaulted to a placeholder", async () => {
  setMemory(loadSeedFile(SEED));
  await assert.rejects(
    () => legacyBoot("ar-bootnopos00001", lockWithout("position")),
    isCode("missing_position"),
  );
  assert.equal(await getPerson("casey-vale"), null);
});

test("new boot person without organization is rejected, not defaulted to a placeholder", async () => {
  setMemory(loadSeedFile(SEED));
  await assert.rejects(
    () => legacyBoot("ar-bootnoorg00001", lockWithout("organization")),
    isCode("missing_organization"),
  );
  assert.equal(await getPerson("casey-vale"), null);
});

test("boot annotate on an existing card keeps position/organization blank and renders cleanly", async () => {
  setMemory(loadSeedFile(SEED));
  const created = await applyIdentifiedPerson(
    withNewPersonLock({
      subject: "Casey Vale",
      event_date: "2024-06-01",
      category: "arrests",
      cite_urls: CITES,
    }),
  );
  assert.equal(created.action, "created");
  const result = await legacyBoot("ar-bootannot00001", lockWithout("position", "organization"));
  assert.equal(result.action, "annotated");
  const vale = await getPerson("casey-vale");
  const boot = (vale.events || []).find((ev) => ev.kind === "boot_comms");
  assert.ok(boot, "boot_comms event attached");
  assert.equal(String(boot.position || ""), "");
  assert.equal(String(boot.organization || ""), "");
  assert.doesNotMatch(JSON.stringify(vale), PLACEHOLDERS);
  const html = eventTagRow(boot);
  assert.match(html, /data-kind="boot_comms"/);
  assert.doesNotMatch(html, PLACEHOLDERS);
  assert.doesNotMatch(html, /Position ·|Organization ·/);
  assert.doesNotMatch(html, /undefined|null/);
});

test("boot code paths carry no Public figure / Public record placeholder", () => {
  for (const rel of [
    "app/lib/add-request.mjs",
    "scripts/seed-boot-remaining-highs.mjs",
    "scripts/migrate-boot-to-people.mjs",
  ]) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const code = text
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");
    assert.doesNotMatch(code, PLACEHOLDERS, rel);
    assert.doesNotMatch(code, /organization:\s*"Entertainment"/, rel);
  }
});
