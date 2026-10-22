/** Static checks for the multi-notable seq migrations and JSON preservation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { personEvents } from "../app/lib/promote.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "scripts", "migrations");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(text) {
  return String(text || "")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function assertNoDestructiveDml(sql, label, { allowUpdate = false } = {}) {
  const body = executableSql(sql);
  assert.doesNotMatch(body, /\bDELETE\b/i, `${label} has DELETE`);
  assert.doesNotMatch(body, /\bTRUNCATE\b/i, `${label} has TRUNCATE`);
  assert.doesNotMatch(body, /\bDROP\s+TABLE\b/i, `${label} has DROP TABLE`);
  assert.doesNotMatch(body, /\bDROP\s+COLUMN\b/i, `${label} has DROP COLUMN`);
  if (!allowUpdate) {
    assert.doesNotMatch(body, /\bUPDATE\b/i, `${label} has UPDATE`);
  }
}

test("phase A only adds seq DEFAULT 0 and a unique index", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-phase-a.sql");
  assertNoDestructiveDml(sql, "phase A");
  assert.match(
    sql,
    /ALTER TABLE person_events ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0;/,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key\s+ON person_events \(person_id, kind, seq\)/s,
  );
  assert.match(sql, /\bBEGIN\b/);
  assert.match(sql, /\bCOMMIT\b/);
  assert.doesNotMatch(executableSql(sql), /\bDROP\s+CONSTRAINT\b/i);
});

test("phase B swaps PK in one transaction with USING INDEX and REPLICA IDENTITY DEFAULT", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-phase-b.sql");
  assertNoDestructiveDml(sql, "phase B");
  const body = executableSql(sql);
  assert.equal((body.match(/^\s*BEGIN\s*;/gm) || []).length, 1);
  assert.equal((body.match(/^\s*COMMIT\s*;/gm) || []).length, 1);
  assert.match(sql, /PRIMARY KEY USING INDEX person_events_person_kind_seq_key/);
  assert.match(sql, /REPLICA IDENTITY DEFAULT/);
  assert.match(sql, /person_events_seq_notable_only/);
  const beginAt = body.search(/^\s*BEGIN\s*;/m);
  const usingAt = body.indexOf("PRIMARY KEY USING INDEX");
  const replicaAt = body.search(/REPLICA IDENTITY DEFAULT/i);
  const commitAt = body.search(/^\s*COMMIT\s*;/m);
  assert.ok(beginAt >= 0 && usingAt > beginAt && replicaAt > usingAt && commitAt > replicaAt);
});

test("rollback copies to retired tables before re-keying and does not drop data", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-rollback.sql");
  assertNoDestructiveDml(sql, "rollback", { allowUpdate: true });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS person_events_multi_notable_retired/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS people_events_multi_notable_retired/);
  assert.match(sql, /INSERT INTO person_events_multi_notable_retired/);
  assert.match(sql, /INSERT INTO people_events_multi_notable_retired/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(
    sql,
    /UPDATE person_events\s+SET kind = 'notable_retired_' \|\| seq\s+WHERE kind = 'notable' AND seq > 0/s,
  );
  const body = executableSql(sql);
  assert.equal((body.match(/^\s*BEGIN\s*;/gm) || []).length, 1);
  assert.equal((body.match(/^\s*COMMIT\s*;/gm) || []).length, 1);
  const beginAt = body.search(/^\s*BEGIN\s*;/m);
  const commitAt = body.search(/^\s*COMMIT\s*;/m);
  const copyAt = body.indexOf("INSERT INTO person_events_multi_notable_retired");
  const peopleCopyAt = body.indexOf("INSERT INTO people_events_multi_notable_retired");
  const checkDropAt = body.search(/DROP CONSTRAINT IF EXISTS person_events_seq_notable_only/i);
  const rekeyAt = body.indexOf("SET kind = 'notable_retired_'");
  const pkRestoreAt = body.search(
    /ADD CONSTRAINT person_events_pkey PRIMARY KEY \(person_id, kind\)/,
  );
  const uniqAt = body.search(/CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key/i);
  const replicaAt = body.search(/REPLICA IDENTITY DEFAULT/i);
  assert.ok(beginAt >= 0 && commitAt > beginAt);
  assert.ok(
    copyAt > beginAt &&
      peopleCopyAt > copyAt &&
      checkDropAt > peopleCopyAt &&
      rekeyAt > checkDropAt &&
      pkRestoreAt > rekeyAt &&
      uniqAt > pkRestoreAt &&
      replicaAt > uniqAt &&
      replicaAt < commitAt,
  );
  assert.match(sql, /lab first/i);
  assert.match(sql, /exittrace_lab_pub is a table list/);
  assert.match(sql, /Do not ALTER PUBLICATION/);
  assert.match(sql, /RENDER-ONLY STEP 1/i);
  assert.match(sql, /RENDER-ONLY STEP 2/i);
  assert.match(sql, /lab-local retired tables are the durable copy/i);
  assert.match(sql, /Do not edit affected people until restored/i);
});

test("bootstrap person_events seed insert is target-less ON CONFLICT and does not list seq", () => {
  const sql = read("scripts/bootstrap-db.sql");
  const seed = sql.match(
    /INSERT INTO person_events\s*\(([^)]+)\)[\s\S]*?ON CONFLICT[^\n;]*;/,
  );
  assert.ok(seed, "person_events seed INSERT");
  assert.doesNotMatch(seed[0], /ON CONFLICT \(person_id, kind/);
  assert.doesNotMatch(seed[1], /\bseq\b/);
  assert.match(seed[0], /ON CONFLICT DO NOTHING/);
});

test("bootstrap-db.sql has no person_events PK swap", () => {
  const sql = read("scripts/bootstrap-db.sql");
  assert.doesNotMatch(sql, /PRIMARY KEY USING INDEX person_events/);
  assert.doesNotMatch(sql, /DROP CONSTRAINT(?: IF EXISTS)? person_events_pkey/);
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS person_events \([\s\S]*?seq INTEGER NOT NULL DEFAULT 0,[\s\S]*?PRIMARY KEY \(person_id, kind, seq\),[\s\S]*?person_events_seq_notable_only CHECK \(kind = 'notable' OR seq = 0\)/s,
  );
});

test("seed-style person rows pass through personEvents without seq on non-notables", () => {
  const firing = {
    id: "casey-vale",
    name: "Casey Vale",
    category: "firings",
    event_date: "2017-05-09",
    events: [
      {
        kind: "firings",
        event_date: "2017-05-09",
        sources: [
          { url: "https://www.example.com/news/fired" },
          { url: "https://www.example.net/world/fired" },
        ],
        comments: "Removed from office.",
        position: "Director",
      },
    ],
  };
  const fired = personEvents(firing);
  assert.equal(fired.length, 1);
  assert.equal(Object.hasOwn(fired[0], "seq"), false);
  const again = personEvents({ ...firing, events: fired });
  assert.deepEqual(again, fired);

  const single = {
    id: "casey-vale",
    name: "Casey Vale",
    category: "notable",
    event_date: "2024-08-01",
    events: [
      {
        kind: "notable",
        event_date: "2024-08-01",
        comments: "Named in a published poll.",
        sources: [
          { url: "https://www.example.com/news/notable" },
          { url: "https://www.example.net/world/notable" },
        ],
      },
    ],
  };
  const notables = personEvents(single);
  assert.equal(notables.length, 1);
  assert.equal(notables[0].kind, "notable");
  assert.equal(notables[0].event_date, "2024-08-01");
  assert.equal(notables[0].comments, "Named in a published poll.");
  assert.equal(notables[0].seq, 0);
  const { seq, ...rest } = notables[0];
  assert.equal(seq, 0);
  assert.equal(Object.hasOwn(rest, "seq"), false);
  const mixed = personEvents({
    ...firing,
    events: [...firing.events, ...single.events],
  });
  const nonNotable = mixed.find((ev) => ev.kind === "firings");
  const notable = mixed.find((ev) => ev.kind === "notable");
  assert.equal(Object.hasOwn(nonNotable, "seq"), false);
  assert.equal(notable.seq, 0);
});

test("migration files exist under scripts/migrations", () => {
  for (const name of [
    "2026-10-22-multi-notable-phase-a.sql",
    "2026-10-22-multi-notable-phase-b.sql",
    "2026-10-22-multi-notable-rollback.sql",
  ]) {
    assert.equal(fs.existsSync(path.join(MIGRATIONS, name)), true, name);
  }
});
