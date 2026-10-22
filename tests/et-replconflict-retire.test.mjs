import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  run,
  SQL,
  insertRetiredSql,
  sanitize,
  RETIRED_TABLE,
  UsageError,
} from "../scripts/ops/et-replconflict-retire.mjs";
import {
  parseArgs as parseSnapArgs,
  snapshot,
  SNAPSHOT_SQL,
} from "../scripts/ops/et-replslot-snapshot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RETIRE_SRC = fs.readFileSync(path.join(HERE, "../scripts/ops/et-replconflict-retire.mjs"), "utf8");
const SNAP_SRC = fs.readFileSync(path.join(HERE, "../scripts/ops/et-replslot-snapshot.mjs"), "utf8");
const COLS = ["person_id", "kind", "event_date", "sources", "comments"];

function fakeClient({ sub = true, keyRows = 1, insRows = 1, delRows = 1, lockRows = 1 } = {}) {
  const calls = [];
  let errCount = 100;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === SQL.subStatus) {
        errCount += 1;
        return { rows: sub ? [{ subname: "exittrace_lab_sub", subenabled: true, latest_end_lsn: "1/C71E0E38", apply_error_count: String(errCount) }] : [] };
      }
      if (sql === SQL.counts) return { rows: [{ key_rows: keyRows, person_event_rows: 1, people_rows: 1, person_events_total: 10, retired_table_exists: false }] };
      if (sql === SQL.retiredCount) return { rows: [{ n: 1 }] };
      if (sql === SQL.columns) return { rows: COLS.map((column_name) => ({ column_name })) };
      if (sql === SQL.rowJson) return { rows: keyRows ? [{ j: { person_id: "fan-yang", kind: "indictment_civilian", event_date: "2026-09-15" } }] : [] };
      if (sql === SQL.lockRow) return { rows: [], rowCount: lockRows };
      if (sql.startsWith("INSERT INTO public." + RETIRED_TABLE)) return { rows: [], rowCount: insRows };
      if (sql === SQL.deleteKey) return { rows: [], rowCount: delRows };
      return { rows: [], rowCount: 0 };
    },
  };
}
const quiet = { log: () => {}, sleep: async () => {} };
const writes = (calls) => calls.filter((c) => /^(BEGIN|CREATE|INSERT|DELETE|COMMIT)/.test(c.sql.trim()));

test("parseArgs: dry-run is the default; one key; strict patterns", () => {
  const a = parseArgs(["fan-yang", "indictment_civilian"]);
  assert.equal(a.mode, "dry-run");
  assert.equal(parseArgs(["fan-yang", "indictment_civilian", "--apply", "--lab-lsn=1/C71E1358"]).mode, "apply");
  assert.throws(() => parseArgs(["fan-yang"]), UsageError);
  assert.throws(() => parseArgs(["a", "b", "c"]), UsageError);
  assert.throws(() => parseArgs(["fan-yang", "x", "--apply", "--dry-run"]), UsageError);
  assert.throws(() => parseArgs(["fan-yang'; --", "indictment_civilian"]), UsageError);
  assert.throws(() => parseArgs(["fan-yang", "kind;DROP"]), UsageError);
  assert.throws(() => parseArgs(["fan-yang", "k", "--lab-lsn=nope"]), UsageError);
  assert.throws(() => parseArgs(["fan-yang", "k", "--force"]), UsageError);
});

test("dry-run issues no writes", async () => {
  const c = fakeClient();
  const code = await run(c, parseArgs(["fan-yang", "indictment_civilian"]), quiet);
  assert.equal(code, 0);
  assert.deepEqual(writes(c.calls), []);
});

test("refuses when the database has no exittrace_lab_sub (lab publisher)", async () => {
  const c = fakeClient({ sub: false });
  const code = await run(c, parseArgs(["fan-yang", "indictment_civilian", "--apply"]), quiet);
  assert.equal(code, 3);
  assert.deepEqual(writes(c.calls), []);
});

test("apply refuses when the key is absent", async () => {
  const c = fakeClient({ keyRows: 0 });
  const code = await run(c, parseArgs(["fan-yang", "indictment_civilian", "--apply"]), quiet);
  assert.equal(code, 4);
  assert.deepEqual(writes(c.calls), []);
});

test("apply happy path: one transaction, parameterized, status before and after", async () => {
  const c = fakeClient();
  const code = await run(c, parseArgs(["fan-yang", "indictment_civilian", "--apply", "--lab-lsn=1/C71E1358"]), quiet);
  assert.equal(code, 0);
  const seq = c.calls.map((x) => x.sql.trim().split(/\s+/)[0]);
  const b = seq.indexOf("BEGIN");
  assert.deepEqual(seq.slice(b, b + 6), ["BEGIN", "SELECT", "CREATE", "INSERT", "DELETE", "COMMIT"]);
  const del = c.calls.find((x) => x.sql === SQL.deleteKey);
  assert.deepEqual(del.params, ["fan-yang", "indictment_civilian"]);
  const ins = c.calls.find((x) => x.sql.startsWith("INSERT"));
  assert.deepEqual(ins.params, ["fan-yang", "indictment_civilian", "1/C71E1358"]);
  assert.equal(c.calls.filter((x) => x.sql === SQL.subStatus).length, 2);
  assert.ok(!c.calls.some((x) => x.sql === "ROLLBACK"));
});

for (const [name, opts] of [
  ["delete rowCount 0", { delRows: 0 }],
  ["delete rowCount 2", { delRows: 2 }],
  ["insert rowCount 0", { insRows: 0 }],
  ["lock rowCount 0", { lockRows: 0 }],
]) {
  test(`apply rolls back on ${name}`, async () => {
    const c = fakeClient(opts);
    const code = await run(c, parseArgs(["fan-yang", "indictment_civilian", "--apply"]), quiet);
    assert.equal(code, 5);
    assert.ok(c.calls.some((x) => x.sql === "ROLLBACK"));
    assert.ok(!c.calls.some((x) => x.sql === "COMMIT"));
  });
}

test("retire table DDL and insert shape", () => {
  assert.match(SQL.createRetired, /CREATE TABLE IF NOT EXISTS public\.person_events_replconflict_retired_20261022/);
  assert.match(SQL.createRetired, /LIKE public\.person_events INCLUDING DEFAULTS/);
  assert.match(SQL.createRetired, /retired_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(SQL.createRetired, /lab_lsn text/);
  assert.throws(() => insertRetiredSql(["ok", "bad;col"]));
  assert.match(insertRetiredSql(COLS), /WHERE person_id = \$1 AND kind = \$2$/);
});

test("source guard: one DELETE, no subscription/publication verbs, no DROP/TRUNCATE, no URL printing", () => {
  const code = RETIRE_SRC.replace(/\/\*\*[\s\S]*?\*\//, "");
  assert.equal((code.match(/DELETE FROM/g) || []).length, 1);
  for (const bad of [/ALTER\s+SUBSCRIPTION/i, /ALTER\s+PUBLICATION/i, /\bSKIP\b/, /\bDROP\b/i, /\bTRUNCATE\b/i, /pg_replication_origin/i, /child_process/, /psql/]) {
    assert.doesNotMatch(code, bad);
  }
  assert.doesNotMatch(code, /log\([^)]*DATABASE_URL/);
  assert.doesNotMatch(code, /console\.(log|error)\([^)]*\burl\b/);
});

test("sanitize strips connection strings", () => {
  assert.equal(sanitize("bad postgres://u:p@h/db x"), "bad [redacted-url] x");
  assert.equal(sanitize("password=hunter2 rest"), "password=[redacted] rest");
});

test("lab snapshot helper is read-only", async () => {
  assert.deepEqual(parseSnapArgs(["--label=before", "--past-lsn=1/C71E1358"]), { label: "before", pastLsn: "1/C71E1358" });
  assert.throws(() => parseSnapArgs(["--past-lsn=x"]));
  assert.throws(() => parseSnapArgs(["--label=a b"]));
  const calls = [];
  const client = { async query(sql, params) { calls.push(sql); return { rows: sql === SNAPSHOT_SQL ? [{ slot_name: "exittrace_lab_sub", lag_bytes: "1" }] : [] }; } };
  const out = await snapshot(client, { label: "before", pastLsn: null });
  assert.equal(out.slot.slot_name, "exittrace_lab_sub");
  assert.deepEqual(calls, ["BEGIN READ ONLY", SNAPSHOT_SQL, "ROLLBACK"]);
  const code = SNAP_SRC.replace(/\/\*\*[\s\S]*?\*\//, "");
  for (const bad of [/\bINSERT\b/, /\bUPDATE\b/, /\bDELETE\b/, /\bALTER\b/, /\bDROP\b/, /\bCREATE\b/, /pg_logical_slot/i]) {
    assert.doesNotMatch(code, bad);
  }
});
