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

function assertRollbackOrder(sql) {
  const markers = ["a. Render:", "b. Lab:", "c. Wait for LSN", "d. Render:", "e. Lab:"];
  let at = -1;
  for (const marker of markers) {
    const next = sql.indexOf(marker);
    assert.ok(next > at, marker);
    at = next;
  }
  assert.match(sql, /run on lab first, then Render/);
  assert.match(sql, /Do not ALTER PUBLICATION/);
}

test("phase A only adds seq DEFAULT 0 and a unique index", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-phase-a.sql");
  assertNoDestructiveDml(sql, "phase A");
  assert.match(sql, /run on Render first, then lab/);
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
  assert.match(sql, /Rollout: run on lab first, then Render/);
  assert.doesNotMatch(sql, /run on Render first/);
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

test("rollback index is comments only and states the fixed a-e order", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-rollback.sql");
  assert.equal(executableSql(sql).trim(), "");
  assertNoDestructiveDml(sql, "rollback index");
  assertRollbackOrder(sql);
  assert.match(sql, /exittrace_lab_pub is a table list/);
  assert.match(sql, /lab-local retired tables are the durable copy/);
  assert.match(sql, /Do not edit affected people until restored/);
  assert.match(sql, /old code's syncPersonEvents/);
  assert.match(sql, /notable_retired_/);
  assert.match(sql, /2026-10-22-multi-notable-rollback-a-render-drop-check\.sql/);
  assert.match(sql, /2026-10-22-multi-notable-rollback-b-lab-retire-rekey\.sql/);
  assert.match(sql, /2026-10-22-multi-notable-rollback-d-render-restore-pk\.sql/);
  assert.match(sql, /2026-10-22-multi-notable-rollback-e-lab-restore-pk\.sql/);
  assert.match(sql, /2026-10-22-multi-notable-replication-checks\.sql/);
});

test("rollback step a only drops the CHECK", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-rollback-a-render-drop-check.sql");
  assertNoDestructiveDml(sql, "rollback a");
  assertRollbackOrder(sql);
  assert.match(sql, /This step runs on Render/);
  const body = executableSql(sql);
  assert.equal((body.match(/^\s*BEGIN\s*;/gm) || []).length, 1);
  assert.equal((body.match(/^\s*COMMIT\s*;/gm) || []).length, 1);
  assert.match(body, /DROP CONSTRAINT IF EXISTS person_events_seq_notable_only/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|CREATE|RAISE)\b/i);
  assert.doesNotMatch(body, /person_events_pkey/);
});

test("rollback step b copies, drops the CHECK, re-keys, and keeps the three-column PK", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-rollback-b-lab-retire-rekey.sql");
  assertNoDestructiveDml(sql, "rollback b", { allowUpdate: true });
  assertRollbackOrder(sql);
  assert.match(sql, /This step runs on lab/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS person_events_multi_notable_retired/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS people_events_multi_notable_retired/);
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
  assert.ok(beginAt >= 0 && commitAt > beginAt);
  assert.ok(
    copyAt > beginAt &&
      peopleCopyAt > copyAt &&
      checkDropAt > peopleCopyAt &&
      rekeyAt > checkDropAt &&
      rekeyAt < commitAt,
  );
  assert.doesNotMatch(sql, /ADD CONSTRAINT person_events_pkey PRIMARY KEY \(person_id, kind\)/);
  assert.doesNotMatch(sql, /DROP CONSTRAINT(?: IF EXISTS)? person_events_pkey/);
});

function assertPkRestoreStep(rel, side) {
  const sql = read(rel);
  assertNoDestructiveDml(sql, rel);
  assertRollbackOrder(sql);
  assert.match(sql, new RegExp(`This step runs on ${side}`));
  const body = executableSql(sql);
  assert.equal((body.match(/^\s*BEGIN\s*;/gm) || []).length, 1);
  assert.equal((body.match(/^\s*COMMIT\s*;/gm) || []).length, 1);
  assert.doesNotMatch(body, /\bUPDATE\b/i);
  assert.match(body, /RAISE EXCEPTION/);
  assert.match(body, /kind = 'notable'/);
  assert.match(body, /seq > 0/);
  assert.match(body, /ADD CONSTRAINT person_events_pkey PRIMARY KEY \(person_id, kind\)/);
  assert.match(body, /DROP CONSTRAINT person_events_pkey/);
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key/);
  assert.match(body, /REPLICA IDENTITY DEFAULT/);
  const beginAt = body.search(/^\s*BEGIN\s*;/m);
  const raiseAt = body.search(/RAISE EXCEPTION/);
  const pkAt = body.search(/ADD CONSTRAINT person_events_pkey PRIMARY KEY \(person_id, kind\)/);
  const commitAt = body.search(/^\s*COMMIT\s*;/m);
  assert.ok(beginAt >= 0 && raiseAt > beginAt && pkAt > raiseAt && commitAt > pkAt);
}

test("rollback steps d and e restore the two-column PK behind a re-key guard", () => {
  assertPkRestoreStep(
    "scripts/migrations/2026-10-22-multi-notable-rollback-d-render-restore-pk.sql",
    "Render",
  );
  assertPkRestoreStep(
    "scripts/migrations/2026-10-22-multi-notable-rollback-e-lab-restore-pk.sql",
    "lab",
  );
});

test("replication checks file is SELECTs only", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-replication-checks.sql");
  assertRollbackOrder(sql);
  const body = executableSql(sql);
  assert.match(body, /pg_stat_subscription/);
  assert.match(body, /apply_error_count/);
  assert.match(body, /pg_current_wal_lsn\(\)/);
  assert.match(body, /pg_replication_slots/);
  assert.match(body, /confirmed_flush_lsn/);
  assert.doesNotMatch(
    body,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|BEGIN|COMMIT|DO)\b/i,
  );
});

test("docs run phase B on lab before Render and keep phase A on Render first", () => {
  const doc = read("docs/MULTI_NOTABLE_MIGRATION.md");
  const renderA = doc.indexOf("**Render: phase A**");
  const labA = doc.indexOf("**Lab: phase A.**");
  const labB = doc.indexOf("**Lab: phase B**");
  const renderB = doc.indexOf("**Render: phase B.**");
  assert.ok(renderA >= 0 && labA > renderA, "phase A is Render then lab");
  assert.ok(labB > labA && renderB > labB, "phase B is lab then Render");
  assert.match(doc, /Before every step/);
  assert.match(doc, /apply_error_count/);
  assert.match(doc, /confirmed_flush_lsn/);
  assert.match(doc, /pg_current_wal_lsn\(\)/);
  assert.match(doc, /publisher did not send replica identity column/);
  assert.match(doc, /multi_notable_needs_phase_b/);
  assert.match(doc, /off-ingest/);
  assert.match(doc, /SHARE/);
  assert.match(doc, /person_events_person_kind_seq_key/);
  assert.match(doc, /USING INDEX/);
  const stepA = doc.indexOf("rollback-a-render-drop-check.sql");
  const stepB = doc.indexOf("rollback-b-lab-retire-rekey.sql");
  const stepD = doc.indexOf("rollback-d-render-restore-pk.sql");
  const stepE = doc.indexOf("rollback-e-lab-restore-pk.sql");
  assert.ok(stepA >= 0 && stepB > stepA && stepD > stepB && stepE > stepD);
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
    "2026-10-22-multi-notable-rollback-a-render-drop-check.sql",
    "2026-10-22-multi-notable-rollback-b-lab-retire-rekey.sql",
    "2026-10-22-multi-notable-rollback-d-render-restore-pk.sql",
    "2026-10-22-multi-notable-rollback-e-lab-restore-pk.sql",
    "2026-10-22-multi-notable-replication-checks.sql",
  ]) {
    assert.equal(fs.existsSync(path.join(MIGRATIONS, name)), true, name);
  }
});

test("multi-notable SQL files have no DELETE, TRUNCATE, DROP TABLE, or DROP COLUMN", () => {
  for (const name of fs.readdirSync(MIGRATIONS)) {
    if (!name.startsWith("2026-10-22-multi-notable-")) continue;
    const allowUpdate = name.includes("rollback-b-");
    assertNoDestructiveDml(read(path.join("scripts", "migrations", name)), name, { allowUpdate });
  }
});
