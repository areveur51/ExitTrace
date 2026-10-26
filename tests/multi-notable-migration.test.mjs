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

const RB = "2026-10-22-multi-notable-rollback";
const RB_FILES = {
  r1: `${RB}-r1-lab-replica-identity-full.sql`,
  r2: `${RB}-r2-lab-bak-delete.sql`,
  r3a: `${RB}-r3a-render-drop-check.sql`,
  r4: `${RB}-r4-render-restore-pk.sql`,
  r5: `${RB}-r5-lab-restore-pk.sql`,
  r6: `${RB}-r6-lab-replica-identity-default.sql`,
  r7a: `${RB}-r7a-lab-drop-seq.sql`,
  r7b: `${RB}-r7b-render-drop-seq.sql`,
};

function readRb(step) {
  return read(path.join("scripts", "migrations", RB_FILES[step]));
}

function assertRollbackOrder(sql) {
  const markers = [
    "r0. Lab + Render, read-only: freeze",
    "r1. Lab: ALTER TABLE public.person_events REPLICA IDENTITY FULL",
    "r2. Lab: copy every seq > 0 row",
    "r3. Read-only: LSN catch-up",
    "r3a. Render: drop CHECK",
    "r4. Render: PRIMARY KEY back to (person_id, kind)",
    "r5. Lab: PRIMARY KEY back to (person_id, kind)",
    "r6. Lab: ALTER TABLE public.person_events REPLICA IDENTITY DEFAULT",
    "r7. Optional",
  ];
  let at = -1;
  for (const marker of markers) {
    const next = sql.indexOf(marker);
    assert.ok(next > at, marker);
    at = next;
  }
  assert.match(sql, /run on lab first, then Render/);
  assert.match(sql, /Do not ALTER PUBLICATION/);
  assert.match(sql, /apply_error_count flat and every srsubstate = 'r'/);
  assert.match(sql, /Render's key columns are a subset\n-- of lab's replica identity columns, OR lab is on REPLICA IDENTITY FULL/);
  assert.match(sql, /lab never has a column Render lacks/);
  assert.doesNotMatch(sql, /\b(rm|unlink)\b/);
}

function txnCount(body) {
  return [
    (body.match(/^\s*BEGIN\s*;/gm) || []).length,
    (body.match(/^\s*COMMIT\s*;/gm) || []).length,
  ];
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

test("phase B is superseded: its only executable statement is one refusing DO block (Worf r4 LOW-1, r5 LOW-3: holds under ON_ERROR_ROLLBACK)", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-phase-b.sql");
  assertNoDestructiveDml(sql, "phase B");
  assert.match(sql, /^-- SUPERSEDED \(Worf r4 LOW-1, 2026-10-26\)\. DO NOT RUN\./);
  assert.match(sql, /git show abe4c21a:scripts\/migrations\/2026-10-22-multi-notable-phase-b\.sql/);
  const body = executableSql(sql).trim();
  assert.equal(
    body,
    "DO $$\nBEGIN\n  RAISE EXCEPTION 'superseded: 2026-10-22-multi-notable-phase-b.sql must not run; use the 2026-10-26-multi-event-* steps (docs/MIGRATION.md)';\nEND $$;",
  );
  // Nothing a per-statement savepoint could skip past into: no transaction, no DDL, no CHECK.
  assert.doesNotMatch(body, /^\s*(BEGIN|COMMIT)\s*;/im);
  assert.doesNotMatch(body, /\b(ALTER|CREATE|DROP|ADD\s+CONSTRAINT|REPLICA\s+IDENTITY|PRIMARY\s+KEY)\b/i);
  assert.doesNotMatch(body, /person_events_seq_notable_only/);
  assert.equal((body.match(/\bDO \$\$/g) || []).length, 1);
});

test("rollback index is comments only and states the fixed r0-r7 order", () => {
  const sql = read(`scripts/migrations/${RB}.sql`);
  assert.equal(executableSql(sql).trim(), "");
  assertRollbackOrder(sql);
  assert.match(sql, /exittrace_lab_pub is a table list/);
  assert.match(sql, /lab-local _bak tables are the durable copy/);
  assert.match(sql, /do not edit affected people until\n-- restored/);
  for (const file of Object.values(RB_FILES)) assert.match(sql, new RegExp(file.replace(/\./g, "\\.")));
  assert.match(sql, /2026-10-22-multi-notable-replication-checks\.sql/);
});

test("every rollback step file states the order and runs in one transaction", () => {
  for (const [step, file] of Object.entries(RB_FILES)) {
    const sql = readRb(step);
    assertRollbackOrder(sql);
    assert.deepEqual(txnCount(executableSql(sql)), [1, 1], file);
    assert.doesNotMatch(executableSql(sql), /\bTRUNCATE\b|\bCASCADE\b|\bDROP\s+TABLE\b/i, file);
    assert.doesNotMatch(executableSql(sql), /\bUPDATE\b/i, file);
  }
});

test("r1 sets REPLICA IDENTITY FULL on lab and nothing else", () => {
  const sql = readRb("r1");
  assert.match(sql, /This step runs on lab/);
  const body = executableSql(sql).replace(/\s+/g, " ").trim();
  assert.equal(body, "BEGIN; ALTER TABLE public.person_events REPLICA IDENTITY FULL; COMMIT;");
});

test("r2 needs FULL, copies seq > 0 rows to _bak, checks the copy, then DELETEs", () => {
  const sql = readRb("r2");
  assert.match(sql, /This step runs on lab/);
  const body = executableSql(sql);
  const fullGuard = body.indexOf("<> 'f'");
  const bakCreate = body.indexOf("CREATE TABLE IF NOT EXISTS public.person_events_multi_notable_bak");
  const peopleBak = body.indexOf("CREATE TABLE IF NOT EXISTS public.people_events_multi_notable_bak");
  const copy = body.indexOf("INSERT INTO public.person_events_multi_notable_bak");
  const peopleCopy = body.indexOf("INSERT INTO public.people_events_multi_notable_bak");
  const check = body.indexOf("r2 copy check failed");
  const del = body.indexOf("DELETE FROM public.person_events WHERE seq > 0;");
  const commit = body.search(/^\s*COMMIT\s*;/m);
  assert.ok(fullGuard > 0 && bakCreate > fullGuard && peopleBak > bakCreate);
  assert.ok(copy > peopleBak && peopleCopy > copy && check > peopleCopy && del > check && commit > del);
  assert.equal((body.match(/\bDELETE\b/gi) || []).length, 1);
});

test("r3a only drops the CHECK on Render", () => {
  const sql = readRb("r3a");
  assert.match(sql, /This step runs on Render/);
  const body = executableSql(sql).replace(/\s+/g, " ").trim();
  assert.equal(
    body,
    "BEGIN; ALTER TABLE public.person_events DROP CONSTRAINT IF EXISTS person_events_seq_notable_only; COMMIT;",
  );
});

function assertPkRestoreStep(step, side) {
  const sql = readRb(step);
  assert.match(sql, new RegExp(`This step runs on ${side}`));
  const body = executableSql(sql);
  assert.doesNotMatch(body, /\b(UPDATE|DELETE|INSERT)\b/i);
  const seqGuard = body.indexOf("WHERE seq > 0");
  const dupGuard = body.search(/HAVING count\(\*\) > 1/);
  const dropPk = body.indexOf("DROP CONSTRAINT person_events_pkey");
  const addPk = body.indexOf("ADD CONSTRAINT person_events_pkey PRIMARY KEY (person_id, kind)");
  const idx = body.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key");
  assert.ok(seqGuard > 0 && dupGuard > seqGuard && dropPk > dupGuard && addPk > dropPk && idx > addPk, step);
  assert.match(body, /DROP CONSTRAINT IF EXISTS person_events_seq_notable_only/);
  assert.doesNotMatch(body, /REPLICA IDENTITY DEFAULT/, `${step} must not leave FULL early`);
  return body;
}

test("r4 (Render) and r5 (lab) restore (person_id, kind) behind seq and duplicate guards", () => {
  assertPkRestoreStep("r4", "Render");
  const r5 = assertPkRestoreStep("r5", "lab");
  assert.ok(r5.indexOf("<> 'f'") > 0 && r5.indexOf("<> 'f'") < r5.indexOf("WHERE seq > 0"), "r5 needs FULL");
});

test("r6 sets REPLICA IDENTITY DEFAULT on lab only after the PK lost seq", () => {
  const sql = readRb("r6");
  assert.match(sql, /This step runs on lab/);
  const body = executableSql(sql);
  const guard = body.indexOf("r6 needs r5 first");
  const def = body.indexOf("ALTER TABLE public.person_events REPLICA IDENTITY DEFAULT;");
  assert.ok(guard > 0 && def > guard);
});

test("r7 is optional, lab first, and guarded on the two-column PK and DEFAULT identity", () => {
  const lab = readRb("r7a");
  const render = readRb("r7b");
  assert.match(lab, /OPTIONAL/);
  assert.match(lab, /This step runs on lab/);
  assert.match(lab, /Lab first/);
  assert.match(render, /This step runs on Render/);
  assert.match(render, /Only after r7a on lab/);
  for (const sql of [lab, render]) {
    const body = executableSql(sql);
    assert.ok(body.indexOf("r7 needs r4/r5 first") < body.indexOf("DROP COLUMN IF EXISTS seq"));
    assert.ok(body.indexOf("<> 'd'") < body.indexOf("DROP COLUMN IF EXISTS seq"));
  }
});

test("replication checks file is SELECTs only", () => {
  const sql = read("scripts/migrations/2026-10-22-multi-notable-replication-checks.sql");
  assertRollbackOrder(sql);
  const body = executableSql(sql);
  assert.match(body, /SELECT version\(\);/);
  assert.match(body, /pg_stat_subscription/);
  assert.match(body, /apply_error_count/);
  assert.match(body, /srsubstate/);
  assert.match(body, /pg_current_wal_lsn\(\)/);
  assert.match(body, /pg_replication_slots/);
  assert.match(body, /confirmed_flush_lsn/);
  assert.match(body, /relreplident/);
  assert.match(body, /HAVING count\(\*\) > 1/);
  assert.match(body, /person_events_multi_notable_bak/);
  assert.match(body, /puballtables/);
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
  const order = ["r1", "r2", "r3a", "r4", "r5", "r6", "r7a", "r7b"].map((k) => doc.indexOf(RB_FILES[k]));
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i - 1] >= 0 && order[i] > order[i - 1], `doc step ${i}`);
  assert.match(doc, /## Replication invariant/);
  assert.match(doc, /lab never has a column Render lacks/);
  assert.match(doc, /REPLICA IDENTITY FULL/);
  assert.match(doc, /SELECT version\(\);/);
  assert.doesNotMatch(doc, /\b(rm|unlink)\b/);
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

test("bootstrap-db.sql has no person_events PK swap; fresh tables get seq and PRIMARY KEY (person_id, kind, seq), with no seq CHECK", () => {
  const sql = read("scripts/bootstrap-db.sql");
  assert.doesNotMatch(sql, /person_events_seq_notable_only|person_events_seq_nonneg|CHECK \(seq/);
  assert.doesNotMatch(sql, /PRIMARY KEY USING INDEX person_events/);
  assert.doesNotMatch(sql, /DROP CONSTRAINT(?: IF EXISTS)? person_events_pkey/);
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS person_events \([\s\S]*?seq INTEGER NOT NULL DEFAULT 0,[\s\S]*?PRIMARY KEY \(person_id, kind, seq\)\n\);/s,
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
    `${RB}.sql`,
    ...Object.values(RB_FILES),
    "2026-10-22-multi-notable-replication-checks.sql",
  ]) {
    assert.equal(fs.existsSync(path.join(MIGRATIONS, name)), true, name);
  }
});

test("multi-notable SQL: DELETE only in r2, DROP COLUMN only in optional r7, never TRUNCATE or DROP TABLE", () => {
  for (const name of fs.readdirSync(MIGRATIONS)) {
    if (!name.startsWith("2026-10-22-multi-notable-")) continue;
    const body = executableSql(read(path.join("scripts", "migrations", name)));
    assert.doesNotMatch(body, /\bTRUNCATE\b/i, name);
    assert.doesNotMatch(body, /\bDROP\s+TABLE\b/i, name);
    assert.doesNotMatch(body, /\bCASCADE\b/i, name);
    assert.doesNotMatch(body, /\bUPDATE\b/i, name);
    if (name !== RB_FILES.r2) assert.doesNotMatch(body, /\bDELETE\b/i, name);
    if (name !== RB_FILES.r7a && name !== RB_FILES.r7b) assert.doesNotMatch(body, /\bDROP\s+COLUMN\b/i, name);
  }
});
