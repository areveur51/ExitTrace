/**
 * person_relationships_a_label and person_relationships_b_label are closed
 * lists of a_calls_b and b_calls_a strings. They are not a limit on how many
 * relationship rows or events a card can have.
 *
 * Two layers:
 * - The SQL-shape test always runs, including in `npm test` on CI. It does
 *   not open PostgreSQL.
 * - The populated test applies the real subscriber boot to a throwaway
 *   cluster. It skips unless ET_SCRATCH_PG_URL is set. `npm test` leaves that
 *   unset, so CI skips it there. The workflow then starts loopback Postgres
 *   and runs this file with the variable set. tests/boot-subscriber-guard.test.mjs
 *   is a fake pool and is not this fixture.
 *
 * Never lab, never Render.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SUBSCRIBER_COUNT_SQL, bootDatabase, stripBootDataWrites } from "../app/lib/boot-guard.mjs";
import { RELATIONSHIP_LABELS } from "../app/lib/relationships.mjs";
import { ensureSchema, healLogicalApply } from "../app/lib/store.mjs";
import { connectScratch, scratchPgTarget } from "./scratch-pg.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
const URL_ENV = process.env.ET_SCRATCH_PG_URL || "";

const OLD_LIST = RELATIONSHIP_LABELS.map((label) => `'${label}'`).join(", ");
const READD_A_LABEL = `ALTER TABLE person_relationships ADD CONSTRAINT person_relationships_a_label CHECK (a_calls_b IN (${OLD_LIST}))`;
const READD_B_LABEL = `ALTER TABLE person_relationships ADD CONSTRAINT person_relationships_b_label CHECK (b_calls_a IN (${OLD_LIST}))`;

function subscriberPool(client) {
  return {
    async query(sql, params) {
      if (sql === SUBSCRIBER_COUNT_SQL) return { rows: [{ n: 1 }] };
      return client.query(sql, params);
    },
  };
}

async function bootSubscriber(client) {
  const lines = [];
  const errors = [];
  const result = await bootDatabase(subscriberPool(client), {
    bootstrapSql: BOOTSTRAP,
    seed: { people: [], dog_comms: [] },
    ensureSchema,
    healLogicalApply,
    importSeed: async () => {
      throw new Error("importSeed ran on a subscriber");
    },
    migrateUniquePeople: async () => {
      throw new Error("migrateUniquePeople ran on a subscriber");
    },
    log: (line) => lines.push(String(line)),
    logError: (line) => errors.push(String(line)),
  });
  return { result, lines, errors };
}

async function constraintNames(client) {
  const found = await client.query(
    `SELECT c.conname
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND r.relname = 'person_relationships'
      ORDER BY c.conname`,
  );
  return found.rows.map((row) => row.conname);
}

test("subscriber bootstrap drops both label checks and bounds the lock wait", () => {
  const stripped = stripBootDataWrites(BOOTSTRAP);
  const lockOn = stripped.indexOf("lock_timeout', '5s'");
  const noteCol = stripped.indexOf("ADD COLUMN IF NOT EXISTS a_note");
  const dropA = stripped.indexOf("DROP CONSTRAINT IF EXISTS person_relationships_a_label");
  const dropB = stripped.indexOf("DROP CONSTRAINT IF EXISTS person_relationships_b_label");
  const lockOff = stripped.indexOf("lock_timeout', '0'");
  assert.ok(lockOn >= 0 && lockOn < noteCol && noteCol < dropA && dropA < dropB && dropB < lockOff);
  assert.doesNotMatch(stripped, /ADD CONSTRAINT person_relationships_a_label/);
  assert.doesNotMatch(stripped, /ADD CONSTRAINT person_relationships_b_label/);
  assert.doesNotMatch(stripped, /CONSTRAINT person_relationships_a_label CHECK/);
  assert.doesNotMatch(stripped, /CONSTRAINT person_relationships_b_label CHECK/);
  assert.match(stripped, /ADD CONSTRAINT person_relationships_kind/);
  assert.match(stripped, /ADD CONSTRAINT person_relationships_a_note_len/);
  assert.match(stripped, /ADD CONSTRAINT person_relationships_b_note_len/);
  assert.match(stripped, /person_relationships_pair_order/);
  assert.match(stripped, /person_relationships_pair_kind UNIQUE/);
  assert.doesNotMatch(stripped, /INSERT INTO person_relationships/i);
});

test(
  "populated subscriber boot drops both label checks, keeps rows and events, and does not wait forever",
  { skip: URL_ENV ? false : "ET_SCRATCH_PG_URL not set (needs a local throwaway Postgres)", timeout: 120_000 },
  async () => {
    const target = scratchPgTarget(URL_ENV);
    const client = await connectScratch(target);
    try {
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
      const first = await bootSubscriber(client);
      assert.equal(first.result.subscriber, true);
      assert.equal(first.result.imported, null);
      assert.equal(first.result.migrated, null);
      assert.ok(first.lines.some((line) => /subscriber DB \(subscriptions=1\)/.test(line)));
      assert.ok(first.lines.some((line) => /skipping bootstrap row backfills/.test(line)));
      assert.ok(first.lines.some((line) => /skipping importSeed/.test(line)));
      assert.deepEqual(
        (await constraintNames(client)).filter((name) => name.endsWith("_label")),
        [],
      );

      await client.query(
        `INSERT INTO people (id, category, name, event_date) VALUES
           ('ada-alpha', 'resignations', 'Ada Alpha', '2020-01-02'),
           ('bea-beta', 'resignations', 'Bea Beta', '2020-03-04'),
           ('cy-gamma', 'firings', 'Cy Gamma', '2021-05-06')`,
      );
      await client.query(
        `INSERT INTO person_relationships
           (id, person_a, person_b, kind, a_calls_b, b_calls_a, sources)
         VALUES
           ('ada-alpha--bea-beta--professional', 'ada-alpha', 'bea-beta', 'professional', 'Former organizer', 'Candidate', '[]'::jsonb)`,
      );
      await client.query(READD_A_LABEL);
      await client.query(READD_B_LABEL);
      let names = await constraintNames(client);
      assert.ok(names.includes("person_relationships_a_label"));
      assert.ok(names.includes("person_relationships_b_label"));

      const holder = await connectScratch(target);
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE person_relationships IN ACCESS EXCLUSIVE MODE");
      let lockedBoot;
      try {
        lockedBoot = await bootSubscriber(client);
      } finally {
        await holder.query("ROLLBACK");
        await holder.end();
      }
      assert.equal(lockedBoot.result.subscriber, true);
      assert.ok(
        lockedBoot.errors.some((line) =>
          /subscriber schema failed \(55P03\); listening with the existing schema/.test(line),
        ),
      );
      names = await constraintNames(client);
      assert.ok(names.includes("person_relationships_a_label"));
      assert.ok(names.includes("person_relationships_b_label"));
      const duringLock = await client.query(
        `SELECT a_calls_b, b_calls_a FROM person_relationships WHERE id = 'ada-alpha--bea-beta--professional'`,
      );
      assert.equal(duringLock.rows[0].a_calls_b, "Former organizer");
      assert.equal(duringLock.rows[0].b_calls_a, "Candidate");

      const dropped = await bootSubscriber(client);
      assert.equal(dropped.result.subscriber, true);
      names = await constraintNames(client);
      assert.ok(!names.includes("person_relationships_a_label"));
      assert.ok(!names.includes("person_relationships_b_label"));

      await client.query(
        `INSERT INTO person_relationships
           (id, person_a, person_b, kind, a_calls_b, b_calls_a, sources)
         VALUES
           ('ada-alpha--cy-gamma--parent-child', 'ada-alpha', 'cy-gamma', 'parent_child', 'Neighbor', 'Roommate', '[]'::jsonb)`,
      );
      await client.query(
        `INSERT INTO person_events (person_id, kind, seq, event_date) VALUES
           ('ada-alpha', 'resignations', 0, '2020-01-02'),
           ('ada-alpha', 'notable', 0, '2021-06-01'),
           ('ada-alpha', 'notable', 1, '2022-07-03')`,
      );

      const again = await bootSubscriber(client);
      assert.equal(again.result.subscriber, true);
      names = await constraintNames(client);
      for (const required of [
        "person_relationships_kind",
        "person_relationships_start_year",
        "person_relationships_end_year",
        "person_relationships_year_order",
        "person_relationships_a_note_len",
        "person_relationships_b_note_len",
        "person_relationships_pair_order",
        "person_relationships_pair_kind",
      ]) {
        assert.ok(names.includes(required), required);
      }
      assert.ok(!names.includes("person_relationships_a_label"));
      assert.ok(!names.includes("person_relationships_b_label"));
      const rels = await client.query(
        `SELECT id, a_calls_b, b_calls_a FROM person_relationships ORDER BY id`,
      );
      assert.deepEqual(
        rels.rows.map((row) => [row.id, row.a_calls_b, row.b_calls_a]),
        [
          ["ada-alpha--bea-beta--professional", "Former organizer", "Candidate"],
          ["ada-alpha--cy-gamma--parent-child", "Neighbor", "Roommate"],
        ],
      );
      const events = await client.query(
        `SELECT kind, seq::int AS seq FROM person_events WHERE person_id = 'ada-alpha' ORDER BY kind, seq`,
      );
      assert.deepEqual(
        events.rows.map((row) => [row.kind, row.seq]),
        [
          ["notable", 0],
          ["notable", 1],
          ["resignations", 0],
        ],
      );

      const third = await bootSubscriber(client);
      assert.equal(third.result.subscriber, true);
      assert.equal(third.result.imported, null);
      assert.equal(third.result.migrated, null);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM person_relationships`)).rows[0].n, 2);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM person_events`)).rows[0].n, 3);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM people`)).rows[0].n, 3);

      for (const sql of [READD_A_LABEL, READD_B_LABEL]) {
        let failed = null;
        try {
          await client.query("BEGIN");
          await client.query(sql);
        } catch (err) {
          failed = err;
        } finally {
          await client.query("ROLLBACK");
        }
        assert.equal(failed && failed.code, "23514", sql);
      }
      const still = await client.query(
        `SELECT a_calls_b, b_calls_a FROM person_relationships WHERE id = 'ada-alpha--cy-gamma--parent-child'`,
      );
      assert.equal(still.rows[0].a_calls_b, "Neighbor");
      assert.equal(still.rows[0].b_calls_a, "Roommate");
      names = await constraintNames(client);
      assert.ok(!names.includes("person_relationships_a_label"));
      assert.ok(!names.includes("person_relationships_b_label"));
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM people`)).rows[0].n, 3);
    } finally {
      await client.end();
    }
  },
);
