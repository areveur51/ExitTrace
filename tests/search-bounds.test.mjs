import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyServerTimeouts, handle, resetRateLimiter } from "../app/server.mjs";
import {
  SEARCH_Q_MAX,
  SEARCH_SQL_LIMIT,
  loadSeedFile,
  pgPoolConfig,
  searchKindComms,
  searchOperations,
  searchPeople,
  searchSourcePosts,
  setMemory,
  setPoolForTests,
} from "../app/lib/store.mjs";
import { KIND_COMM_IDS } from "../app/lib/kind-comms.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRGM = path.join(ROOT, "scripts/migrations/2026-10-23-search-trgm.sql");
const UNDO = path.join(ROOT, "scripts/migrations/2026-10-23-search-trgm-undo.sql");

const INDEX_NAMES = [
  "people_name_trgm",
  "people_role_trgm",
  "people_summary_trgm",
  "operations_name_trgm",
  "operations_summary_trgm",
  "dog_comms_handle_trgm",
  "dog_comms_account_name_trgm",
  "dog_comms_text_trgm",
  "red_folder_comms_handle_trgm",
  "red_folder_comms_account_name_trgm",
  "red_folder_comms_text_trgm",
  "eagle_comms_handle_trgm",
  "eagle_comms_account_name_trgm",
  "eagle_comms_text_trgm",
  "ronald_comms_handle_trgm",
  "ronald_comms_account_name_trgm",
  "ronald_comms_text_trgm",
  "shot_comms_handle_trgm",
  "shot_comms_account_name_trgm",
  "shot_comms_text_trgm",
  "source_posts_poster_handle_trgm",
  "source_posts_poster_name_trgm",
  "source_posts_text_trgm",
  "source_posts_source_url_trgm",
];

after(() => {
  setPoolForTests(null);
  resetRateLimiter();
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
});

function request(pathname, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: pathname,
      headers: { host: "127.0.0.1", "cf-connecting-ip": "198.51.100.10", ...headers },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const chunks = [];
    const res = {
      req,
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, hdrs) {
        this.statusCode = status;
        this.headersSent = true;
        this.headers = {};
        for (const [k, v] of Object.entries(hdrs || {})) {
          this.headers[String(k).toLowerCase()] = String(v);
        }
      },
      end(chunk) {
        if (chunk) chunks.push(chunk);
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("q longer than 64 renders blank search with no pool queries", async () => {
  const queries = [];
  setPoolForTests({
    query(sql, params) {
      queries.push({ sql, params });
      return Promise.resolve({ rows: [] });
    },
  });
  const q = "a".repeat(SEARCH_Q_MAX + 1);
  const res = await request(`/search?q=${q}`);
  assert.equal(res.status, 200);
  assert.match(res.body, /Type a name, role, handle, or stored post text/);
  assert.doesNotMatch(res.body, /No seeded rows match that query/);
  assert.equal(queries.length, 0);
});

test("each search* returns [] for q longer than 64", async () => {
  const q = "b".repeat(SEARCH_Q_MAX + 1);
  const queries = [];
  setPoolForTests({
    query(sql, params) {
      queries.push({ sql, params });
      return Promise.resolve({ rows: [] });
    },
  });
  assert.deepEqual(await searchPeople(q), []);
  assert.deepEqual(await searchOperations(q), []);
  assert.deepEqual(await searchSourcePosts(q), []);
  for (const id of KIND_COMM_IDS) {
    assert.deepEqual(await searchKindComms(id, q), []);
  }
  assert.equal(queries.length, 0);
  setPoolForTests(null);
});

test("search SQL uses LIMIT $2 bound to 200 and keeps ILIKE", async () => {
  const queries = [];
  setPoolForTests({
    query(sql, params) {
      queries.push({ sql, params });
      return Promise.resolve({ rows: [] });
    },
  });
  await searchPeople("ok");
  await searchOperations("ok");
  await searchSourcePosts("ok");
  for (const id of KIND_COMM_IDS) await searchKindComms(id, "ok");
  assert.ok(queries.length >= 4);
  for (const { sql, params } of queries) {
    assert.match(sql, /ILIKE/);
    assert.match(sql, /LIMIT \$2/);
    assert.equal(params[1], SEARCH_SQL_LIMIT);
    assert.equal(params[1], 200);
  }
  setPoolForTests(null);
});

test("memory fallback caps at 200", async () => {
  setPoolForTests(null);
  const people = Array.from({ length: 250 }, (_, i) => ({
    id: `p-cap-${i}`,
    category: "firings",
    name: `CapPerson ${String(i).padStart(3, "0")}`,
    role: "Test role",
    event_date: "2020-01-01",
    death_date: null,
    photo: "",
    sources: [],
    summary: "zzq memory cap",
    net_worth_usd: null,
  }));
  setMemory({ people, dog_comms: [], operations: [], source_posts: [] });
  const hits = await searchPeople("zzq");
  assert.equal(hits.length, 200);
});

test("pgPoolConfig defaults and env overrides", () => {
  const d = pgPoolConfig("postgres://example", {});
  assert.equal(d.connectionString, "postgres://example");
  assert.equal(d.max, 4);
  assert.equal(d.idleTimeoutMillis, 10_000);
  assert.equal(d.connectionTimeoutMillis, 5_000);
  assert.equal(d.statement_timeout, 8_000);

  const o = pgPoolConfig("postgres://example", {
    PG_POOL_MAX: "8",
    PG_CONNECT_TIMEOUT_MS: "1234",
    PG_STATEMENT_TIMEOUT_MS: "999",
  });
  assert.equal(o.max, 8);
  assert.equal(o.connectionTimeoutMillis, 1234);
  assert.equal(o.statement_timeout, 999);

  const bad = pgPoolConfig("postgres://example", {
    PG_POOL_MAX: "0",
    PG_CONNECT_TIMEOUT_MS: "nope",
    PG_STATEMENT_TIMEOUT_MS: "-3",
  });
  assert.equal(bad.max, 4);
  assert.equal(bad.connectionTimeoutMillis, 5_000);
  assert.equal(bad.statement_timeout, 8_000);
});

test("applyServerTimeouts sets 30000/15000", () => {
  const server = { requestTimeout: 0, headersTimeout: 0 };
  applyServerTimeouts(server, {});
  assert.equal(server.requestTimeout, 30_000);
  assert.equal(server.headersTimeout, 15_000);

  applyServerTimeouts(server, { ET_REQUEST_TIMEOUT_MS: "40000", ET_HEADERS_TIMEOUT_MS: "12000" });
  assert.equal(server.requestTimeout, 40_000);
  assert.equal(server.headersTimeout, 12_000);
});

test("search 503 on catalog error has no stack", async () => {
  setPoolForTests({
    query() {
      return Promise.reject(new Error("statement timeout"));
    },
  });
  const res = await request("/search?q=a");
  assert.equal(res.status, 503);
  assert.match(res.headers["content-type"], /text\/plain/);
  assert.match(res.body, /Search is temporarily unavailable/);
  assert.doesNotMatch(res.body, /Error|stack|at /);
  setPoolForTests(null);
});

test("SQL files exist with CONCURRENTLY IF NOT EXISTS gin_trgm_ops and matching UNDO", () => {
  assert.equal(fs.existsSync(TRGM), true);
  assert.equal(fs.existsSync(UNDO), true);
  const up = fs.readFileSync(TRGM, "utf8");
  const down = fs.readFileSync(UNDO, "utf8");
  assert.match(up, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(up, /CONCURRENTLY cannot run inside a transaction/);
  assert.match(up, /lab :5433 first/i);
  assert.match(up, /Admiral CLEAR/);
  assert.doesNotMatch(up, /nicknames::text/);
  assert.doesNotMatch(up, /clearances::text/);
  assert.doesNotMatch(up, /agencies::text/);
  assert.doesNotMatch(down, /nicknames::text/);
  assert.doesNotMatch(down, /clearances::text/);
  assert.doesNotMatch(down, /agencies::text/);
  assert.doesNotMatch(down, /DROP EXTENSION/);
  assert.match(down, /left installed/);
  for (const name of INDEX_NAMES) {
    const create = new RegExp(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name}\\s+ON \\S+ USING gin \\(\\S+ gin_trgm_ops\\)`,
    );
    assert.match(up, create, `missing create ${name}`);
    assert.match(down, new RegExp(`DROP INDEX CONCURRENTLY IF EXISTS ${name}\\s*;`), `missing drop ${name}`);
  }
});
