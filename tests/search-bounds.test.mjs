import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyServerTimeouts, handle, resetRateLimiter } from "../app/server.mjs";
import {
  SEARCH_Q_MAX,
  SEARCH_SQL_LIMIT,
  SearchBusyError,
  acquireSearchSlot,
  loadSeedFile,
  pgPoolConfig,
  prepareSearchQuery,
  releaseSearchSlot,
  resetSearchSlotsForTests,
  searchCatalog,
  searchKindComms,
  searchOperations,
  searchPeople,
  searchSlotStats,
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
  "people_nicknames_trgm",
  "people_clearances_trgm",
  "operations_name_trgm",
  "operations_summary_trgm",
  "operations_agencies_trgm",
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
  resetSearchSlotsForTests();
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
  assert.doesNotMatch(down, /DROP EXTENSION/);
  assert.match(down, /left installed/);
  assert.equal(INDEX_NAMES.length, 27);
  const store = fs.readFileSync(path.join(ROOT, "app/lib/store.mjs"), "utf8");
  for (const expr of ["nicknames::text", "clearances::text", "agencies::text"]) {
    assert.match(up, new RegExp(`\\(${expr}\\)`), `migration missing ${expr}`);
    assert.match(store, new RegExp(`${expr} ILIKE`), `store SQL missing ${expr}`);
  }
  for (const name of INDEX_NAMES) {
    const create = new RegExp(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name}\\s+ON \\S+ USING gin \\(\\S+ gin_trgm_ops\\)`,
    );
    assert.match(up, create, `missing create ${name}`);
    assert.match(down, new RegExp(`DROP INDEX CONCURRENTLY IF EXISTS ${name}\\s*;`), `missing drop ${name}`);
  }
});

function escapeRegExpChar(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ILIKE ... ESCAPE '\' as a case-insensitive whole-string match. */
function ilikeEscapeMatches(value, pattern, escapeChar = "\\") {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === escapeChar) {
      i += 1;
      if (i >= pattern.length) break;
      out += escapeRegExpChar(pattern[i]);
    } else if (ch === "%") out += "[\\s\\S]*";
    else if (ch === "_") out += "[\\s\\S]";
    else out += escapeRegExpChar(ch);
  }
  return new RegExp(`^${out}$`, "i").test(String(value));
}

test("prepareSearchQuery escapes % _ and backslash once", () => {
  assert.deepEqual(prepareSearchQuery("%"), { raw: "%", needle: "%\\%%" });
  assert.deepEqual(prepareSearchQuery("_"), { raw: "_", needle: "%\\_%" });
  assert.deepEqual(prepareSearchQuery("\\"), { raw: "\\", needle: "%\\\\%" });
  const mixed = prepareSearchQuery("  hi%_ ");
  assert.deepEqual(mixed, { raw: "hi%_", needle: "%hi\\%\\_%" });
  assert.equal(prepareSearchQuery("   "), null);
  assert.equal(prepareSearchQuery(""), null);
  assert.equal(prepareSearchQuery("a".repeat(SEARCH_Q_MAX + 1)), null);
  assert.equal(prepareSearchQuery(mixed), mixed);
  assert.equal(prepareSearchQuery("a".repeat(SEARCH_Q_MAX)).raw.length, SEARCH_Q_MAX);
});

test("prepareSearchQuery % and _ needles match only literal fixtures; unescaped %%% matches all", () => {
  const fixtures = ["alpha", "50% off", "snake_case", "plain"];

  /** ILIKE pattern ESCAPE '\\': anchored, case-insensitive; % -> .*, _ -> . */
  function ilikeEscapeMatchesPattern(value, pattern, escapeChar = "\\") {
    let out = "";
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern[i];
      if (ch === escapeChar) {
        i += 1;
        if (i >= pattern.length) break;
        out += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      } else if (ch === "%") out += ".*";
      else if (ch === "_") out += ".";
      else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${out}$`, "i").test(String(value));
  }

  const matched = (pattern) =>
    fixtures.filter((sample) => ilikeEscapeMatchesPattern(sample, pattern));

  assert.deepEqual(matched(prepareSearchQuery("%").needle), ["50% off"]);
  assert.deepEqual(matched(prepareSearchQuery("_").needle), ["snake_case"]);
  assert.deepEqual(matched("%%%"), [...fixtures]);
});

test("every search SQL has ESCAPE after every ILIKE", async () => {
  const queries = [];
  setPoolForTests({
    query(sql, params) {
      queries.push({ sql: String(sql), params });
      return Promise.resolve({ rows: [] });
    },
  });
  await searchPeople("%");
  await searchOperations("_");
  await searchSourcePosts("\\");
  for (const id of KIND_COMM_IDS) await searchKindComms(id, "%");
  const prepared = prepareSearchQuery("%");
  const beforeCatalog = queries.length;
  await searchCatalog(prepared);
  assert.ok(queries.length >= 8);
  for (const { sql } of queries) {
    const ilike = sql.match(/ILIKE/g) || [];
    const escapes = sql.match(/ESCAPE '\\'/g) || [];
    assert.ok(ilike.length > 0, sql);
    assert.equal(ilike.length, escapes.length, sql);
  }
  assert.ok(queries.some((q) => q.params[0] === "%\\%%"));
  assert.ok(queries.some((q) => q.params[0] === "%\\_%"));
  assert.ok(queries.some((q) => q.params[0] === "%\\\\%"));
  const catalogQueries = queries.slice(beforeCatalog);
  assert.ok(catalogQueries.length >= 4);
  for (const q of catalogQueries) assert.equal(q.params[0], prepared.needle);

  const fixtures = ["plain", "100%", "a_b", "a\\b", "Mix%Value", "under_score", "PERCENT%"];
  const matched = (q) =>
    fixtures.filter((sample) => ilikeEscapeMatches(sample, prepareSearchQuery(q).needle));
  assert.deepEqual(matched("%"), ["100%", "Mix%Value", "PERCENT%"]);
  assert.deepEqual(matched("_"), ["a_b", "under_score"]);
  assert.deepEqual(matched("\\"), ["a\\b"]);
  assert.ok(ilikeEscapeMatches("Percent Land", prepareSearchQuery("percent").needle));
  assert.equal(ilikeEscapeMatches("plain", prepareSearchQuery("%").needle), false);
  assert.equal(ilikeEscapeMatches("plain", prepareSearchQuery("_").needle), false);
  setPoolForTests(null);
  assert.equal(searchSlotStats().active, 0);
  assert.equal(searchSlotStats().queued, 0);
});

test("memory fallback keeps % and _ literal", async () => {
  setPoolForTests(null);
  setMemory({
    people: [
      {
        id: "pct",
        category: "firings",
        name: "Has%Percent",
        role: "",
        event_date: "2020-01-02",
        summary: "",
        sources: [],
      },
      {
        id: "usc",
        category: "firings",
        name: "Has_Underscore",
        role: "",
        event_date: "2020-01-01",
        summary: "",
        sources: [],
      },
      {
        id: "plain",
        category: "firings",
        name: "Plain Person",
        role: "Ordinary role",
        event_date: "2020-01-03",
        summary: "ordinary text",
        sources: [],
      },
    ],
    dog_comms: [
      { id: "dog-plain", handle: "plain", account_name: "Plain", text: "no wildcard here", posted_at: "2020-01-01" },
    ],
    operations: [
      { id: "op-plain", name: "Plain Op", summary: "nothing odd", agencies: ["FBI"], event_date: "2020-01-01" },
    ],
    source_posts: [],
  });
  assert.deepEqual((await searchPeople("%")).map((row) => row.id), ["pct"]);
  assert.deepEqual((await searchPeople("_")).map((row) => row.id), ["usc"]);
  assert.deepEqual((await searchCatalog("%")).map((hit) => hit.row.id), ["pct"]);
  assert.deepEqual((await searchCatalog("_")).map((hit) => hit.row.id), ["usc"]);
});

test("search slot queue rejects immediately past 4 x slotLimit", async () => {
  const prev = process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS;
  process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS = "5000";
  const waiters = [];
  try {
    const limit = searchSlotStats().limit;
    for (let i = 0; i < limit; i++) await acquireSearchSlot();
    const maxQueued = limit * 4;
    for (let i = 0; i < maxQueued; i++) {
      const pending = acquireSearchSlot();
      pending.catch(() => {});
      waiters.push(pending);
    }
    assert.equal(searchSlotStats().queued, maxQueued);
    assert.equal(searchSlotStats().active, limit);
    const t0 = Date.now();
    await assert.rejects(acquireSearchSlot(), (err) => {
      assert.equal(err instanceof SearchBusyError, true);
      assert.equal(err.name, "SearchBusyError");
      assert.equal(err.code, "SEARCH_BUSY");
      return true;
    });
    assert.ok(Date.now() - t0 < 500);
    assert.equal(searchSlotStats().queued, maxQueued);
    const jobs = waiters.map(async (pending) => {
      await pending;
      releaseSearchSlot();
    });
    for (let i = 0; i < limit; i++) releaseSearchSlot();
    await Promise.all(jobs);
    assert.equal(searchSlotStats().active, 0);
    assert.equal(searchSlotStats().queued, 0);
  } finally {
    if (prev === undefined) delete process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS;
    else process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS = prev;
    resetSearchSlotsForTests();
  }
});

test("search slot acquire times out and leaves the queue", async () => {
  const prev = process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS;
  process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS = "50";
  try {
    const limit = searchSlotStats().limit;
    for (let i = 0; i < limit; i++) await acquireSearchSlot();
    const t0 = Date.now();
    await assert.rejects(acquireSearchSlot(), (err) => {
      assert.equal(err instanceof SearchBusyError, true);
      assert.equal(err.code, "SEARCH_BUSY");
      return true;
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 40, `elapsed ${elapsed}`);
    assert.ok(elapsed < 2000, `elapsed ${elapsed}`);
    assert.equal(searchSlotStats().queued, 0);
    assert.equal(searchSlotStats().active, limit);
    for (let i = 0; i < limit; i++) releaseSearchSlot();
    assert.equal(searchSlotStats().active, 0);
    assert.equal(searchSlotStats().queued, 0);
  } finally {
    if (prev === undefined) delete process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS;
    else process.env.ET_SEARCH_ACQUIRE_TIMEOUT_MS = prev;
    resetSearchSlotsForTests();
  }
});

test("/search returns 503 for SearchBusyError and releases the slot", async () => {
  setPoolForTests({
    query() {
      return Promise.reject(new SearchBusyError("search slot queue is full"));
    },
  });
  const res = await request("/search?q=abc");
  assert.equal(res.status, 503);
  assert.match(res.headers["content-type"], /text\/plain/);
  assert.match(res.body, /Search is temporarily unavailable/);
  assert.doesNotMatch(res.body, /SEARCH_BUSY|Error|stack|at /);
  assert.equal(searchSlotStats().active, 0);
  assert.equal(searchSlotStats().queued, 0);
  setPoolForTests(null);
});

test("full search queue makes /search 503 without querying", async () => {
  const queries = [];
  setPoolForTests({
    query() {
      queries.push(1);
      return Promise.resolve({ rows: [] });
    },
  });
  const limit = searchSlotStats().limit;
  try {
    for (let i = 0; i < limit; i++) await acquireSearchSlot();
    for (let i = 0; i < limit * 4; i++) {
      const pending = acquireSearchSlot();
      pending.catch(() => {});
    }
    const res = await request("/search?q=abc");
    assert.equal(res.status, 503);
    assert.match(res.body, /Search is temporarily unavailable/);
    assert.doesNotMatch(res.body, /SEARCH_BUSY|Error|stack|at /);
    assert.equal(queries.length, 0);
  } finally {
    resetSearchSlotsForTests();
    setPoolForTests(null);
    assert.equal(searchSlotStats().active, 0);
    assert.equal(searchSlotStats().queued, 0);
  }
});

test("aborted search signal issues no pool query", async () => {
  const queries = [];
  setPoolForTests({
    query() {
      queries.push(1);
      return Promise.resolve({ rows: [] });
    },
  });
  const ac = new AbortController();
  ac.abort();
  const hits = await searchCatalog("alpha", { signal: ac.signal });
  assert.deepEqual(hits, []);
  assert.equal(queries.length, 0);
  assert.equal(searchSlotStats().active, 0);

  const limit = searchSlotStats().limit;
  try {
    for (let i = 0; i < limit; i++) await acquireSearchSlot();
    const queued = new AbortController();
    const pending = searchPeople("alpha", { signal: queued.signal });
    const sawQueue = await new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (searchSlotStats().queued >= 1) resolve(true);
        else if (Date.now() - started > 500) resolve(false);
        else setTimeout(tick, 5);
      };
      tick();
    });
    assert.equal(sawQueue, true);
    queued.abort();
    await assert.rejects(pending, (err) => {
      assert.equal(err.name, "AbortError");
      return true;
    });
    assert.equal(queries.length, 0);
    assert.equal(searchSlotStats().queued, 0);
  } finally {
    resetSearchSlotsForTests();
    setPoolForTests(null);
    assert.equal(searchSlotStats().active, 0);
  }
});

test("closed /search writes nothing and issues no query", async () => {
  const queries = [];
  setPoolForTests({
    query() {
      queries.push(1);
      return Promise.resolve({ rows: [] });
    },
  });
  const req = {
    method: "GET",
    url: "/search?q=alpha",
    headers: { host: "127.0.0.1", "cf-connecting-ip": "198.51.100.77" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  let ended = false;
  const res = {
    req,
    writableFinished: false,
    headersSent: false,
    on(event, fn) {
      if (event === "close") fn();
    },
    removeListener() {},
    writeHead() {
      ended = true;
    },
    end() {
      ended = true;
    },
  };
  await handle(req, res);
  assert.equal(queries.length, 0);
  assert.equal(ended, false);
  assert.equal(searchSlotStats().active, 0);
  setPoolForTests(null);
});
