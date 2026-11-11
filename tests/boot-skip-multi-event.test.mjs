/**
 * Boot re-save skip for PromoteError code multi_event_writes_off (Worf).
 * ET_MULTI_EVENT_WRITES stays off. These tests must not turn the switch on.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bootDatabase, SUBSCRIBER_COUNT_SQL } from "../app/lib/boot-guard.mjs";
import { PromoteError, attachPersonEvent, eventSeq, eventsOfKind, projectPerson } from "../app/lib/promote.mjs";
import {
  bootMultiEventSkipLine,
  getMemory,
  getPerson,
  importSeed,
  migrateUniquePeople,
  runBootPersonWrite,
  setMemory,
  setPoolForTests,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE_SRC = fs.readFileSync(path.join(ROOT, "app", "lib", "store.mjs"), "utf8");

const AP = (slug, date) => ({
  url: `https://apnews.com/article/${slug}`,
  publisher: "AP",
  title: slug,
  date,
});

function singleNotable(id, name, date, comments) {
  return projectPerson({
    id,
    name,
    category: "notable",
    event_date: date,
    events: [{
      kind: "notable",
      seq: 0,
      event_date: date,
      comments,
      sources: [AP(`${id}-0`, date)],
    }],
  });
}

function twoNotables(id, name) {
  const one = singleNotable(id, name, "2026-03-04", "First notable event.");
  return attachPersonEvent(one, {
    kind: "notable",
    event_date: "2026-10-05",
    comments: "Second notable event.",
    sources: [AP(`${id}-1`, "2026-10-05")],
  }).person;
}

function withSwitchOff(fn) {
  const saved = process.env.ET_MULTI_EVENT_WRITES;
  delete process.env.ET_MULTI_EVENT_WRITES;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (saved === undefined) delete process.env.ET_MULTI_EVENT_WRITES;
      else process.env.ET_MULTI_EVENT_WRITES = saved;
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
    .finally(() => {
      console.log = orig;
    })
    .then((result) => ({ result, lines }));
}

function publisherPool() {
  return {
    async query(sql) {
      if (sql === SUBSCRIBER_COUNT_SQL) return { rows: [{ n: 0 }] };
      throw new Error("unexpected query");
    },
  };
}

function bootDeps({ importSeedFn, migrateFn, logLines }) {
  return {
    bootstrapSql: "",
    seed: { people: [], dog_comms: [] },
    ensureSchema: async () => {},
    healLogicalApply: async () => ({ ok: true, reason: "heal_disabled", skipped: true }),
    importSeed: importSeedFn,
    migrateUniquePeople: migrateFn,
    log: (...args) => logLines.push(args.map(String).join(" ")),
    logError: (...args) => logLines.push(args.map(String).join(" ")),
  };
}

test("runBootPersonWrite skips only multi_event_writes_off and does not call writeFn", async () => {
  await withSwitchOff(async () => {
    const person = twoNotables("boot-skip-keith", "Boot Skip Keith");
    const tally = { count: 0 };
    const logs = [];
    let called = 0;
    const out = await runBootPersonWrite(
      person,
      async () => {
        called += 1;
        throw new Error("writeFn must not run on a skip");
      },
      { tally, log: (line) => logs.push(line) },
    );
    assert.equal(out.skipped, true);
    assert.equal(out.skips, 1);
    assert.equal(called, 0);
    assert.deepEqual(logs, [bootMultiEventSkipLine("boot-skip-keith", 1)]);
    assert.equal(tally.count, 1);
    assert.doesNotMatch(logs.join("\n"), /Second notable event|ET_MULTI_EVENT_WRITES|payload/);
  });
});

test("runBootPersonWrite still throws a different PromoteError and does not skip", async () => {
  await withSwitchOff(async () => {
    const person = singleNotable("boot-skip-safe", "Boot Skip Safe", "2026-03-04", "Only one notable.");
    const tally = { count: 0 };
    const logs = [];
    await assert.rejects(
      () =>
        runBootPersonWrite(
          person,
          async () => {
            throw new PromoteError("person not found: boot-skip-safe", "person_not_found");
          },
          { tally, log: (line) => logs.push(line) },
        ),
      { code: "person_not_found" },
    );
    assert.equal(tally.count, 0);
    assert.deepEqual(logs, []);
  });
});

test("publisher boot completes when a seq>0 person is skipped; the row is unchanged; the log line is present", async () => {
  await withSwitchOff(async () => {
    setPoolForTests(null);
    const safe = singleNotable("boot-skip-safe", "Boot Skip Safe", "2026-03-04", "Only one notable.");
    const multi = twoNotables("boot-skip-keith", "Boot Skip Keith");
    setMemory({ people: [safe, multi] });
    const before = structuredClone(await getPerson("boot-skip-keith"));
    assert.ok(eventsOfKind(before.events, "notable").some((ev) => eventSeq(ev) > 0));
    const bootLines = [];
    const captured = await captureLog(async () =>
      bootDatabase(publisherPool(), bootDeps({
        importSeedFn: async () => ({ people: 0, dog_comms: 0, operations: 0 }),
        migrateFn: migrateUniquePeople,
        logLines: bootLines,
      })),
    );
    assert.equal(captured.result.subscriber, false);
    const after = await getPerson("boot-skip-keith");
    assert.deepEqual(after, before);
    const skipLine = bootMultiEventSkipLine("boot-skip-keith", 1);
    assert.ok(captured.lines.includes(skipLine), captured.lines.join("\n"));
    for (const line of captured.lines) {
      assert.doesNotMatch(line, /Second notable event|ET_MULTI_EVENT_WRITES=/);
    }
    const stillSafe = await getPerson("boot-skip-safe");
    assert.equal(stillSafe.id, "boot-skip-safe");
    setPoolForTests(null);
  });
});

test("publisher boot still fails on a different error (event_seq_out_of_range)", async () => {
  await withSwitchOff(async () => {
    setPoolForTests(null);
    const safe = singleNotable("boot-skip-safe", "Boot Skip Safe", "2026-03-04", "Only one notable.");
    const multi = twoNotables("boot-skip-keith", "Boot Skip Keith");
    setMemory({ people: [safe, multi] });
    const stored = getMemory().people.find((p) => p.id === "boot-skip-keith");
    for (const ev of stored.events) {
      if (ev.kind === "notable" && eventSeq(ev) > 0) ev.seq = 2147483648;
    }
    const before = structuredClone(await getPerson("boot-skip-keith"));
    const bootLines = [];
    await assert.rejects(
      () =>
        captureLog(() =>
          bootDatabase(
            publisherPool(),
            bootDeps({
              importSeedFn: async () => ({ people: 0, dog_comms: 0, operations: 0 }),
              migrateFn: migrateUniquePeople,
              logLines: bootLines,
            }),
          ),
        ),
      { code: "event_seq_out_of_range" },
    );
    const after = await getPerson("boot-skip-keith");
    assert.deepEqual(after, before);
    setPoolForTests(null);
  });
});

test("importSeed skips a seq>0 person before any write and leaves that id unwritten", async () => {
  await withSwitchOff(async () => {
    const safe = singleNotable("boot-skip-safe", "Boot Skip Safe", "2026-03-04", "Only one notable.");
    const multi = twoNotables("boot-skip-keith", "Boot Skip Keith");
    const writes = [];
    const existing = new Map([[multi.id, multi]]);
    const client = {
      async query(text, params = []) {
        const sql = String(text);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (/SELECT \* FROM people WHERE id = \$1/.test(sql)) {
          const row = existing.get(params[0]);
          return { rows: row ? [row] : [] };
        }
        if (/INSERT INTO people/.test(sql)) {
          writes.push({ table: "people", id: params[0] });
          return { rows: [] };
        }
        if (/DELETE FROM person_events/.test(sql)) {
          writes.push({ table: "person_events_delete", id: params[0] });
          return { rows: [] };
        }
        if (/INSERT INTO person_events/.test(sql)) {
          writes.push({ table: "person_events", id: params[0] });
          return { rows: [] };
        }
        if (/INSERT INTO et_meta/.test(sql)) {
          writes.push({ table: "et_meta" });
          return { rows: [] };
        }
        throw new Error("unexpected sql: " + sql.slice(0, 80));
      },
      release() {},
    };
    const pool = { connect: async () => client };
    const captured = await captureLog(async () =>
      importSeed(pool, { people: [safe, multi], dog_comms: [], operations: [] }),
    );
    const keithWrites = writes.filter((w) => w.id === "boot-skip-keith");
    assert.deepEqual(keithWrites, []);
    assert.ok(writes.some((w) => w.table === "people" && w.id === "boot-skip-safe"));
    assert.ok(captured.lines.includes(bootMultiEventSkipLine("boot-skip-keith", 1)));
  });
});

test("the shared guard is used in importSeed and migrateUniquePeople only", () => {
  assert.match(STORE_SRC, /export async function runBootPersonWrite\(/);
  const importFn = STORE_SRC.slice(
    STORE_SRC.indexOf("export async function importSeed"),
    STORE_SRC.indexOf("export async function getEtMeta"),
  );
  const migrateFn = STORE_SRC.slice(
    STORE_SRC.indexOf("export async function migrateUniquePeople"),
    STORE_SRC.indexOf("export async function closeStore"),
  );
  assert.match(importFn, /runBootPersonWrite\(/);
  assert.match(migrateFn, /runBootPersonWrite\(/);
  const mentions = STORE_SRC.match(/runBootPersonWrite\(/g) || [];
  assert.equal(mentions.length, 4, "declaration plus one importSeed call and two migrateUniquePeople calls");
  assert.doesNotMatch(importFn, /multi_event_writes_off/);
  assert.doesNotMatch(migrateFn, /multi_event_writes_off/);
  assert.match(STORE_SRC, /err instanceof PromoteError && err.code === BOOT_MULTI_EVENT_SKIP_CODE/);
});

