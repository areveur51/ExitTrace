/**
 * Worf: on a logical-replication SUBSCRIBER (pg_subscription non-empty) every
 * boot writer to a replicated table skips itself. Fail closed when the check
 * errors. A publisher (lab, count 0) keeps its current boot writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SUBSCRIBER_COUNT_SQL,
  SUBSCRIBER_STAT_FALLBACK_SQL,
  bootDatabase,
  isLogicalSubscriberDb,
  skipLine,
  stripBootDataWrites,
} from "../app/lib/boot-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
const DML = /\b(INSERT\s+INTO|UPDATE\s+\w+(?:\s+AS\s+\w+)?\s+SET|DELETE\s+FROM|TRUNCATE)\b/i;

function executableSql(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function pgError(code, message = "boom") {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Fake pg pool. `sub` / `stat` are a count or an Error to throw. */
function fakePool({ sub = 0, stat = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      const value = sql === SUBSCRIBER_COUNT_SQL ? sub : sql === SUBSCRIBER_STAT_FALLBACK_SQL ? stat : null;
      if (value === null) throw new Error(`unexpected query: ${sql.slice(0, 40)}`);
      if (value instanceof Error) throw value;
      if (value === "empty") return { rows: [] };
      return { rows: [{ n: value }] };
    },
  };
}

function bootDeps() {
  const ran = { ensureSchema: [], heal: 0, importSeed: 0, migrateUniquePeople: 0 };
  const lines = [];
  const errors = [];
  return {
    ran,
    lines,
    errors,
    deps: {
      bootstrapSql: BOOTSTRAP,
      seed: { people: [], dog_comms: [] },
      ensureSchema: async (_p, sql) => {
        ran.ensureSchema.push(sql);
      },
      healLogicalApply: async () => {
        ran.heal += 1;
        return { ok: true, reason: "heal_disabled", skipped: true };
      },
      importSeed: async () => {
        ran.importSeed += 1;
        return { people: 3, dog_comms: 2, operations: 1 };
      },
      migrateUniquePeople: async () => {
        ran.migrateUniquePeople += 1;
        return { people: 3, merged: 0 };
      },
      log: (...args) => lines.push(args.map(String).join(" ")),
      logError: (...args) => errors.push(args.map(String).join(" ")),
    },
  };
}

function assertSkipped({ ran, lines }, result) {
  assert.equal(result.subscriber, true);
  assert.equal(ran.importSeed, 0);
  assert.equal(ran.migrateUniquePeople, 0);
  assert.equal(ran.ensureSchema.length, 1);
  assert.doesNotMatch(executableSql(ran.ensureSchema[0]), DML);
  assert.match(ran.ensureSchema[0], /CREATE TABLE IF NOT EXISTS person_events/);
  assert.equal(ran.heal, 1, "logical_heal still runs: it manages the subscription");
  assert.ok(lines.includes(skipLine("importSeed")));
  assert.ok(lines.includes(skipLine("migrateUniquePeople")));
  assert.ok(lines.includes(skipLine("bootstrap row backfills (@boot-data-write sections)")));
  assert.equal(lines.filter((l) => l === skipLine("migrateUniquePeople")).length, 1);
}

test("subscriber (pg_subscription count > 0) skips every boot writer", async () => {
  const pool = fakePool({ sub: 1 });
  const ctx = bootDeps();
  const result = await bootDatabase(pool, ctx.deps);
  assertSkipped(ctx, result);
  assert.deepEqual(pool.calls, [SUBSCRIBER_COUNT_SQL]);
  assert.ok(ctx.lines.some((l) => /subscriber DB \(subscriptions=1\)/.test(l)));
  assert.match(skipLine("migrateUniquePeople"), /^\[exittrace\] boot: subscriber DB, skipping migrateUniquePeople$/);
});

test("publisher (count 0) runs every boot writer with the full bootstrap SQL", async () => {
  const pool = fakePool({ sub: 0 });
  const ctx = bootDeps();
  const result = await bootDatabase(pool, ctx.deps);
  assert.equal(result.subscriber, false);
  assert.equal(ctx.ran.importSeed, 1);
  assert.equal(ctx.ran.migrateUniquePeople, 1);
  assert.equal(ctx.ran.heal, 1);
  assert.deepEqual(ctx.ran.ensureSchema, [BOOTSTRAP], "lab runs the bootstrap SQL unchanged");
  assert.ok(!ctx.lines.some((l) => /skipping/.test(l)));
  assert.ok(ctx.lines.includes("[exittrace] postgres people=3 dog_comms=2 operations=1 unique=3"));
});

test("the check throwing skips the writers (fail closed) and logs no message text", async () => {
  for (const err of [
    pgError("ECONNRESET", "read ECONNRESET postgres://u:s3cret@db.example/x"),
    pgError("57014", "canceling statement"),
    new Error("postgres://u:s3cret@db.example/x unreachable"),
  ]) {
    const ctx = bootDeps();
    const result = await bootDatabase(fakePool({ sub: err }), ctx.deps);
    assertSkipped(ctx, result);
    assert.ok(ctx.lines.some((l) => /subscriber check failed .*failing closed/.test(l)));
    for (const line of ctx.lines) {
      assert.doesNotMatch(line, /s3cret|postgres:\/\//);
    }
  }
});

test("a malformed count fails closed", async () => {
  const ctx = bootDeps();
  assertSkipped(ctx, await bootDatabase(fakePool({ sub: "empty" }), ctx.deps));
  assert.equal(await isLogicalSubscriberDb(null, { log() {} }), true);
});

test("permission denied on pg_subscription falls back to pg_stat_subscription", async () => {
  const denied = pgError("42501", "permission denied for table pg_subscription");
  const quiet = { log() {} };

  const pub = fakePool({ sub: denied, stat: 0 });
  assert.equal(await isLogicalSubscriberDb(pub, quiet), false);
  assert.deepEqual(pub.calls, [SUBSCRIBER_COUNT_SQL, SUBSCRIBER_STAT_FALLBACK_SQL]);

  assert.equal(await isLogicalSubscriberDb(fakePool({ sub: denied, stat: 2 }), quiet), true);
  assert.equal(
    await isLogicalSubscriberDb(fakePool({ sub: denied, stat: pgError("42501") }), quiet),
    true,
    "both catalogs denied: fail closed",
  );
  const ctx = bootDeps();
  assertSkipped(ctx, await bootDatabase(fakePool({ sub: denied, stat: denied }), ctx.deps));
});

test("the check never reads subconninfo (revoked from non-superusers)", () => {
  for (const sql of [SUBSCRIBER_COUNT_SQL, SUBSCRIBER_STAT_FALLBACK_SQL]) {
    assert.doesNotMatch(sql, /subconninfo|\*\s+FROM|SELECT\s+\*/i);
    assert.match(sql, /count\(\*\)/);
  }
  assert.match(SUBSCRIBER_COUNT_SQL, /current_database\(\)/);
});

test("bootstrap SQL: every row backfill is marked, DDL is kept", () => {
  assert.match(executableSql(BOOTSTRAP), DML, "publisher still runs the backfills");
  const stripped = stripBootDataWrites(BOOTSTRAP);
  assert.doesNotMatch(executableSql(stripped), DML, "an unmarked DML statement would run on the subscriber");
  for (const table of [
    "people",
    "person_events",
    "dog_comms",
    "central_casting_comms",
    "source_posts",
    "et_meta",
    "operations",
    "request_attributions",
    "epstein_flight_legs",
  ]) {
    assert.match(stripped, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
  }
  assert.match(stripped, /ADD COLUMN IF NOT EXISTS unsealed BOOLEAN/);
  assert.throws(() => stripBootDataWrites("-- @boot-data-write begin x\nUPDATE people SET a = 1;\n"), /unbalanced/);
  assert.throws(() => stripBootDataWrites("-- @boot-data-write end\n-- @boot-data-write begin\n"), /misplaced/);
});

test("server boot() goes through the guard; logical_heal guards its et_meta stamp", () => {
  const server = fs.readFileSync(path.join(ROOT, "app", "server.mjs"), "utf8");
  const boot = server.slice(server.indexOf("async function boot()"));
  const body = boot.slice(0, boot.indexOf("\n}\n"));
  assert.match(body, /bootDatabase\(pool,/);
  assert.doesNotMatch(body, /await importSeed\(|await migrateUniquePeople\(|await ensureSchema\(/);

  const store = fs.readFileSync(path.join(ROOT, "app", "lib", "store.mjs"), "utf8");
  const fn = store.slice(store.indexOf("export async function healLogicalApply"));
  const heal = fn.slice(0, fn.indexOf("\nexport async function ", 1));
  const guard = heal.indexOf("isLogicalSubscriberDb(p)");
  const stamp = heal.indexOf('upsertEtMeta("keep_up.logical.last_heal"');
  assert.ok(guard > -1 && stamp > guard, "et_meta stamp sits behind the subscriber guard");
  assert.match(heal, /skipLine\("logical_heal et_meta keep_up\.logical\.last_heal"\)/);
});
