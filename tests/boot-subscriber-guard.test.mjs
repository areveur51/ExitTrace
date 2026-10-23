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
  failClosed,
  guardReplicatedWrites,
  isLogicalSubscriberDb,
  isRowWriteSql,
  skipLine,
  stripBootDataWrites,
} from "../app/lib/boot-guard.mjs";
import { healLogicalApply } from "../app/lib/store.mjs";

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
  const ran = { ensureSchema: [], heal: 0, healArgs: [], importSeed: 0, migrateUniquePeople: 0 };
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
      healLogicalApply: async (args) => {
        ran.heal += 1;
        ran.healArgs.push(args);
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
  assert.deepEqual(ran.healArgs, [{ subscriber: true }], "heal gets the one boot flag, not its own probe");
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
  assert.deepEqual(ctx.ran.healArgs, [{ subscriber: false }]);
  assert.deepEqual(pool.calls, [SUBSCRIBER_COUNT_SQL], "one subscriber probe per boot");
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
  // No marker may sit inside a DO $$ ... $$ body: stripping would cut the block in half.
  const lines = BOOTSTRAP.split("\n");
  let dollar = 0;
  lines.forEach((line, i) => {
    if (line.startsWith("-- @boot-data-write")) {
      assert.equal(dollar % 2, 0, `marker at line ${i + 1} is inside a $$ block`);
    }
    dollar += (line.replace(/--.*$/, "").match(/\$\$/g) || []).length;
  });
  assert.throws(() => stripBootDataWrites("-- @boot-data-write end\n-- @boot-data-write begin\n"), /misplaced/);
});

test("server boot() goes through the guard; logical_heal takes the flag and has no et_meta stamp", () => {
  const server = fs.readFileSync(path.join(ROOT, "app", "server.mjs"), "utf8");
  const boot = server.slice(server.indexOf("async function boot()"));
  const body = boot.slice(0, boot.indexOf("\n}\n"));
  assert.match(body, /bootDatabase\(pool,/);
  assert.doesNotMatch(body, /await importSeed\(|await migrateUniquePeople\(|await ensureSchema\(/);

  const store = fs.readFileSync(path.join(ROOT, "app", "lib", "store.mjs"), "utf8");
  const fn = store.slice(store.indexOf("export async function healLogicalApply"));
  const heal = fn.slice(0, fn.indexOf("\nexport async function ", 1));
  assert.match(heal, /export async function healLogicalApply\(\{ subscriber/);
  assert.doesNotMatch(heal, /isLogicalSubscriberDb\(/, "no second per-DB probe inside heal");
  assert.doesNotMatch(heal, /keep_up\.logical\.last_heal|upsertEtMeta\(/, "dead et_meta stamp removed");
  assert.doesNotMatch(heal, /gap-upsert|upsertGap|runGapUpsert/i, "heal never calls the gap upsert writer");
  assert.match(heal, /guardReplicatedWrites\(rawPool, true/);
});

test("failClosed is the one fail-closed log line", () => {
  assert.equal(
    failClosed("has no pool"),
    "[exittrace] boot: subscriber check has no pool; failing closed, boot writes to replicated tables skipped",
  );
  const bg = fs.readFileSync(path.join(ROOT, "app", "lib", "boot-guard.mjs"), "utf8");
  assert.equal(bg.split("failing closed, boot writes to replicated tables skipped").length - 1, 1);
});

test("isRowWriteSql: row writes yes, DDL / reads / subscription management no", () => {
  for (const sql of [
    "INSERT INTO people (id) VALUES ($1)",
    "  update dog_comms SET text = 'x'",
    "DELETE FROM central_casting_comms WHERE person_id IS NULL",
    "TRUNCATE et_meta",
    "WITH x AS (SELECT 1) INSERT INTO et_meta (k, v) SELECT 'a', '{}'::jsonb",
    "MERGE INTO people p USING s ON true WHEN MATCHED THEN DO NOTHING",
    "COPY people FROM STDIN",
  ]) {
    assert.equal(isRowWriteSql(sql), true, sql);
  }
  for (const sql of [
    "SELECT count(*) FROM people",
    "ALTER TABLE dog_comms ALTER COLUMN posted_at TYPE TEXT USING to_char(posted_at, 'YYYY-MM-DD')",
    "ALTER SUBSCRIPTION exittrace_lab_sub ENABLE",
    "SELECT subenabled FROM pg_subscription WHERE subname = 'exittrace_lab_sub'",
  ]) {
    assert.equal(isRowWriteSql(sql), false, sql);
  }
});

test("guardReplicatedWrites refuses row writes unless subscriber is exactly false", async () => {
  const seen = [];
  const inner = { async query(sql) { seen.push(sql); return { rows: [] }; } };
  const lines = [];
  for (const flag of [true, undefined, null]) {
    const g = guardReplicatedWrites(inner, flag, { label: "gap upsert", log: (l) => lines.push(l) });
    await assert.rejects(g.query("INSERT INTO people (id) VALUES ('x') ON CONFLICT (id) DO NOTHING"), {
      code: "subscriber_write_refused",
    });
    await g.query("SELECT 1");
  }
  assert.deepEqual(seen, ["SELECT 1", "SELECT 1", "SELECT 1"], "no write reached the pool");
  assert.ok(lines.every((l) => l === skipLine("gap upsert")));
  assert.equal(guardReplicatedWrites(inner, false), inner, "publisher pool is untouched");
});

/** Fake subscriber DB for healLogicalApply. Records every statement. */
function healPool({ postedAt = "text", enabled = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (/information_schema\.columns/.test(sql)) return { rows: [{ data_type: postedAt }] };
      if (/pg_stat_subscription_stats/.test(sql)) return { rows: [{ apply_error_count: 216536 }] };
      if (/subenabled FROM pg_subscription/.test(sql)) return { rows: [{ subenabled: enabled }] };
      if (/AS warren/.test(sql)) return { rows: [{ people: 3, dog_comms: 2, operations: 1, warren: 0 }] };
      if (/^\s*ALTER /.test(sql)) return { rows: [] };
      if (/EXISTS \(SELECT 1 FROM pg_subscription\)/.test(sql)) return { rows: [{ present: true }] };
      throw new Error(`unexpected heal query: ${sql.slice(0, 60)}`);
    },
  };
}

// Test-only arm of the heal gate, restored in finally. Not a committed default
// (live-sync-gate.test.mjs scans the repo for one).
const HEAL_ARMED = "on";

async function withHealOn(fn) {
  const saved = process.env.ET_LOGICAL_HEAL;
  const savedLog = console.log;
  const lines = [];
  process.env.ET_LOGICAL_HEAL = HEAL_ARMED;
  console.log = (...a) => lines.push(a.map(String).join(" "));
  try {
    return await fn(lines);
  } finally {
    console.log = savedLog;
    if (saved === undefined) delete process.env.ET_LOGICAL_HEAL;
    else process.env.ET_LOGICAL_HEAL = saved;
  }
}

test("healLogicalApply on a subscriber: uses the flag, no probe, no gap-upsert or other row write", async () => {
  await withHealOn(async () => {
    for (const opts of [{ postedAt: "text", enabled: true }, { postedAt: "date", enabled: false }]) {
      const pool = healPool(opts);
      const out = await healLogicalApply({ subscriber: true, pool });
      assert.equal(out.ok, true, out.reason);
      assert.equal(out.gap_upserted, false);
      assert.ok(!pool.calls.some((q) => /EXISTS \(SELECT 1 FROM pg_subscription\)/.test(q)), "flag replaces the probe");
      assert.ok(!pool.calls.some((q) => /isLogicalSubscriberDb|subdbid/.test(q)), "no per-DB re-probe");
      for (const q of pool.calls) {
        assert.equal(isRowWriteSql(q), false, `row write on a subscriber: ${q.slice(0, 60)}`);
        assert.doesNotMatch(q, /et_meta/);
      }
      assert.equal(out.bounced, !opts.enabled, "subscription management still runs");
    }
  });
});

test("the heal pool guard stops a gap-upsert row write before it reaches the database", async () => {
  const inner = healPool();
  const attempted = [];
  const pool = {
    async query(sql) {
      attempted.push(sql);
      return inner.query(sql);
    },
  };
  // A pool whose counts query is swapped for a write simulates a future gap upsert inside heal.
  const writing = {
    async query(sql) {
      if (/AS warren/.test(sql)) return pool.query("INSERT INTO people (id) VALUES ('gap') ON CONFLICT (id) DO NOTHING");
      return pool.query(sql);
    },
  };
  await withHealOn(async (lines) => {
    const guarded = guardReplicatedWrites(writing, true, { label: "logical_heal row write (gap upsert)", log: (l) => lines.push(l) });
    await assert.rejects(guarded.query("INSERT INTO people (id) VALUES ('gap')"), { code: "subscriber_write_refused" });
    assert.ok(!attempted.some((q) => isRowWriteSql(q)), "the write never reached the database");
  });
});

test("healLogicalApply: subscriber false is a no-op with no query; undefined falls back to the probe", async () => {
  await withHealOn(async () => {
    const pub = healPool();
    const out = await healLogicalApply({ subscriber: false, pool: pub });
    assert.equal(out.reason, "no_subscription");
    assert.deepEqual(pub.calls, []);

    const legacy = healPool();
    const out2 = await healLogicalApply({ pool: legacy });
    assert.equal(out2.ok, true);
    assert.match(legacy.calls[0], /EXISTS \(SELECT 1 FROM pg_subscription\)/);
    assert.ok(!legacy.calls.some((q) => isRowWriteSql(q)));
  });
});
