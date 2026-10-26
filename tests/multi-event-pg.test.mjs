/**
 * Multi-event migrations on a real Postgres (the CI postgres:16 service; locally a
 * throwaway localhost cluster). Skips unless ET_SCRATCH_PG_URL is set and local.
 * Never lab, never Render.
 *
 * Each run creates two fresh databases (lab-shaped and render-shaped) named
 * et_multi_event_<pid>_<time>_{lab,render} and leaves them for the throwaway
 * cluster's teardown.
 *
 * Covers:
 *  - the docs/MIGRATION.md round trip on both shapes:
 *    F2 render-a -> F3 lab -> F5 render-b -> rollback, equal by key;
 *  - "public code ignores the extra seq column": with render-a applied to a
 *    database that had no seq, 702c3642's companion SQL (INSERT ... seq ...
 *    ON CONFLICT (person_id, kind, seq): the column list and conflict target
 *    syncPersonEvents sends, with seq 0) and its reads work; seq stays 0;
 *  - the write switch: ET_MULTI_EVENT_WRITES off refuses seq > 0 even after
 *    the key swap;
 *  - the STOP guards: REPLICA IDENTITY other than DEFAULT, a look-alike
 *    person_events_person_kind_seq_key index, render-b before render-a; and that
 *    no migration changes the CHECK set.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { attachPersonEvent, projectPerson } from "../app/lib/promote.mjs";
import { syncPersonEvents } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (step) => fs.readFileSync(path.join(ROOT, "scripts/migrations", `2026-10-26-multi-event-${step}.sql`), "utf8");
const URL_ENV = process.env.ET_SCRATCH_PG_URL || "";
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const local = (() => { try { return LOCAL.has(new URL(URL_ENV).hostname); } catch { return false; } })();
const skip = !URL_ENV ? "ET_SCRATCH_PG_URL unset" : !local ? "ET_SCRATCH_PG_URL is not localhost" : false;

const PEOPLE_SQL = "CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT)";
// Lab's person_events at 2026-10-26 12:14 ET (read-only dump): phase A.
const PE_LAB = `CREATE TABLE person_events (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  event_date DATE,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  announced_date DATE, position TEXT, organization TEXT, country TEXT, branch TEXT,
  comments TEXT, age_at_event INTEGER, alleged_reason TEXT, unsealed BOOLEAN,
  notable_group TEXT, title_note TEXT, status TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT person_events_event_date_kind CHECK (event_date IS NOT NULL OR kind = 'death_unconfirmed'),
  PRIMARY KEY (person_id, kind)
);
CREATE UNIQUE INDEX person_events_person_kind_seq_key ON person_events (person_id, kind, seq);`;
// Worf's model of an unmigrated subscriber: the same table without seq or the phase A index.
const PE_NO_SEQ = PE_LAB.replace("  seq INTEGER NOT NULL DEFAULT 0,\n", "").replace(/CREATE UNIQUE INDEX[^;]+;/, "");

async function withDb(admin, name, fn) {
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(URL_ENV);
  u.pathname = `/${name}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const ROWS = [
  ["alice", "firing", "2025-01-02"], ["alice", "notable", "2024-05-06"], ["bob", "corona_comms", "2020-10-01"],
  ["bob", "red_folder", "2024-06-13"], ["carol", "death_unconfirmed", null], ["carol", "endorsement", "2026-01-01"],
];
async function seed(c, withSeq) {
  await c.query(PEOPLE_SQL);
  await c.query(withSeq ? PE_LAB : PE_NO_SEQ);
  for (const id of ["alice", "bob", "carol", "keith-self"]) await c.query("INSERT INTO people (id, name) VALUES ($1, $1)", [id]);
  for (const [p, k, d] of ROWS) {
    await c.query("INSERT INTO person_events (person_id, kind, event_date, sources) VALUES ($1, $2, $3, '[]')", [p, k, d]);
  }
}
// A migration file opens its own BEGIN; when its guard raises, end that aborted transaction.
async function rejectsMig(c, step, re) {
  await assert.rejects(c.query(MIG(step)), re, step);
  await c.query("ROLLBACK");
}
const byKey = async (c) => (await c.query(
  "SELECT person_id || '|' || kind || '|' || coalesce(event_date::text, '') AS k FROM person_events ORDER BY 1",
)).rows.map((r) => r.k);
const pkCols = async (c) => (await c.query(
  `SELECT string_agg(a.attname, ',' ORDER BY array_position(con.conkey, a.attnum)) AS cols
     FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.person_events'::regclass AND con.contype = 'p'`,
)).rows[0].cols;
const checks = async (c) => (await c.query(
  "SELECT conname FROM pg_constraint WHERE conrelid = 'public.person_events'::regclass AND contype = 'c' ORDER BY 1",
)).rows.map((r) => r.conname);
const replident = async (c) => (await c.query(
  "SELECT relreplident::text AS r FROM pg_class WHERE oid = 'public.person_events'::regclass",
)).rows[0].r;
const hasSeq = async (c) => (await c.query(
  "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.person_events'::regclass AND attname = 'seq' AND NOT attisdropped",
)).rows[0].n === 1;

// 702c3642's companion write for a seq 0 event (store.mjs syncPersonEvents: same column list, VALUES and
// conflict target; the DO UPDATE list is shortened here).
const MAIN_INSERT = `INSERT INTO person_events (
         person_id, kind, seq, event_date, sources, announced_date,
         position, organization, country, branch, comments,
         notable_group, title_note, status,
         age_at_event, unsealed
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (person_id, kind, seq) DO UPDATE SET event_date = EXCLUDED.event_date`;
const mainWrite = (c, p, k, d) => c.query(MAIN_INSERT, [p, k, 0, d, "[]", null, null, null, null, null, null, null, null, null, null, null]);
// 702c3642's list read shape (MAX(event_date) per person and kind).
const mainRead = async (c) => (await c.query(
  "SELECT p.id, (SELECT MAX(e.event_date)::text FROM person_events e WHERE e.person_id = p.id) AS d FROM people p ORDER BY p.id",
)).rows.map((r) => `${r.id}:${r.d}`);

test("multi-event on Postgres: render-a, lab, render-b and the rollback; public code ignores the extra seq column", { skip }, async () => {
  const admin = new pg.Client({ connectionString: URL_ENV });
  await admin.connect();
  const tag = `et_multi_event_${process.pid}_${Date.now()}`;
  try {
    await withDb(admin, `${tag}_render`, async (render) => {
      await seed(render, false);
      const keys0 = await byKey(render);
      const read0 = await mainRead(render);
      const checks0 = await checks(render);
      assert.deepEqual(checks0, ["person_events_event_date_kind"]);
      // F5 before F2 refuses: no seq column yet.
      await rejectsMig(render, "up-render-b", /needs render-a first/);
      // Public code needs seq: before F2 its write fails on the missing column.
      await assert.rejects(mainWrite(render, "keith-self", "notable", "2025-04-01"), /column "seq" of relation "person_events" does not exist/);
      // F2 (twice: idempotent). Additive only.
      await render.query(MIG("up-render-a"));
      await render.query(MIG("up-render-a"));
      assert.equal(await hasSeq(render), true);
      assert.equal(await pkCols(render), "person_id,kind", "F2 leaves the primary key alone");
      assert.deepEqual(await byKey(render), keys0);
      assert.deepEqual(await mainRead(render), read0, "reads ignore the new column");
      await mainWrite(render, "keith-self", "notable", "2025-04-01");
      await mainWrite(render, "keith-self", "notable", "2025-04-02");
      assert.deepEqual((await render.query("SELECT seq, event_date::text d FROM person_events WHERE person_id = 'keith-self'")).rows, [{ seq: 0, d: "2025-04-02" }]);
      assert.equal((await render.query("SELECT count(*)::int n FROM person_events WHERE seq <> 0")).rows[0].n, 0, "every existing row got seq 0");
      // The PR's own syncPersonEvents (seq 0 only) works on the F2 shape too.
      const bob = projectPerson({ id: "bob", name: "bob", events: [{ kind: "corona_comms", event_date: "2020-10-01", sources: [] }] });
      await syncPersonEvents(render, bob);
      assert.deepEqual(await checks(render), checks0, "F2 adds no CHECK: the CHECK set stays equal to lab's");
      // B-3: F5 STOPs, with nothing changed, unless REPLICA IDENTITY is DEFAULT.
      await render.query("ALTER TABLE person_events REPLICA IDENTITY FULL");
      await rejectsMig(render, "up-render-b", /REPLICA IDENTITY is f \(expected d, DEFAULT\); STOP/);
      assert.equal(await pkCols(render), "person_id,kind");
      assert.equal(await replident(render), "f", "the guard did not reset it");
      await render.query("ALTER TABLE person_events REPLICA IDENTITY DEFAULT");
      // The swap works and is idempotent.
      await render.query(MIG("up-render-b"));
      await render.query(MIG("up-render-b"));
      assert.equal(await pkCols(render), "person_id,kind,seq");
      assert.equal(await replident(render), "d");
      assert.deepEqual(await checks(render), checks0, "F5 adds no CHECK");
      // Rollback on the render side: render-b down refuses with a seq > 0 row; render-a down keeps the column.
      await render.query("INSERT INTO person_events (person_id, kind, seq, event_date) VALUES ('bob', 'red_folder', 1, '2025-12-17')");
      await rejectsMig(render, "down-render-b", /still has seq > 0 \(or negative\) rows/);
      await render.query("DELETE FROM person_events WHERE seq > 0");
      await rejectsMig(render, "down-render-a", /run down-render-b first/);
      await render.query(MIG("down-render-b"));
      await render.query(MIG("down-render-b"));
      assert.equal(await pkCols(render), "person_id,kind");
      await render.query(MIG("down-render-a"));
      assert.equal(await hasSeq(render), true, "down-render-a keeps seq: lab still sends it");
      assert.deepEqual(await checks(render), checks0);
      await mainWrite(render, "carol", "endorsement", "2026-01-02");
    });
    await withDb(admin, `${tag}_lab`, async (lab) => {
      await seed(lab, true);
      const keys0 = await byKey(lab);
      const checks0 = await checks(lab);
      // B-3: F3 STOPs, with nothing changed, when FULL was left over (e.g. a rollback's r1).
      await lab.query("ALTER TABLE person_events REPLICA IDENTITY FULL");
      await rejectsMig(lab, "up-lab", /REPLICA IDENTITY is f \(expected d, DEFAULT\); STOP/);
      assert.equal(await pkCols(lab), "person_id,kind");
      assert.equal(await replident(lab), "f");
      await lab.query("ALTER TABLE person_events REPLICA IDENTITY DEFAULT");
      // B-4: a look-alike index under the phase A name (wrong columns) STOPs F3.
      await lab.query("ALTER INDEX person_events_person_kind_seq_key RENAME TO person_events_person_kind_seq_key_real");
      await lab.query("CREATE UNIQUE INDEX person_events_person_kind_seq_key ON person_events (person_id, seq, kind)");
      await rejectsMig(lab, "up-lab", /is not a valid unique index on public\.person_events \(person_id, kind, seq\); STOP/);
      await lab.query("DROP INDEX person_events_person_kind_seq_key");
      await lab.query("ALTER INDEX person_events_person_kind_seq_key_real RENAME TO person_events_person_kind_seq_key");
      await lab.query(MIG("up-lab"));
      await lab.query(MIG("up-lab"));
      assert.equal(await pkCols(lab), "person_id,kind,seq");
      assert.deepEqual(await byKey(lab), keys0, "F3 is equal by key");
      assert.deepEqual(await checks(lab), checks0, "F3 adds no CHECK");
      assert.equal(await replident(lab), "d");
      // The switch: off refuses seq > 0 even on the migrated key; on allows it.
      const k = attachPersonEvent(attachPersonEvent(projectPerson({ id: "keith-self", name: "Keith Self", events: [] }),
        { kind: "notable", event_date: "2024-05-01", sources: [{ url: "https://example.org/a" }] }).person,
      { kind: "notable", event_date: "2026-10-05", sources: [{ url: "https://example.org/b" }] }).person;
      const saved = process.env.ET_MULTI_EVENT_WRITES;
      try {
        delete process.env.ET_MULTI_EVENT_WRITES;
        await assert.rejects(syncPersonEvents(lab, k), { code: "multi_event_writes_off" });
        process.env.ET_MULTI_EVENT_WRITES = "on";
        await syncPersonEvents(lab, k);
      } finally {
        if (saved === undefined) delete process.env.ET_MULTI_EVENT_WRITES; else process.env.ET_MULTI_EVENT_WRITES = saved;
      }
      assert.deepEqual((await lab.query("SELECT kind, seq FROM person_events WHERE person_id = 'keith-self' ORDER BY seq")).rows, [{ kind: "notable", seq: 0 }, { kind: "notable", seq: 1 }]);
      // Lab rollback: down-lab needs FULL only on a publisher (none here), and no seq > 0 rows.
      await rejectsMig(lab, "down-lab", /still has seq > 0 \(or negative\) rows/);
      await lab.query("DELETE FROM person_events WHERE person_id = 'keith-self'");
      await lab.query(MIG("down-lab"));
      await lab.query(MIG("down-lab"));
      assert.equal(await pkCols(lab), "person_id,kind");
      assert.deepEqual(await byKey(lab), keys0, "round trip equal by key");
      const idx = (await lab.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'person_events_person_kind_seq_key'")).rows;
      assert.equal(idx.length, 1, "the phase A index is back");
    });
  } finally {
    await admin.end();
  }
});
