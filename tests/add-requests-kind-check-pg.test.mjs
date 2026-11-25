/**
 * add_requests_kind_check widen (eagle, ronald, nickname) on the subscriber boot path.
 *
 * Public is a logical-replication subscriber. Its boot runs the server bootstrap SQL
 * (scripts/bootstrap-db.sql, mention-queue.sql, link-queue.sql, joined the way
 * app/server.mjs builds bootstrapSql) through bootDatabase, which applies
 * ensureSchema(stripBootDataWrites(sql)) and catches a failure. The DROP/ADD of
 * add_requests_kind_check must widen an existing 6-kind table, keep its rows, re-run
 * cleanly, and on a failed batch roll back to the old CHECK.
 *
 * app/server.mjs does not export bootstrapSql (importing it would boot the server and
 * read .env), so this file reads the same three files in the same order and joins
 * them the same way. The shape test pins that list against app/server.mjs.
 *
 * The shape test always runs. The Postgres tests skip unless ET_SCRATCH_PG_URL points
 * at a local throwaway cluster (tests/scratch-pg.mjs). Never lab, never Render.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SUBSCRIBER_COUNT_SQL, bootDatabase, stripBootDataWrites } from "../app/lib/boot-guard.mjs";
import { ensureSchema } from "../app/lib/store.mjs";
import { connectScratch, scratchPgTarget } from "./scratch-pg.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ENV = process.env.ET_SCRATCH_PG_URL || "";
const PG_SKIP = URL_ENV ? false : "ET_SCRATCH_PG_URL not set (needs a local throwaway Postgres)";

/** Same files, same order, same join as bootstrapSql in app/server.mjs. */
const SERVER_BOOT_FILES = Object.freeze(["bootstrap-db.sql", "mention-queue.sql", "link-queue.sql"]);
const SERVER_BOOT_SQL = SERVER_BOOT_FILES.map((file) =>
  fs.readFileSync(path.join(ROOT, "scripts", file), "utf8"),
).join("\n");

const OLD_KINDS = Object.freeze(["person", "dog", "operation", "red_folder", "boot", "central_casting"]);
const NEW_KINDS = Object.freeze(["eagle", "ronald", "nickname"]);
const ALL_KINDS = Object.freeze([...OLD_KINDS, ...NEW_KINDS]);
/** Appended after the bootstrap so the one schema batch fails late (22012). */
const FAIL_TAIL = "\nSELECT 1 / 0;\n";
const SCHEMA_FAILED = /subscriber schema failed/;

const kindListPattern = (kinds) => kinds.map((kind) => `.${kind}.`).join(", ");

function subscriberPool(client) {
  return {
    async query(sql, params) {
      if (sql === SUBSCRIBER_COUNT_SQL) return { rows: [{ n: 1 }] };
      return client.query(sql, params);
    },
  };
}

async function bootSubscriber(client, bootstrapSql = SERVER_BOOT_SQL) {
  const lines = [];
  const errors = [];
  const result = await bootDatabase(subscriberPool(client), {
    bootstrapSql,
    seed: { people: [], dog_comms: [] },
    ensureSchema,
    healLogicalApply: async () => ({ ok: true, reason: "heal_disabled", skipped: true }),
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

/** Every CHECK on add_requests whose definition mentions kind. */
async function kindChecks(client) {
  const r = await client.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.conrelid = to_regclass($1)
        AND c.contype = $2
        AND pg_get_constraintdef(c.oid) ILIKE $3
      ORDER BY c.conname`,
    ["public.add_requests", "c", "%kind%"],
  );
  return r.rows;
}

async function assertOneKindCheck(client, want, absent = []) {
  const rows = await kindChecks(client);
  assert.equal(rows.length, 1, `one kind CHECK, got ${rows.map((row) => row.conname).join(",")}`);
  assert.equal(rows[0].conname, "add_requests_kind_check");
  for (const kind of want) {
    assert.ok(rows[0].def.includes(`${client.escapeLiteral(kind)}::text`), `${kind} in ${rows[0].def}`);
  }
  for (const kind of absent) {
    assert.ok(!rows[0].def.includes(client.escapeLiteral(kind)), `${kind} not in ${rows[0].def}`);
  }
  return rows[0].def;
}

/** Empty public schema plus add_requests in its pre-widen shape (6-kind CHECK) and one person row. */
async function freshOldTable(target) {
  const client = await connectScratch(target);
  const lit = (value) => client.escapeLiteral(value);
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query(
    `CREATE TABLE add_requests (
       id TEXT PRIMARY KEY,
       kind TEXT NOT NULL CHECK (kind IN (${OLD_KINDS.map(lit).join(", ")})),
       status TEXT NOT NULL DEFAULT ${lit("pending")} CHECK (status IN (${["pending", "applied", "rejected"].map(lit).join(", ")})),
       subject TEXT,
       category TEXT,
       event_date DATE,
       hint_url TEXT,
       handle TEXT,
       source_url TEXT,
       posted_at DATE,
       cite_urls JSONB NOT NULL DEFAULT ${lit("[]")}::jsonb,
       payload JSONB NOT NULL DEFAULT ${lit("{}")}::jsonb,
       error TEXT,
       result JSONB,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       processed_at TIMESTAMPTZ
     )`,
  );
  await client.query("INSERT INTO add_requests (id, kind, subject) VALUES ($1, $2, $3)", [
    "ar-existing-person",
    "person",
    "Existing Person",
  ]);
  await assertOneKindCheck(client, OLD_KINDS, NEW_KINDS);
  return client;
}

async function requestIds(client) {
  const r = await client.query("SELECT id, kind FROM add_requests ORDER BY id");
  return r.rows.map((row) => [row.id, row.kind]);
}

const insertKind = (client, id, kind) =>
  client.query("INSERT INTO add_requests (id, kind) VALUES ($1, $2)", [id, kind]);

const isCheckViolation = (err) => err && err.code === "23514";

test("server bootstrapSql is bootstrap-db, mention-queue, link-queue; the 9-kind CHECK survives the subscriber strip", () => {
  const server = fs.readFileSync(path.join(ROOT, "app", "server.mjs"), "utf8");
  const start = server.indexOf("const bootstrapSql = [");
  assert.ok(start >= 0, "app/server.mjs builds bootstrapSql");
  const block = server.slice(start, server.indexOf(";", start) + 1);
  let at = 0;
  for (const file of SERVER_BOOT_FILES) {
    const next = block.indexOf(`"scripts", "${file}"`);
    assert.ok(next > at, `${file} is read in order`);
    at = next;
  }
  assert.equal(block.split("readFileSync(").length - 1, SERVER_BOOT_FILES.length);
  assert.match(block, /\]\.join\("\\n"\);$/);

  const stripped = stripBootDataWrites(SERVER_BOOT_SQL);
  assert.ok(stripped.includes("ALTER TABLE add_requests DROP CONSTRAINT IF EXISTS add_requests_kind_check;"));
  assert.match(
    stripped,
    new RegExp(`ADD CONSTRAINT add_requests_kind_check\\s+CHECK \\(kind IN \\(${kindListPattern(ALL_KINDS)}\\)\\);`),
  );
  const nine = new RegExp(`kind IN \\(${kindListPattern(ALL_KINDS)}\\)`, "g");
  assert.equal((stripped.match(nine) || []).length, 2, "CREATE TABLE and ADD CONSTRAINT both carry 9 kinds");
});

test(
  "subscriber boot widens a 6-kind add_requests_kind_check to 9 kinds, keeps rows, rejects unknown_kind, and re-runs",
  { skip: PG_SKIP, timeout: 120_000 },
  async () => {
    const client = await freshOldTable(scratchPgTarget(URL_ENV));
    try {
      const first = await bootSubscriber(client);
      assert.equal(first.result.subscriber, true);
      assert.equal(first.result.imported, null);
      assert.ok(first.lines.some((line) => /subscriber DB \(subscriptions=1\)/.test(line)));
      assert.ok(first.lines.some((line) => /skipping bootstrap row backfills/.test(line)));
      assert.ok(!first.errors.some((line) => SCHEMA_FAILED.test(line)), first.errors.join("\n"));
      const def = await assertOneKindCheck(client, ALL_KINDS);
      assert.deepEqual(await requestIds(client), [["ar-existing-person", "person"]]);

      for (const kind of ALL_KINDS) await insertKind(client, `ar-kind-${kind}`, kind);
      await assert.rejects(() => insertKind(client, "ar-kind-unknown", "unknown_kind"), isCheckViolation);
      const rows = await requestIds(client);
      assert.equal(rows.length, 1 + ALL_KINDS.length);

      const second = await bootSubscriber(client);
      assert.equal(second.result.subscriber, true);
      assert.ok(!second.errors.some((line) => SCHEMA_FAILED.test(line)), second.errors.join("\n"));
      assert.equal(await assertOneKindCheck(client, ALL_KINDS), def);
      assert.deepEqual(await requestIds(client), rows);
      await assert.rejects(() => insertKind(client, "ar-kind-unknown-2", "unknown_kind"), isCheckViolation);
    } finally {
      await client.end();
    }
  },
);

test(
  "a failed subscriber schema batch logs subscriber schema failed and keeps the 6-kind CHECK (rollback)",
  { skip: PG_SKIP, timeout: 120_000 },
  async () => {
    const client = await freshOldTable(scratchPgTarget(URL_ENV));
    try {
      const failed = await bootSubscriber(client, SERVER_BOOT_SQL + FAIL_TAIL);
      assert.equal(failed.result.subscriber, true);
      assert.ok(
        failed.errors.some((line) => /subscriber schema failed \(22012\); listening with the existing schema/.test(line)),
        failed.errors.join("\n"),
      );
      await assertOneKindCheck(client, OLD_KINDS, NEW_KINDS);
      await assert.rejects(() => insertKind(client, "ar-kind-eagle", "eagle"), isCheckViolation);
      const people = await client.query("SELECT to_regclass($1) IS NULL AS absent", ["public.people"]);
      assert.equal(people.rows[0].absent, true, "the whole batch rolled back, not only the CHECK");
      assert.deepEqual(await requestIds(client), [["ar-existing-person", "person"]]);
    } finally {
      await client.end();
    }
  },
);
