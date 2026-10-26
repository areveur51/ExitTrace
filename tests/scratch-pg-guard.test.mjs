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
import { assertScratchIdentity, routingPgEnv, SCRATCH_IDENTITY_SQL, ScratchPgRefused, scratchPgConfig, scratchPgTarget } from "./scratch-pg.mjs";

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

const fakeClient = (row) => ({ sql: [], async query(text) { this.sql.push(text); return { rows: [row] }; } });
const CLEAN = { exittrace_dbs: 0, publications: 0, subscriptions: 0, slots: 0 };

test("scratch-pg checks identity after connect: loopback address, the URL's port, the database asked for", async () => {
  const t = scratchPgTarget(OK, {});
  const good = { addr: "127.0.0.1", port: 56454, db: "postgres", ...CLEAN };
  const c = fakeClient(good);
  await assertScratchIdentity(c, t);
  assert.deepEqual(c.sql, [SCRATCH_IDENTITY_SQL]);
  await assertScratchIdentity(fakeClient({ ...good, addr: "::1" }), t);
  await assertScratchIdentity(fakeClient({ ...good, addr: "127.0.0.5" }), t);
  await assertScratchIdentity(fakeClient({ ...good, db: "et_x_lab" }), t, "et_x_lab");
  const bad = async (row, re, db) => assert.rejects(assertScratchIdentity(fakeClient(row), t, db), (e) => e instanceof ScratchPgRefused && re.test(e.message), JSON.stringify(row));
  await bad({ ...good, addr: "203.0.113.3" }, /not loopback/);
  await bad({ ...good, addr: "192.0.2.7" }, /not loopback/);
  await bad({ ...good, addr: "172.19.0.2" }, /not loopback/);
  await bad({ ...good, port: 5432 }, /port 5432 is not 56454/);
  await bad({ ...good, db: "exittrace" }, /database exittrace is not postgres/);
  await bad({ ...good, db: "postgres" }, /is not et_x_lab/, "et_x_lab");
  // NIT-16: an empty or NULL server address (a unix socket) is refused; the config is always TCP.
  await bad({ ...good, addr: null, port: null }, /address is empty/);
  await bad({ ...good, addr: "", port: 56454 }, /address is empty/);
  await bad({ ...good, addr: undefined }, /address is empty/);
});

test("scratch-pg refuses a cluster that is not a throwaway: an exittrace database, a publication, a subscription or a slot (Worf r5 LOW-2)", async () => {
  const t = scratchPgTarget(OK, {});
  const good = { addr: "127.0.0.1", port: 56454, db: "postgres", ...CLEAN };
  const bad = async (extra, re) => assert.rejects(assertScratchIdentity(fakeClient({ ...good, ...extra }), t), (e) => e instanceof ScratchPgRefused && re.test(e.message), JSON.stringify(extra));
  await bad({ exittrace_dbs: 1 }, /database named like exittrace exists/);
  await bad({ publications: 1 }, /has a publication/);
  await bad({ subscriptions: 2 }, /has a subscription/);
  await bad({ slots: 1 }, /replication slot/);
  // Missing or non-integer counts fail closed.
  for (const k of Object.keys(CLEAN)) {
    await bad({ [k]: undefined }, /not a throwaway cluster/);
    await bad({ [k]: "0" }, /not a throwaway cluster/);
    await bad({ [k]: null }, /not a throwaway cluster/);
  }
  for (const re of [/FROM pg_database WHERE datname ILIKE '%exittrace%'/, /FROM pg_publication\)/, /FROM pg_subscription\)/, /FROM pg_replication_slots\)/, /host\(inet_server_addr\(\)\)/, /inet_server_port\(\)/, /current_database\(\)/]) {
    assert.match(SCRATCH_IDENTITY_SQL, re);
  }
});

test("scratch-pg keeps PGPASSWORD / PGPASSFILE for scratch credentials only, and never logs them (Worf r5 ruling)", () => {
  const src = fs.readFileSync(path.join(ROOT, "tests/scratch-pg.mjs"), "utf8");
  assert.match(src, /for SCRATCH credentials only\. Never set them to a\n\/\/ lab or Render credential/);
  assert.match(src, /Prefer PGPASSFILE \(mode 0600, path-only\)/);
  assert.match(src, /never logs\n\/\/ either one/);
  assert.doesNotMatch(src, /console\.|process\.stdout|process\.stderr/);
});

test("both real-Postgres tests use the shared guard, never connectionString or a hostname-only check", () => {
  for (const f of ["tests/bootstrap-stripped-pg.test.mjs", "tests/multi-event-pg.test.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.match(src, /from "\.\/scratch-pg\.mjs"/, f);
    assert.match(src, /connectScratch\(/, f);
    assert.doesNotMatch(src, /connectionString|new pg\.Client|\.hostname\b|from "pg"/, f);
  }
});
