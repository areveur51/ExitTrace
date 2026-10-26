/**
 * Worf r4 MED-1: the ET_SCRATCH_PG_URL guard (tests/scratch-pg.mjs) used by
 * bootstrap-stripped-pg and multi-event-pg. No database: parse, env and
 * post-connect identity checks only (the identity check runs on a fake client).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertScratchIdentity, routingPgEnv, ScratchPgRefused, scratchPgConfig, scratchPgTarget } from "./scratch-pg.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OK = "postgresql://127.0.0.1:56454/postgres";
const refused = (url, env = {}, re = /ET_SCRATCH_PG_URL refused/) =>
  assert.throws(() => scratchPgTarget(url, env), (err) => err instanceof ScratchPgRefused && re.test(err.message), url);

test("scratch-pg refuses a query string or fragment (pg honours ?host=, ?hostaddr=, ?port=, ?service= over the URL host)", () => {
  for (const q of ["?host=db.example.invalid", "?hostaddr=192.0.2.10", "?port=6543", "?service=render", "?sslmode=disable", "?", "?options=-c%20search_path%3Dx"]) {
    refused(`${OK}${q}`, {}, /query string/);
  }
  for (const h of ["#x", "#", "#?host=db.example.invalid"]) refused(`${OK}${h}`, {}, /fragment|query/);
  refused("postgresql://127.0.0.1:56454/postgres?host=/var/run/postgresql", {}, /query string/);
});

test("scratch-pg refuses a user or password in the URL, a non-loopback host, a bad port or path, and exittrace", () => {
  refused("postgresql://postgres@127.0.0.1:5432/postgres", {}, /no user or password/);
  refused("postgresql://postgres:x@127.0.0.1:5432/postgres", {}, /no user or password/);
  refused("postgresql://:x@127.0.0.1:5432/postgres", {}, /no user or password/);
  for (const host of ["db.example.invalid", "0.0.0.0", "127.0.0.2", "198.51.100.1", "[::]", "[::ffff:198.51.100.1]", "localhost.example.invalid", ""]) {
    refused(`postgresql://${host}:5432/postgres`, {}, /host must be|not a URL|path/);
  }
  refused("postgresql://127.0.0.1:0/postgres", {}, /port|not a URL/);
  refused("postgresql://127.0.0.1:99999/postgres", {}, /port|not a URL/);
  refused("http://127.0.0.1:5432/postgres", {}, /scheme/);
  refused("postgresql://127.0.0.1:5432", {}, /path|database/);
  refused("postgresql://127.0.0.1:5432/", {}, /database/);
  refused("postgresql://127.0.0.1:5432/a/b", {}, /path/);
  refused("postgresql://127.0.0.1:5432/a%20b", {}, /database/);
  refused("postgresql://127.0.0.1:5432/exittrace", {}, /exittrace/);
  refused("postgresql://127.0.0.1:5432/ExitTrace_lab", {}, /exittrace/);
  refused("", {}, /unset/);
  refused(undefined, {}, /unset/);
  refused(OK, { ET_SCRATCH_PG_USER: "postgres; drop" }, /role name/);
});

test("scratch-pg refuses any routing PG* env (PGHOST, PGHOSTADDR, PGPORT, PGSERVICE, PGSERVICEFILE, PGDATABASE, ...)", () => {
  for (const k of ["PGHOST", "PGHOSTADDR", "PGPORT", "PGSERVICE", "PGSERVICEFILE", "PGDATABASE", "PGUSER", "PGOPTIONS", "PGSSLMODE", "PGTARGETSESSIONATTRS"]) {
    refused(OK, { [k]: "1" }, new RegExp(`PG\\* environment is set \\(${k}\\)`));
  }
  assert.deepEqual(routingPgEnv({ PGPASSWORD: "x", PGPASSFILE: "/dev/null", PGHOST: "", HOME: "/h" }), []);
  assert.deepEqual(routingPgEnv({ PGPORT: "1", PGHOST: "h" }), ["PGHOST", "PGPORT"]);
});

test("scratch-pg builds explicit pg fields (no connectionString) from a plain loopback URL", () => {
  const t = scratchPgTarget(OK, { PGPASSWORD: "x" });
  assert.deepEqual({ ...t }, { host: "127.0.0.1", port: 56454, database: "postgres", user: "postgres" });
  const cfg = scratchPgConfig(t, "et_multi_event_1_2_lab", { PGPASSWORD: "x" });
  assert.deepEqual(Object.keys(cfg).sort(), ["database", "host", "password", "port", "ssl", "user"]);
  assert.equal(cfg.database, "et_multi_event_1_2_lab");
  assert.equal(cfg.ssl, false);
  assert.equal(Object.hasOwn(scratchPgConfig(t, undefined, {}), "password"), false);
  assert.throws(() => scratchPgConfig(t, "exittrace", {}), ScratchPgRefused);
  assert.equal(scratchPgTarget("postgres://localhost/et_scratch", {}).port, 5432);
  assert.equal(scratchPgTarget("postgresql://[::1]:5433/et_scratch", { ET_SCRATCH_PG_USER: "ci" }).host, "::1");
  assert.equal(scratchPgTarget("postgresql://[::1]:5433/et_scratch", { ET_SCRATCH_PG_USER: "ci" }).user, "ci");
});

const fakeClient = (row) => ({ query: async () => ({ rows: [row] }) });

test("scratch-pg checks identity after connect: loopback address, the URL's port, the database asked for", async () => {
  const t = scratchPgTarget(OK, {});
  const good = { addr: "127.0.0.1", port: 56454, setting_port: 5432, db: "postgres" };
  await assertScratchIdentity(fakeClient(good), t);
  await assertScratchIdentity(fakeClient({ ...good, addr: "::1" }), t);
  await assertScratchIdentity(fakeClient({ addr: null, port: null, setting_port: 56454, db: "postgres" }), t);
  await assertScratchIdentity(fakeClient({ ...good, db: "et_x_lab" }), t, "et_x_lab");
  const bad = async (row, re, db) => assert.rejects(assertScratchIdentity(fakeClient(row), t, db), (e) => e instanceof ScratchPgRefused && re.test(e.message));
  await bad({ ...good, addr: "203.0.113.3" }, /not loopback/);
  await bad({ ...good, addr: "192.0.2.7" }, /not loopback/);
  await bad({ ...good, port: 5432 }, /port 5432 is not 56454/);
  await bad({ addr: null, port: null, setting_port: 5432, db: "postgres" }, /port 5432 is not 56454/);
  await bad({ ...good, db: "exittrace" }, /database exittrace is not postgres/);
  await bad({ ...good, db: "postgres" }, /is not et_x_lab/, "et_x_lab");
});

test("both real-Postgres tests use the shared guard, never connectionString or a hostname-only check", () => {
  for (const f of ["tests/bootstrap-stripped-pg.test.mjs", "tests/multi-event-pg.test.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.match(src, /from "\.\/scratch-pg\.mjs"/, f);
    assert.match(src, /connectScratch\(/, f);
    assert.doesNotMatch(src, /connectionString|new pg\.Client|\.hostname\b|from "pg"/, f);
  }
});
