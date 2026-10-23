import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle, resetRateLimiter } from "../app/server.mjs";
import {
  loadSeedFile,
  resetCatalogCacheForTests,
  setMemory,
  setPoolForTests,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

after(() => {
  setPoolForTests(null);
  resetRateLimiter();
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
});

function createFakePool({ max = 4, ilikeDelayMs = 1500 } = {}) {
  let inUse = 0;
  let ilikeInFlight = 0;
  const wait = [];
  const stats = {
    nonIlikeQueries: 0,
    peakIlike: 0,
    peakInUse: 0,
  };

  function acquire() {
    return new Promise((resolve) => {
      if (inUse < max) {
        inUse += 1;
        if (inUse > stats.peakInUse) stats.peakInUse = inUse;
        resolve();
      } else {
        wait.push(resolve);
      }
    });
  }

  function release() {
    const next = wait.shift();
    if (next) next();
    else inUse = Math.max(0, inUse - 1);
  }

  return {
    stats,
    query(sql) {
      const text = typeof sql === "string" ? sql : String(sql?.text || "");
      const slow = /ILIKE/i.test(text);
      if (!slow) stats.nonIlikeQueries += 1;
      return acquire().then(
        () =>
          new Promise((resolve) => {
            if (slow) {
              ilikeInFlight += 1;
              if (ilikeInFlight > stats.peakIlike) stats.peakIlike = ilikeInFlight;
            }
            setTimeout(() => {
              if (slow) ilikeInFlight = Math.max(0, ilikeInFlight - 1);
              resolve({ rows: slow ? [] : [{ n: 0 }] });
              release();
            }, slow ? ilikeDelayMs : 1);
          }),
      );
    },
  };
}

function get(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: pathname, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function listenHandle() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err?.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  assert.notEqual(port, 5220);
  return { server, port };
}

function fireSearches(port) {
  const searches = [];
  for (let i = 0; i < 5; i++) {
    searches.push(
      get(port, "/search?q=a", { "cf-connecting-ip": `203.0.113.${20 + i}` }),
    );
  }
  return searches;
}

test("GET / stays under 1000ms while 5 searches occupy the pool", { timeout: 60_000 }, async (t) => {
  const prevPoolMax = process.env.PG_POOL_MAX;
  let server;
  const searches = [];
  const pool = createFakePool({ max: 4, ilikeDelayMs: 1500 });
  try {
    process.env.PG_POOL_MAX = "4";
    setMemory({ people: [], dog_comms: [], operations: [], source_posts: [] });
    resetCatalogCacheForTests();
    setPoolForTests(pool);
    resetRateLimiter();

    const listened = await listenHandle();
    server = listened.server;
    const { port } = listened;
    searches.push(...fireSearches(port));
    await new Promise((r) => setTimeout(r, 100));

    resetCatalogCacheForTests();
    const beforeNonIlike = pool.stats.nonIlikeQueries;
    const t0 = Date.now();
    const home = await get(port, "/", { "cf-connecting-ip": "203.0.113.99" });
    const homeMs = Date.now() - t0;
    t.diagnostic(`gated GET / completed in ${homeMs}ms while 5 searches were in flight`);
    console.log(`[search-concurrency] gated GET / ${homeMs}ms`);

    assert.equal(home.status, 200);
    assert.ok(homeMs < 1000, `gated GET / took ${homeMs}ms; expected < 1000ms`);
    assert.ok(
      pool.stats.nonIlikeQueries > beforeNonIlike,
      `GET / issued no non-ILIKE pool queries (before=${beforeNonIlike} after=${pool.stats.nonIlikeQueries})`,
    );
    assert.ok(
      pool.stats.peakIlike <= 3,
      `peak concurrent ILIKE ${pool.stats.peakIlike} exceeded gate of 3`,
    );
    t.diagnostic(
      `gated peakIlike=${pool.stats.peakIlike} peakInUse=${pool.stats.peakInUse} nonIlike=${pool.stats.nonIlikeQueries}`,
    );

    const searchRes = await Promise.all(searches);
    for (const res of searchRes) assert.equal(res.status, 200);
  } finally {
    await Promise.allSettled(searches);
    await closeServer(server);
    setPoolForTests(null);
    if (prevPoolMax === undefined) delete process.env.PG_POOL_MAX;
    else process.env.PG_POOL_MAX = prevPoolMax;
  }
});

test("CONTROL: GET / is >= 1000ms when the search gate fills the whole pool", { timeout: 60_000 }, async (t) => {
  const prevPoolMax = process.env.PG_POOL_MAX;
  let server;
  const searches = [];
  const pool = createFakePool({ max: 4, ilikeDelayMs: 1500 });
  try {
    process.env.PG_POOL_MAX = "5";
    setMemory({ people: [], dog_comms: [], operations: [], source_posts: [] });
    resetCatalogCacheForTests();
    setPoolForTests(pool);
    resetRateLimiter();

    const listened = await listenHandle();
    server = listened.server;
    const { port } = listened;
    searches.push(...fireSearches(port));
    await new Promise((r) => setTimeout(r, 100));

    resetCatalogCacheForTests();
    const beforeNonIlike = pool.stats.nonIlikeQueries;
    const t0 = Date.now();
    const home = await get(port, "/", { "cf-connecting-ip": "203.0.113.99" });
    const homeMs = Date.now() - t0;
    t.diagnostic(`control GET / completed in ${homeMs}ms while 5 searches were in flight`);
    console.log(`[search-concurrency] control GET / ${homeMs}ms`);

    assert.equal(home.status, 200);
    assert.ok(homeMs >= 1000, `control GET / took ${homeMs}ms; expected >= 1000ms (pool wedged)`);
    assert.ok(
      pool.stats.nonIlikeQueries > beforeNonIlike,
      `control GET / issued no non-ILIKE pool queries (before=${beforeNonIlike} after=${pool.stats.nonIlikeQueries})`,
    );
    t.diagnostic(
      `control peakIlike=${pool.stats.peakIlike} peakInUse=${pool.stats.peakInUse} nonIlike=${pool.stats.nonIlikeQueries}`,
    );

    const searchRes = await Promise.all(searches);
    for (const res of searchRes) assert.equal(res.status, 200);
  } finally {
    await Promise.allSettled(searches);
    await closeServer(server);
    setPoolForTests(null);
    if (prevPoolMax === undefined) delete process.env.PG_POOL_MAX;
    else process.env.PG_POOL_MAX = prevPoolMax;
  }
});
