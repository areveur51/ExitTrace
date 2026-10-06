/**
 * Deliberate null origin on NEW person insert.
 * origin_unknown=true + origin_unknown_reason is the only way to insert without
 * country_of_origin. A forgotten origin stays fail-closed (missing_origin_country).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseOriginUnknown } from "../app/lib/event-attrs.mjs";
import { AddError, processAddRequest, queueAddRequest } from "../app/lib/add-request.mjs";
import { personMissingField } from "../app/lib/dashboard.mjs";
import { personHeader } from "../app/lib/html.mjs";
import { assertNewPersonInsertLock, PromoteError } from "../app/lib/promote.mjs";
import {
  applyIdentifiedPerson,
  getAddRequest,
  getMemory,
  getPerson,
  listPeople,
  loadSeedFile,
  setMemory,
  writeFileStore,
} from "../app/lib/store.mjs";
import { LOCK_CLI_FLAGS, LOCK_MEDIA_DIR, NEW_PERSON_LOCK, withNewPersonLock } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = path.join(ROOT, "data", "seed.json");
const SCRIPT = path.join(ROOT, "scripts", "process-add-request.mjs");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];
const BASE = { subject: "Casey Vale", event_date: "2024-06-15", category: "arrests", cite_urls: CITES };
const REASON = "No cited official or news source states country of origin";

function goldSeed() {
  return loadSeedFile(SEED);
}

function noOrigin(extra = {}) {
  const input = withNewPersonLock({ ...BASE, ...extra });
  delete input.country_of_origin;
  return input;
}

const isCode = (code) => (err) =>
  (err instanceof PromoteError || err instanceof AddError) && err.code === code;

test("parseOriginUnknown accepts only an explicit true marker", () => {
  assert.deepEqual(parseOriginUnknown({}), { origin_unknown: false, origin_unknown_reason: "" });
  for (const v of [undefined, null, "", false, "false", "yes", 1, "1", "on"]) {
    assert.equal(parseOriginUnknown({ origin_unknown: v, origin_unknown_reason: REASON }).origin_unknown, false, String(v));
  }
  assert.deepEqual(parseOriginUnknown({ origin_unknown: true, origin_unknown_reason: `  ${REASON} ` }), {
    origin_unknown: true,
    origin_unknown_reason: REASON,
  });
  assert.equal(parseOriginUnknown({ origin_unknown: " TRUE " }).origin_unknown, true);
});

test("forgotten origin is still rejected on new insert", async () => {
  for (const origin of [undefined, null, "", "   "]) {
    setMemory(goldSeed());
    const input = noOrigin();
    if (origin !== undefined) input.country_of_origin = origin;
    await assert.rejects(() => applyIdentifiedPerson(input), isCode("missing_origin_country"), String(origin));
  }
  // Non-explicit markers do not unlock the insert.
  for (const v of ["yes", 1, "1", false]) {
    setMemory(goldSeed());
    await assert.rejects(
      () => applyIdentifiedPerson(noOrigin({ origin_unknown: v, origin_unknown_reason: REASON })),
      isCode("missing_origin_country"),
      String(v),
    );
  }
  // A reason alone is not a marker.
  await assert.rejects(
    () => applyIdentifiedPerson(noOrigin({ origin_unknown_reason: REASON })),
    isCode("missing_origin_country"),
  );
  assert.equal(await getPerson("casey-vale"), null);
});

test("origin_unknown needs a reason and cannot coexist with an origin", async () => {
  setMemory(goldSeed());
  for (const reason of [undefined, "", "   "]) {
    await assert.rejects(
      () => applyIdentifiedPerson(noOrigin({ origin_unknown: true, origin_unknown_reason: reason })),
      isCode("missing_origin_unknown_reason"),
    );
  }
  await assert.rejects(
    () => applyIdentifiedPerson(withNewPersonLock({ ...BASE, origin_unknown: true, origin_unknown_reason: REASON })),
    isCode("origin_conflict"),
  );
  assert.throws(
    () => assertNewPersonInsertLock({ ...NEW_PERSON_LOCK, origin_unknown: true, origin_unknown_reason: REASON }),
    isCode("origin_conflict"),
  );
  assert.equal(await getPerson("casey-vale"), null);
});

test("explicit origin_unknown inserts with empty origin, hidden on card, counted as gap", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedPerson(
    noOrigin({ birth_date: null, origin_unknown: true, origin_unknown_reason: REASON }),
  );
  assert.equal(created.action, "created");
  const vale = await getPerson("casey-vale");
  assert.equal(vale.country_of_origin, "");
  assert.notEqual(vale.country_of_origin, "United States");
  assert.equal(vale.birth_date, null);

  // Display: no "Origin ·" line, no placeholder country.
  const header = personHeader(vale);
  assert.doesNotMatch(header, /Origin ·/);
  assert.doesNotMatch(header, /United States/);

  // Fail-closed gap and filters: unknown origin is still a missing-origin gap;
  // null birth_date is excluded by age filters, but the card still lists.
  assert.equal(personMissingField(vale, "origin"), true);
  assert.equal(personMissingField(vale, "birth_date"), true);
  const aged = await listPeople({ category: "arrests", minAge: 1 });
  assert.ok(!aged.some((r) => r.id === "casey-vale"));
  const listed = await listPeople({ category: "arrests" });
  assert.ok(listed.some((r) => r.id === "casey-vale"));

  // Annotating an existing card never needs the marker.
  const again = await applyIdentifiedPerson({ ...BASE, event_date: "2024-06-16" });
  assert.equal(again.action, "annotated");
  assert.equal((await getPerson("casey-vale")).country_of_origin, "");
});

test("queued marker round-trips through add_requests and processes", async () => {
  setMemory(goldSeed());
  const queued = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    origin_unknown: true,
    origin_unknown_reason: REASON,
  });
  const stored = await getAddRequest(queued.request.id);
  assert.equal(stored.origin_unknown, true);
  assert.equal(stored.origin_unknown_reason, REASON);
  const lock = { ...NEW_PERSON_LOCK };
  delete lock.country_of_origin;
  const created = await processAddRequest({ id: queued.request.id, overlay: { ...lock, cite_urls: CITES } });
  assert.equal(created.action, "created");
  assert.equal(created.person.country_of_origin, "");
  assert.equal((await getAddRequest(queued.request.id)).status, "applied");
});

test("queued without origin or marker is rejected and stays on record", async () => {
  setMemory(goldSeed());
  const queued = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
  });
  const lock = { ...NEW_PERSON_LOCK };
  delete lock.country_of_origin;
  await assert.rejects(
    () => processAddRequest({ id: queued.request.id, overlay: { ...lock, cite_urls: CITES } }),
    isCode("missing_origin_country"),
  );
  const row = await getAddRequest(queued.request.id);
  assert.equal(row.status, "rejected");
  assert.equal(await getPerson("casey-vale"), null);
});

function runProcess(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("close", (code) =>
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }),
    );
  });
}

test("add-process CLI --origin-unknown applies a deliberate null origin", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "et-origin-"));
  fs.copyFileSync(SEED, path.join(tmp, "seed.json"));
  setMemory(goldSeed());
  const queued = await queueAddRequest({ kind: "person", subject: "Casey Vale", category: "arrests", event_date: "2024-06-15" });
  writeFileStore(tmp, getMemory());
  const flags = [];
  for (let i = 0; i < LOCK_CLI_FLAGS.length; i += 2) {
    if (LOCK_CLI_FLAGS[i] === "--country-of-origin") continue;
    flags.push(LOCK_CLI_FLAGS[i], LOCK_CLI_FLAGS[i + 1]);
  }
  const base = ["--id", queued.request.id, "--cite-url", CITES[0], "--cite-url", CITES[1], ...flags];

  const forgot = await runProcess(base, { DATA_DIR: tmp, MEDIA_DIR: LOCK_MEDIA_DIR });
  assert.equal(forgot.code, 1, forgot.stderr);
  assert.match(forgot.stderr, /country of origin is required/);

  const again = await queueAddRequest({ kind: "person", subject: "Casey Vale", category: "arrests", event_date: "2024-06-15" });
  writeFileStore(tmp, getMemory());
  const ok = await runProcess(
    ["--id", again.request.id, ...base.slice(2), "--origin-unknown", REASON],
    { DATA_DIR: tmp, MEDIA_DIR: LOCK_MEDIA_DIR },
  );
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /add-process created person=casey-vale/);
  const store = JSON.parse(fs.readFileSync(path.join(tmp, "store.json"), "utf8"));
  const vale = store.people.find((r) => r.id === "casey-vale");
  assert.ok(vale);
  assert.equal(String(vale.country_of_origin || ""), "");
});
