/**
 * person_relationships_a_label is a closed list of a_calls_b strings.
 * It is not a limit on how many relationship rows or events a card can have.
 * Subscriber boot drops it and does not add it again. Other relationship
 * checks stay, including person_relationships_b_label.
 *
 * The Postgres case uses ET_SCRATCH_PG_URL (tests/scratch-pg.mjs): a local
 * throwaway cluster only. Never lab, never Render.
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
  });
  return { result, lines };
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

test("subscriber bootstrap drops a_label and does not add that check", () => {
  const stripped = stripBootDataWrites(BOOTSTRAP);
  assert.match(stripped, /DROP CONSTRAINT IF EXISTS person_relationships_a_label/);
  assert.doesNotMatch(stripped, /ADD CONSTRAINT person_relationships_a_label/);
  assert.doesNotMatch(stripped, /CONSTRAINT person_relationships_a_label CHECK/);
  assert.match(stripped, /ADD CONSTRAINT person_relationships_b_label/);
  assert.match(stripped, /ADD CONSTRAINT person_relationships_kind/);
  assert.match(stripped, /ADD CONSTRAINT person_relationships_a_note_len/);
  assert.match(stripped, /ADD CONSTRAINT person_relationships_b_note_len/);
  assert.match(stripped, /person_relationships_pair_order/);
  assert.match(stripped, /person_relationships_pair_kind UNIQUE/);
  assert.doesNotMatch(stripped, /INSERT INTO person_relationships/i);
});

test(
  "populated subscriber boot drops a_label, keeps rows, events, and the other checks",
  { skip: URL_ENV ? false : "ET_SCRATCH_PG_URL not set (needs a local throwaway Postgres)", timeout: 120_000 },
  async () => {
    const client = await connectScratch(scratchPgTarget(URL_ENV));
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
        (await constraintNames(client)).filter((name) => name.includes("a_label")),
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
      assert.ok((await constraintNames(client)).includes("person_relationships_a_label"));

      const dropped = await bootSubscriber(client);
      assert.equal(dropped.result.subscriber, true);
      assert.ok(!(await constraintNames(client)).includes("person_relationships_a_label"));
      const kept = await client.query(
        `SELECT a_calls_b, b_calls_a FROM person_relationships WHERE id = 'ada-alpha--bea-beta--professional'`,
      );
      assert.equal(kept.rows[0].a_calls_b, "Former organizer");
      assert.equal(kept.rows[0].b_calls_a, "Candidate");

      await client.query(
        `INSERT INTO person_relationships
           (id, person_a, person_b, kind, a_calls_b, b_calls_a, sources)
         VALUES
           ('ada-alpha--cy-gamma--parent-child', 'ada-alpha', 'cy-gamma', 'parent_child', 'Neighbor', 'Son', '[]'::jsonb)`,
      );
      await client.query(
        `INSERT INTO person_events (person_id, kind, seq, event_date) VALUES
           ('ada-alpha', 'resignations', 0, '2020-01-02'),
           ('ada-alpha', 'notable', 0, '2021-06-01'),
           ('ada-alpha', 'notable', 1, '2022-07-03')`,
      );

      const again = await bootSubscriber(client);
      assert.equal(again.result.subscriber, true);
      const names = await constraintNames(client);
      for (const required of [
        "person_relationships_b_label",
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
      const rels = await client.query(
        `SELECT id, a_calls_b, b_calls_a FROM person_relationships ORDER BY id`,
      );
      assert.deepEqual(
        rels.rows.map((row) => [row.id, row.a_calls_b, row.b_calls_a]),
        [
          ["ada-alpha--bea-beta--professional", "Former organizer", "Candidate"],
          ["ada-alpha--cy-gamma--parent-child", "Neighbor", "Son"],
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
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM person_relationships`)).rows[0].n, 2);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM person_events`)).rows[0].n, 3);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM people`)).rows[0].n, 3);
      assert.equal((await constraintNames(client)).includes("person_relationships_a_label"), false);
      const bLabel = await client.query(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c
           JOIN pg_class r ON r.oid = c.conrelid
          WHERE r.relname = 'person_relationships' AND c.conname = 'person_relationships_b_label'`,
      );
      assert.match(bLabel.rows[0].def, /b_calls_a/);
      assert.match(bLabel.rows[0].def, /Former organizer/);
      assert.match(bLabel.rows[0].def, /Candidate/);
      assert.doesNotMatch(bLabel.rows[0].def, /a_calls_b/);

      let readdFailed = null;
      try {
        await client.query("BEGIN");
        await client.query(READD_A_LABEL);
      } catch (err) {
        readdFailed = err;
      } finally {
        await client.query("ROLLBACK");
      }
      assert.equal(readdFailed && readdFailed.code, "23514");
      const still = await client.query(
        `SELECT a_calls_b FROM person_relationships WHERE id = 'ada-alpha--cy-gamma--parent-child'`,
      );
      assert.equal(still.rows[0].a_calls_b, "Neighbor");
      assert.equal((await constraintNames(client)).includes("person_relationships_a_label"), false);
      const people = await client.query(`SELECT count(*)::int AS n FROM people`);
      assert.equal(people.rows[0].n, 3);
      assert.equal(third.result.migrated, null);
    } finally {
      await client.end();
    }
  },
);
